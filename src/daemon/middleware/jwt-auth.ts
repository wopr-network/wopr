/**
 * JWT Authentication Middleware (WOP-208)
 *
 * Validates JWT access tokens on protected routes.
 * Sets `c.set("userId", ...)` and `c.set("userEmail", ...)` on success.
 */

import type { MiddlewareHandler } from "hono";
import { verifyToken } from "../user-auth/index.js";
import type { UserAuthEnv } from "../user-auth/types.js";

/**
 * Middleware that requires a valid JWT access token.
 * Extracts user info from the token and sets it on the context.
 */
export function jwtAuth(): MiddlewareHandler<UserAuthEnv> {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);
    const payload = await verifyToken(token);

    if (!payload || !payload.sub) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    // Set user info on context for downstream handlers
    c.set("userId", payload.sub);
    c.set("userEmail", payload.email ?? "");
    c.set("userRole", payload.role ?? "user");

    return next();
  };
}
