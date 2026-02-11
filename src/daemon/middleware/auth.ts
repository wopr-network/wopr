/**
 * Bearer Token Authentication Middleware
 *
 * Requires a valid Authorization: Bearer <token> header on all
 * routes except /health. Uses constant-time comparison to prevent
 * timing attacks.
 */

import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { ensureToken } from "../auth-token.js";

const SKIP_AUTH_PATHS = new Set(["/health"]);

// Cache the token so we don't hit disk on every request
let cachedToken: string | null = null;

/**
 * Hono middleware that validates bearer tokens.
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

    let expected: string;
    try {
      if (!cachedToken) {
        cachedToken = ensureToken();
      }
      expected = cachedToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[auth] Failed to load token: ${msg}`);
      return c.json({ error: "Internal server error" }, 500);
    }

    const provided = authHeader.slice(7);

    // Constant-time comparison to prevent timing attacks
    const providedBuf = Buffer.from(provided, "utf-8");
    const expectedBuf = Buffer.from(expected, "utf-8");

    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      return c.json({ error: "Invalid token" }, 401);
    }

    return next();
  };
}
