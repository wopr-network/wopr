/**
 * Rate Limiting Middleware Tests (WOP-59)
 *
 * Verifies that the rate limiter:
 * - Allows requests within the limit
 * - Returns 429 with Retry-After when limit is exceeded
 * - Skips health/readiness probes
 * - Keys by Authorization header
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "../../src/daemon/middleware/rate-limit.js";

function createTestApp(config?: { windowMs?: number; limit?: number }) {
  const app = new Hono();
  app.use("*", rateLimit(config));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/ready", (c) => c.json({ ready: true }));
  app.get("/api/test", (c) => c.json({ data: "hello" }));
  app.post("/api/action", (c) => c.json({ done: true }));
  return app;
}

describe("Rate Limiting Middleware", () => {
  it("should allow requests within the limit", async () => {
    const app = createTestApp({ windowMs: 60_000, limit: 5 });

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/test", {
        headers: { Authorization: "Bearer test-token" },
      });
      expect(res.status).toBe(200);
    }
  });

  it("should return 429 when limit is exceeded", async () => {
    const app = createTestApp({ windowMs: 60_000, limit: 3 });

    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/test", {
        headers: { Authorization: "Bearer token-exceed" },
      });
      expect(res.status).toBe(200);
    }

    // This request should be rate-limited
    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer token-exceed" },
    });
    expect(res.status).toBe(429);
  });

  it("should include Retry-After header in 429 response", async () => {
    const app = createTestApp({ windowMs: 60_000, limit: 1 });

    // Use up the limit
    await app.request("/api/test", {
      headers: { Authorization: "Bearer token-retry" },
    });

    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer token-retry" },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("should return error body with retryAfter field on 429", async () => {
    const app = createTestApp({ windowMs: 30_000, limit: 1 });

    await app.request("/api/test", {
      headers: { Authorization: "Bearer token-body" },
    });

    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer token-body" },
    });
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toBe("Too many requests");
    expect(body.retryAfter).toBe(30);
  });

  it("should skip rate limiting for /health", async () => {
    const app = createTestApp({ windowMs: 60_000, limit: 1 });

    // First request uses the limit for this key
    await app.request("/api/test");

    // /health should still work even if limit is reached
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
    }
  });

  it("should skip rate limiting for /ready", async () => {
    const app = createTestApp({ windowMs: 60_000, limit: 1 });

    await app.request("/api/test");

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/ready");
      expect(res.status).toBe(200);
    }
  });

  it("should track limits independently per client", async () => {
    const app = createTestApp({ windowMs: 60_000, limit: 2 });

    // Client A uses 2 requests
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/api/test", {
        headers: { Authorization: "Bearer client-a" },
      });
      expect(res.status).toBe(200);
    }

    // Client A is now rate-limited
    const resA = await app.request("/api/test", {
      headers: { Authorization: "Bearer client-a" },
    });
    expect(resA.status).toBe(429);

    // Client B should still have their own limit
    const resB = await app.request("/api/test", {
      headers: { Authorization: "Bearer client-b" },
    });
    expect(resB.status).toBe(200);
  });

  it("should include rate limit headers in responses", async () => {
    const app = createTestApp({ windowMs: 60_000, limit: 10 });

    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer token-headers" },
    });
    expect(res.status).toBe(200);

    // draft-6 headers
    expect(res.headers.get("RateLimit-Limit")).toBe("10");
    expect(res.headers.get("RateLimit-Remaining")).toBe("9");
    expect(Number(res.headers.get("RateLimit-Reset"))).toBeGreaterThan(0);
  });

  it("should use default config (60 req/min) when no config provided", async () => {
    const app = createTestApp();

    // Should handle 60 requests without issue
    const res = await app.request("/api/test", {
      headers: { Authorization: "Bearer token-default" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("RateLimit-Limit")).toBe("60");
  });

  it("should key by IP when keyByIp is true", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, limit: 2, keyByIp: true }));
    app.post("/api/auth/sign-in", (c) => c.json({ ok: true }));

    // Two different auth headers but same IP should share the limit
    const res1 = await app.request("/api/auth/sign-in", {
      method: "POST",
      headers: { Authorization: "Bearer token-a", "X-Forwarded-For": "1.2.3.4" },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/api/auth/sign-in", {
      method: "POST",
      headers: { Authorization: "Bearer token-b", "X-Forwarded-For": "1.2.3.4" },
    });
    expect(res2.status).toBe(200);

    // Third request from same IP should be rate limited
    const res3 = await app.request("/api/auth/sign-in", {
      method: "POST",
      headers: { Authorization: "Bearer token-c", "X-Forwarded-For": "1.2.3.4" },
    });
    expect(res3.status).toBe(429);
  });

  it("should allow different IPs independently when keyByIp is true", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, limit: 1, keyByIp: true }));
    app.post("/api/auth/sign-in", (c) => c.json({ ok: true }));

    // First IP uses up its limit
    const res1 = await app.request("/api/auth/sign-in", {
      method: "POST",
      headers: { "X-Forwarded-For": "10.0.0.1" },
    });
    expect(res1.status).toBe(200);

    // Second IP should still work
    const res2 = await app.request("/api/auth/sign-in", {
      method: "POST",
      headers: { "X-Forwarded-For": "10.0.0.2" },
    });
    expect(res2.status).toBe(200);
  });

  // -----------------------------------------------------------------
  // WOP-1404: Document spoofable X-Forwarded-For behavior
  // SECURITY NOTE: When keyByIp is true, the rate limiter trusts
  // X-Forwarded-For and X-Real-IP headers sent by the client.
  // These are trivially spoofable unless a trusted reverse proxy
  // strips and resets them upstream. This is a known limitation.
  // -----------------------------------------------------------------

  it("should use X-Forwarded-For for key derivation when keyByIp is true (WOP-1404)", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, limit: 1, keyByIp: true }));
    app.get("/api/test", (c) => c.json({ ok: true }));

    // First request from "1.2.3.4" — allowed
    const res1 = await app.request("/api/test", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });
    expect(res1.status).toBe(200);

    // Second request from same "IP" — rate limited
    const res2 = await app.request("/api/test", {
      headers: { "X-Forwarded-For": "1.2.3.4" },
    });
    expect(res2.status).toBe(429);
  });

  it("should allow bypass by rotating X-Forwarded-For value (WOP-1404 — documents spoofable behavior)", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, limit: 1, keyByIp: true }));
    app.get("/api/test", (c) => c.json({ ok: true }));

    // Each "different IP" gets its own bucket — an attacker can rotate to bypass
    const res1 = await app.request("/api/test", {
      headers: { "X-Forwarded-For": "10.0.0.1" },
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/api/test", {
      headers: { "X-Forwarded-For": "10.0.0.2" },
    });
    expect(res2.status).toBe(200);

    const res3 = await app.request("/api/test", {
      headers: { "X-Forwarded-For": "10.0.0.3" },
    });
    expect(res3.status).toBe(200);

    // Meanwhile the "real" IP (10.0.0.1) bucket is exhausted
    const res4 = await app.request("/api/test", {
      headers: { "X-Forwarded-For": "10.0.0.1" },
    });
    expect(res4.status).toBe(429);
  });

  it("should fall back to 'anonymous' bucket when no X-Forwarded-For header is present (WOP-1404)", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, limit: 2, keyByIp: true }));
    app.get("/api/test", (c) => c.json({ ok: true }));

    // Request without X-Forwarded-For or X-Real-IP — falls back to "anonymous"
    const res1 = await app.request("/api/test");
    expect(res1.status).toBe(200);

    const res2 = await app.request("/api/test");
    expect(res2.status).toBe(200);

    // Third request hits the "anonymous" bucket limit
    const res3 = await app.request("/api/test");
    expect(res3.status).toBe(429);
  });

  it("should share the 'anonymous' bucket across multiple clients without X-Forwarded-For (WOP-1404)", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, limit: 2, keyByIp: true }));
    app.get("/api/test", (c) => c.json({ ok: true }));

    // "Client A" — no identifying headers
    const resA = await app.request("/api/test", {
      headers: { Authorization: "Bearer client-a" },
    });
    expect(resA.status).toBe(200);

    // "Client B" — different auth but still no IP header, shares anonymous bucket
    const resB = await app.request("/api/test", {
      headers: { Authorization: "Bearer client-b" },
    });
    expect(resB.status).toBe(200);

    // "Client C" — bucket exhausted even though this is a "new" client
    const resC = await app.request("/api/test", {
      headers: { Authorization: "Bearer client-c" },
    });
    expect(resC.status).toBe(429);
  });
});
