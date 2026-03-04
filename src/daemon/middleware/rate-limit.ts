/**
 * Rate Limiting Middleware (WOP-59)
 *
 * Prevents API abuse by limiting requests per client.
 * Uses hono-rate-limiter with sensible defaults (60 req/min).
 * Returns 429 with Retry-After header when limit is exceeded.
 */

import type { MiddlewareHandler } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { getClientIp, parseTrustedProxies } from "./client-ip.js";

/** Paths exempt from rate limiting (health/readiness probes). */
const SKIP_PATHS = new Set(["/health", "/ready"]);

export interface RateLimitConfig {
  /** Time window in milliseconds. Default: 60_000 (1 minute). */
  windowMs?: number;
  /** Max requests per window per client. Default: 60. */
  limit?: number;
  /** Key by IP address instead of Authorization header. Default: false. */
  keyByIp?: boolean;
}

/**
 * Creates a rate limiting middleware for the Hono API.
 *
 * Identifies clients by Authorization header (since all non-health
 * routes require bearer auth) with socket IP fallback.
 * When keyByIp is true, always uses socket IP for keying (for auth endpoints).
 * Only trusts X-Forwarded-For when TRUSTED_PROXY env var is set and the
 * connecting IP matches a trusted proxy.
 */
export function rateLimit(config: RateLimitConfig = {}): MiddlewareHandler {
  const windowMs = config.windowMs ?? 60_000;
  const limit = config.limit ?? 60;
  const keyByIp = config.keyByIp ?? false;
  const trustedProxies = parseTrustedProxies();

  return rateLimiter({
    windowMs,
    limit,
    standardHeaders: "draft-6",
    keyGenerator: (c) => {
      if (keyByIp) {
        return getClientIp(c, trustedProxies);
      }
      return c.req.header("authorization") ?? getClientIp(c, trustedProxies);
    },
    skip: (c) => SKIP_PATHS.has(c.req.path),
    handler: (c) => {
      const retryAfterSeconds = Math.ceil(windowMs / 1000);
      c.header("Retry-After", String(retryAfterSeconds));
      return c.json(
        {
          error: "Too many requests",
          retryAfter: retryAfterSeconds,
        },
        429,
      );
    },
  });
}
