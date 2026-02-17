/**
 * Authentication Middleware (WOP-378, WOP-209)
 *
 * Two-layer auth chain:
 *
 * 1. bearerAuth() — validates the daemon bearer token OR wopr_ API key.
 *    Skips /health, /ready, and / endpoints.
 *
 * 2. requireAdmin() — enforces admin/owner role after API key auth.
 *
 * Auth is a platform concern (WOP-340). The core daemon only validates
 * API tokens for platform→daemon communication.
 */

import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { logger } from "../../logger.js";
import { validateApiKey } from "../api-keys.js";
import { ensureToken } from "../auth-token.js";

// WebSocket upgrade paths skip bearer auth — authentication happens
// at the WebSocket message level via first-message ticket exchange
const SKIP_AUTH_PATHS = new Set(["/health", "/ready", "/ws", "/api/ws", "/healthz", "/healthz/history"]);

/** Map an API key scope to its corresponding auth role. */
function scopeToRole(scope: string): string {
  if (scope === "full") return "admin";
  return "viewer";
}

// Cache the token so we don't hit disk on every request
let cachedToken: string | null = null;

function getDaemonToken(): string {
  if (!cachedToken) {
    cachedToken = ensureToken();
  }
  return cachedToken;
}

/**
 * Validate a wopr_ API key token and set user/role context on the Hono context.
 * Returns true if the key was valid and context was set, false otherwise.
 */
async function authenticateApiKey(c: Parameters<MiddlewareHandler>[0], token: string): Promise<boolean> {
  const keyUser = await validateApiKey(token);
  if (!keyUser) return false;
  c.set("user", { id: keyUser.id });
  c.set("authMethod", "api_key");
  c.set("apiKeyScope", keyUser.scope);
  c.set("role", scopeToRole(keyUser.scope));
  return true;
}

function isDaemonBearerValid(authHeader: string): boolean {
  const provided = authHeader.slice(7); // Strip "Bearer "
  let expected: string;
  try {
    expected = getDaemonToken();
  } catch {
    return false;
  }
  const providedBuf = Buffer.from(provided, "utf-8");
  const expectedBuf = Buffer.from(expected, "utf-8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Hono middleware that validates daemon bearer tokens.
 * Skips /health, /ready, /, and WebSocket paths.
 * Must be applied after CORS but before route handlers.
 */
export function bearerAuth(): MiddlewareHandler {
  return async (c, next) => {
    // Skip paths that don't need daemon auth
    if (SKIP_AUTH_PATHS.has(c.req.path) || c.req.path === "/") {
      return next();
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    // Accept wopr_ prefixed API keys (WOP-209)
    const token = authHeader.slice(7);
    if (token.startsWith("wopr_")) {
      if (await authenticateApiKey(c, token)) return next();
      return c.json({ error: "Invalid API key" }, 401);
    }

    try {
      if (!isDaemonBearerValid(authHeader)) {
        return c.json({ error: "Invalid token" }, 401);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[auth] Failed to load token: ${msg}`);
      return c.json({ error: "Internal server error" }, 500);
    }

    return next();
  };
}

/**
 * Middleware that requires API authentication (daemon bearer token or wopr_ API key).
 * Sets user context and role based on the auth method.
 *
 * Daemon bearer token holders are treated as "admin" role.
 * API key holders get role based on their scope (full=admin, read/write/cron=viewer).
 */
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);

    // Check wopr_ API keys (WOP-209)
    if (token.startsWith("wopr_")) {
      if (await authenticateApiKey(c, token)) return next();
      return c.json({ error: "Invalid API key" }, 401);
    }

    // Check daemon bearer token
    if (isDaemonBearerValid(authHeader)) {
      c.set("role", "admin");
      return next();
    }

    return c.json({ error: "Unauthorized" }, 401);
  };
}

/**
 * Middleware that requires admin role.
 * Must be used AFTER requireAuth() in the middleware chain.
 * Rejects non-admin users with 403 Forbidden.
 */
export function requireAdmin(): MiddlewareHandler {
  return async (c, next) => {
    const role = c.get("role");
    if (role !== "admin" && role !== "owner") {
      return c.json({ error: "Forbidden: admin access required" }, 403);
    }
    return next();
  };
}
