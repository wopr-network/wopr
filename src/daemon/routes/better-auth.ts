/**
 * Better Auth Routes (WOP-261)
 *
 * Mounts Better Auth handler on Hono at /api/auth/**
 * Provides: sign-up, sign-in, sign-out, session, OAuth flows, etc.
 *
 * Rate limits on sensitive endpoints:
 * - sign-in: 5/min per IP (brute-force prevention)
 * - sign-up: 3/hour per IP (abuse prevention)
 * - forgot-password: 3/hour per IP (abuse prevention)
 */

import { Hono } from "hono";
import { getAuth } from "../better-auth.js";
import { rateLimit } from "../middleware/rate-limit.js";

export const betterAuthRouter = new Hono();

// Stricter rate limits on sensitive auth endpoints (keyed by IP)
const signInLimiter = rateLimit({ windowMs: 60_000, limit: 5, keyByIp: true });
const signUpLimiter = rateLimit({ windowMs: 3_600_000, limit: 3, keyByIp: true });
const forgotPasswordLimiter = rateLimit({ windowMs: 3_600_000, limit: 3, keyByIp: true });

betterAuthRouter.use("/sign-in/*", signInLimiter);
betterAuthRouter.use("/sign-up/*", signUpLimiter);
betterAuthRouter.use("/forgot-password/*", forgotPasswordLimiter);

betterAuthRouter.all("/*", (c) => {
  return getAuth().handler(c.req.raw);
});
