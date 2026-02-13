/**
 * Better Auth Routes (WOP-261)
 *
 * Mounts Better Auth handler on Hono at /api/auth/**
 * Provides: sign-up, sign-in, sign-out, session, OAuth flows, etc.
 */

import { Hono } from "hono";
import { auth } from "../better-auth.js";

export const betterAuthRouter = new Hono();

betterAuthRouter.on(["POST", "GET"], "/*", (c) => {
  return auth.handler(c.req.raw);
});
