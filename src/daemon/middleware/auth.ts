/**
 * Bearer Token & API Key Authentication Middleware
 *
 * Requires a valid Authorization header on all routes except /health and /ready.
 * Accepts two forms:
 *   - Bearer <daemon-token>  (original control plane auth)
 *   - Bearer wopr_<key>      (long-lived API keys, WOP-209)
 * Uses constant-time comparison to prevent timing attacks.
 */

import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { logger } from "../../logger.js";
import { validateApiKey } from "../api-keys.js";
import { ensureToken } from "../auth-token.js";

const SKIP_AUTH_PATHS = new Set(["/health", "/ready"]);

const API_KEY_PREFIX = "wopr_";

// Cache the token so we don't hit disk on every request
let cachedToken: string | null = null;

/**
 * Hono middleware that validates bearer tokens and API keys.
 * Must be applied after CORS but before route handlers.
 */
export function bearerAuth(): MiddlewareHandler {
  return async (c, next) => {
    if (SKIP_AUTH_PATHS.has(c.req.path)) {
      return next();
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const provided = authHeader.slice(7);

    // Check if this is a wopr_ API key
    if (provided.startsWith(API_KEY_PREFIX)) {
      try {
        const keyRecord = validateApiKey(provided);
        if (keyRecord) {
          // Attach key metadata to request context for downstream use
          c.set("apiKey", keyRecord);
          return next();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[auth] API key validation error: ${msg}`);
        // Fall through to "Invalid token" response
      }
      return c.json({ error: "Invalid token" }, 401);
    }

    // Standard daemon bearer token
    let expected: string;
    try {
      if (!cachedToken) {
        cachedToken = ensureToken();
      }
      expected = cachedToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[auth] Failed to load token: ${msg}`);
      return c.json({ error: "Internal server error" }, 500);
    }

    // Constant-time comparison to prevent timing attacks
    const providedBuf = Buffer.from(provided, "utf-8");
    const expectedBuf = Buffer.from(expected, "utf-8");

    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      return c.json({ error: "Invalid token" }, 401);
    }

    return next();
  };
}
