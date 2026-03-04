import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Mock getConnInfo to return a controlled socket IP
const { mockGetConnInfo } = vi.hoisted(() => ({
  mockGetConnInfo: vi.fn().mockReturnValue({ remote: { address: "192.168.1.1" } }),
}));

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: (...args: unknown[]) => mockGetConnInfo(...args),
}));

import { rateLimit } from "../../../src/daemon/middleware/rate-limit.js";

describe("rate-limit middleware (WOP-1585)", () => {
  beforeEach(() => {
    mockGetConnInfo.mockReturnValue({ remote: { address: "192.168.1.1" } });
    delete process.env.TRUSTED_PROXY;
  });

  describe("requests allowed under the limit", () => {
    it("allows requests when under the limit", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 5 }));
      app.all("*", (c) => c.json({ ok: true }));

      const res = await app.request("/api/test", {
        headers: { Authorization: "Bearer token-a" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("allows exactly limit number of requests", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 3 }));
      app.all("*", (c) => c.json({ ok: true }));

      for (let i = 0; i < 3; i++) {
        const res = await app.request("/api/test", {
          headers: { Authorization: "Bearer token-b" },
        });
        expect(res.status).toBe(200);
      }
    });
  });

  describe("requests blocked at/above the limit (429)", () => {
    it("returns 429 when limit is exceeded", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 2 }));
      app.all("*", (c) => c.json({ ok: true }));

      // Use up the limit
      for (let i = 0; i < 2; i++) {
        const res = await app.request("/api/test", {
          headers: { Authorization: "Bearer token-c" },
        });
        expect(res.status).toBe(200);
      }

      // Next request should be blocked
      const blocked = await app.request("/api/test", {
        headers: { Authorization: "Bearer token-c" },
      });
      expect(blocked.status).toBe(429);
      const body = await blocked.json();
      expect(body.error).toBe("Too many requests");
      expect(body.retryAfter).toBe(60);
    });

    it("includes Retry-After header in 429 response", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 30_000, limit: 1 }));
      app.all("*", (c) => c.json({ ok: true }));

      await app.request("/api/test", {
        headers: { Authorization: "Bearer token-d" },
      });

      const blocked = await app.request("/api/test", {
        headers: { Authorization: "Bearer token-d" },
      });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("30");
    });

    it("uses default limit of 60 when not configured", async () => {
      const app = new Hono();
      app.use("*", rateLimit());
      app.all("*", (c) => c.json({ ok: true }));

      // Send 60 requests — all should pass
      for (let i = 0; i < 60; i++) {
        const res = await app.request("/api/test", {
          headers: { Authorization: "Bearer token-default" },
        });
        expect(res.status).toBe(200);
      }

      // 61st should be blocked
      const blocked = await app.request("/api/test", {
        headers: { Authorization: "Bearer token-default" },
      });
      expect(blocked.status).toBe(429);
    });
  });

  describe("different keys rate-limited independently", () => {
    it("tracks separate limits per Authorization header", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1 }));
      app.all("*", (c) => c.json({ ok: true }));

      // Client A uses its one request
      const resA = await app.request("/api/test", {
        headers: { Authorization: "Bearer client-a" },
      });
      expect(resA.status).toBe(200);

      // Client B still has its own limit
      const resB = await app.request("/api/test", {
        headers: { Authorization: "Bearer client-b" },
      });
      expect(resB.status).toBe(200);

      // Client A is now blocked
      const blockedA = await app.request("/api/test", {
        headers: { Authorization: "Bearer client-a" },
      });
      expect(blockedA.status).toBe(429);

      // Client B is also now blocked (used its 1 request)
      const blockedB = await app.request("/api/test", {
        headers: { Authorization: "Bearer client-b" },
      });
      expect(blockedB.status).toBe(429);
    });

    it("falls back to socket IP when no Authorization header", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1 }));
      app.all("*", (c) => c.json({ ok: true }));

      // No auth header — keyed by socket IP (192.168.1.1 from mock)
      const res1 = await app.request("/api/test");
      expect(res1.status).toBe(200);

      const res2 = await app.request("/api/test");
      expect(res2.status).toBe(429);
    });

    it("uses IP-only keying when keyByIp is true", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1, keyByIp: true }));
      app.all("*", (c) => c.json({ ok: true }));

      // Even with different auth headers, same IP = same bucket
      const res1 = await app.request("/api/test", {
        headers: { Authorization: "Bearer user-1" },
      });
      expect(res1.status).toBe(200);

      const res2 = await app.request("/api/test", {
        headers: { Authorization: "Bearer user-2" },
      });
      expect(res2.status).toBe(429);
    });

    it("different IPs are independent when keyByIp is true", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1, keyByIp: true }));
      app.all("*", (c) => c.json({ ok: true }));

      // First IP
      mockGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.1" } });
      const res1 = await app.request("/api/test");
      expect(res1.status).toBe(200);

      // Different IP — gets its own bucket
      mockGetConnInfo.mockReturnValue({ remote: { address: "10.0.0.2" } });
      const res2 = await app.request("/api/test");
      expect(res2.status).toBe(200);
    });
  });

  describe("skip paths", () => {
    it("never rate-limits /health", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1 }));
      app.all("*", (c) => c.json({ ok: true }));

      // Exhaust limit on /api/test first
      await app.request("/api/test", {
        headers: { Authorization: "Bearer skip-test" },
      });

      // /health should still work even though limit is exhausted
      for (let i = 0; i < 5; i++) {
        const res = await app.request("/health");
        expect(res.status).toBe(200);
      }
    });

    it("never rate-limits /ready", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1 }));
      app.all("*", (c) => c.json({ ok: true }));

      for (let i = 0; i < 5; i++) {
        const res = await app.request("/ready");
        expect(res.status).toBe(200);
      }
    });

    it("does not skip other paths", async () => {
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1 }));
      app.all("*", (c) => c.json({ ok: true }));

      await app.request("/api/data", {
        headers: { Authorization: "Bearer not-skipped" },
      });
      const blocked = await app.request("/api/data", {
        headers: { Authorization: "Bearer not-skipped" },
      });
      expect(blocked.status).toBe(429);
    });
  });

  describe("X-Forwarded-For trust (post WOP-1544)", () => {
    it("ignores X-Forwarded-For when TRUSTED_PROXY is not set", async () => {
      // No TRUSTED_PROXY env — XFF should be ignored, key by socket IP
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1, keyByIp: true }));
      app.all("*", (c) => c.json({ ok: true }));

      // Spoof a different IP via XFF — should be ignored
      const res1 = await app.request("/api/test", {
        headers: { "X-Forwarded-For": "1.2.3.4" },
      });
      expect(res1.status).toBe(200);

      // Second request with different spoofed XFF but same socket IP — should be blocked
      const res2 = await app.request("/api/test", {
        headers: { "X-Forwarded-For": "5.6.7.8" },
      });
      expect(res2.status).toBe(429);
    });

    it("uses XFF client IP (not socket) when trustedProxies is set", async () => {
      // When TRUSTED_PROXY is set, getClientIp walks XFF right-to-left and returns
      // the first non-trusted IP. The socket IP itself is not used as the key when XFF is present.
      process.env.TRUSTED_PROXY = "10.0.0.99";
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1, keyByIp: true }));
      app.all("*", (c) => c.json({ ok: true }));

      // Socket is 192.168.1.1 (not in trusted list), XFF is 1.2.3.4 (also not trusted)
      // getClientIp returns 1.2.3.4 as the leftmost non-trusted IP from XFF
      mockGetConnInfo.mockReturnValue({ remote: { address: "192.168.1.1" } });
      const res1 = await app.request("/api/test", {
        headers: { "X-Forwarded-For": "1.2.3.4" },
      });
      expect(res1.status).toBe(200);

      // Same XFF IP — blocked (keyed by XFF 1.2.3.4)
      const res2 = await app.request("/api/test", {
        headers: { "X-Forwarded-For": "1.2.3.4" },
      });
      expect(res2.status).toBe(429);

      // Different XFF IP — gets its own bucket
      const res3 = await app.request("/api/test", {
        headers: { "X-Forwarded-For": "9.9.9.9" },
      });
      expect(res3.status).toBe(200);
    });

    it("trusts XFF when connecting IP matches TRUSTED_PROXY", async () => {
      process.env.TRUSTED_PROXY = "192.168.1.1";
      const app = new Hono();
      app.use("*", rateLimit({ windowMs: 60_000, limit: 1, keyByIp: true }));
      app.all("*", (c) => c.json({ ok: true }));

      // Socket is trusted proxy, so XFF is used for keying
      const res1 = await app.request("/api/test", {
        headers: { "X-Forwarded-For": "203.0.113.1" },
      });
      expect(res1.status).toBe(200);

      // Different real client via XFF — gets its own bucket
      const res2 = await app.request("/api/test", {
        headers: { "X-Forwarded-For": "203.0.113.2" },
      });
      expect(res2.status).toBe(200);

      // Same client again — blocked
      const res3 = await app.request("/api/test", {
        headers: { "X-Forwarded-For": "203.0.113.1" },
      });
      expect(res3.status).toBe(429);
    });
  });

  describe("rate limit resets after time window", () => {
    it("allows requests again after window expires", async () => {
      vi.useFakeTimers();
      try {
        const app = new Hono();
        app.use("*", rateLimit({ windowMs: 10_000, limit: 1 }));
        app.all("*", (c) => c.json({ ok: true }));

        // Use up the limit
        const res1 = await app.request("/api/test", {
          headers: { Authorization: "Bearer timer-test" },
        });
        expect(res1.status).toBe(200);

        // Blocked
        const blocked = await app.request("/api/test", {
          headers: { Authorization: "Bearer timer-test" },
        });
        expect(blocked.status).toBe(429);

        // Advance past window
        vi.advanceTimersByTime(11_000);

        // Should be allowed again
        const res2 = await app.request("/api/test", {
          headers: { Authorization: "Bearer timer-test" },
        });
        expect(res2.status).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
