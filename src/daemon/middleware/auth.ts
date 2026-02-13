/**
 * Authentication Middleware (WOP-261)
 *
 * Two middleware functions:
 *
 * 1. bearerAuth() — validates the daemon bearer token (WOP-20 backward compat).
 *    Skips /health, /ready, /, and /api/auth/* (Better Auth handles its own auth).
 *
 * 2. requireAuth() — for protected routes that need a platform user session.
 *    Checks daemon bearer token FIRST (backward compat), then Better Auth session.
 */

import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { logger } from "../../logger.js";
import { ensureToken } from "../auth-token.js";
import { getAuth } from "../better-auth.js";

// WebSocket upgrade paths skip bearer auth — authentication happens
// at the WebSocket message level via first-message ticket exchange
const SKIP_AUTH_PATHS = new Set(["/health", "/ready", "/ws", "/api/ws", "/healthz", "/healthz/history"]);

// Cache the token so we don't hit disk on every request
let cachedToken: string | null = null;

function getDaemonToken(): string {
  if (!cachedToken) {
    cachedToken = ensureToken();
  }
  return cachedToken;
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
 * Skips /health, /ready, /, and /api/auth/* paths.
 * Must be applied after CORS but before route handlers.
 */
export function bearerAuth(): MiddlewareHandler {
  return async (c, next) => {
    // Skip paths that don't need daemon auth
    if (SKIP_AUTH_PATHS.has(c.req.path) || c.req.path === "/") {
      return next();
    }

    // Skip Better Auth routes — they handle their own authentication.
    // Use exact prefix match to avoid matching unrelated paths like /api/authentication.
    if (c.req.path === "/api/auth" || c.req.path.startsWith("/api/auth/")) {
      return next();
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
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
 * Middleware that requires a platform user (Better Auth session).
 * Checks daemon bearer token FIRST for backward compat, then Better Auth session.
 * Sets c.var.user, c.var.session, and c.var.role on success.
 *
 * Daemon bearer token holders are treated as "admin" role for backward compat.
 */
export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");

    // Check daemon bearer token first (backward compat)
    // Daemon token holders get admin role (they have the on-disk secret)
    if (authHeader?.startsWith("Bearer ")) {
      if (isDaemonBearerValid(authHeader)) {
        c.set("role", "admin");
        return next();
      }
    }

    // Fall back to Better Auth session
    try {
      const session = await getAuth().api.getSession({
        headers: c.req.raw.headers,
      });
      if (session) {
        c.set("user", session.user);
        c.set("session", session.session);
        c.set("role", (session.user as Record<string, unknown>).role ?? "viewer");
        return next();
      }
    } catch (err) {
      logger.error(`[auth] Better Auth session check failed: ${err}`);
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
