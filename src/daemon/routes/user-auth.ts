/**
 * User Auth API Routes (WOP-208)
 *
 * POST /api/auth/register  - Create account
 * POST /api/auth/login     - Login, get tokens
 * POST /api/auth/refresh   - Refresh access token
 * POST /api/auth/logout    - Revoke refresh tokens
 * GET  /api/auth/me        - Get current user profile
 */

import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { jwtAuth } from "../middleware/jwt-auth.js";
import {
  AuthError,
  getUserProfile,
  loginUser,
  logoutUser,
  refreshAccessToken,
  registerUser,
} from "../user-auth/index.js";
import type { UserAuthEnv } from "../user-auth/types.js";

/**
 * Create a new user auth router instance.
 * Factory function to avoid shared rate limiter state in tests.
 */
export function createUserAuthRouter(): Hono {
  const router = new Hono();

  // Stricter rate limiting for auth endpoints: 10 req/min per IP
  router.use(
    "*",
    rateLimiter({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: "draft-6",
      keyGenerator: (c) => {
        const xff = c.req.header("x-forwarded-for");
        // Only trust the last entry (closest proxy) to prevent bypass via header rotation
        if (xff) {
          const parts = xff.split(",");
          return parts[parts.length - 1].trim();
        }
        return c.req.header("x-real-ip") ?? "anonymous";
      },
      handler: (c) => {
        c.header("Retry-After", "60");
        return c.json({ error: "Too many requests", retryAfter: 60 }, 429);
      },
    }),
  );

  // POST /register - Create a new account
  router.post("/register", async (c) => {
    try {
      const body = await c.req.json();
      const { email, password, displayName } = body;

      if (!email || !password) {
        return c.json({ error: "Email and password are required" }, 400);
      }

      const result = await registerUser({ email, password, displayName });
      return c.json({ user: result.user }, 201);
    } catch (err) {
      if (err instanceof AuthError) {
        // Return generic 200 for duplicate emails to prevent user enumeration
        if (err.statusCode === 409) {
          return c.json({ message: "If this email is available, registration will proceed. Check your inbox." }, 200);
        }
        return c.json({ error: err.message }, err.statusCode as 400 | 401);
      }
      throw err;
    }
  });

  // POST /login - Authenticate and get tokens
  router.post("/login", async (c) => {
    try {
      const body = await c.req.json();
      const { email, password } = body;

      if (!email || !password) {
        return c.json({ error: "Email and password are required" }, 400);
      }

      const result = await loginUser({ email, password });
      return c.json({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, err.statusCode as 401);
      }
      throw err;
    }
  });

  // POST /refresh - Refresh access token
  router.post("/refresh", async (c) => {
    try {
      const body = await c.req.json();
      const { refreshToken } = body;

      if (!refreshToken) {
        return c.json({ error: "Refresh token is required" }, 400);
      }

      const result = await refreshAccessToken(refreshToken);
      return c.json({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, err.statusCode as 401);
      }
      throw err;
    }
  });

  // Typed sub-router for JWT-protected routes
  const protectedRouter = new Hono<UserAuthEnv>();

  // POST /logout - Revoke all refresh tokens (requires valid access token)
  protectedRouter.post("/logout", jwtAuth(), async (c) => {
    const userId = c.get("userId");
    logoutUser(userId);
    return c.json({ success: true });
  });

  // GET /me - Get current user profile (requires valid access token)
  protectedRouter.get("/me", jwtAuth(), async (c) => {
    const userId = c.get("userId");
    const user = getUserProfile(userId);

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json({ user });
  });

  // Mount protected routes
  router.route("/", protectedRouter);

  return router;
}

/** Default singleton for use by the daemon */
export const userAuthRouter = createUserAuthRouter();
