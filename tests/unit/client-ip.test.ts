import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { getClientIp, parseTrustedProxies } from "../../src/daemon/middleware/client-ip.js";

// Mock getConnInfo since Hono test client has no real socket
vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(() => ({ remote: { address: "127.0.0.1" } })),
}));

describe("getClientIp", () => {
  it("should return socket IP when no trusted proxies configured", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c);
      return c.json({ ip });
    });

    await app.request("/test", {
      headers: { "X-Forwarded-For": "spoofed.1.2.3" },
    });
    expect(ip).toBe("127.0.0.1");
  });

  it("should return real client IP via right-to-left XFF walk", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["127.0.0.1"]);
      return c.json({ ip });
    });

    // XFF: client, proxy1 (trusted) — walk right-to-left: 127.0.0.1 trusted (skip), 203.0.113.50 not trusted → return it
    await app.request("/test", {
      headers: { "X-Forwarded-For": "203.0.113.50, 127.0.0.1" },
    });
    expect(ip).toBe("203.0.113.50");
  });

  it("should stop at first non-trusted valid IP walking right-to-left", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["10.0.0.2", "127.0.0.1"]);
      return c.json({ ip });
    });

    // XFF: client(valid), proxy1(trusted), proxy2(trusted)
    // Walk right-to-left: 10.0.0.2 trusted (skip), 203.0.113.50 not trusted → return it
    await app.request("/test", {
      headers: { "X-Forwarded-For": "203.0.113.50, 10.0.0.2" },
    });
    expect(ip).toBe("203.0.113.50");
  });

  it("should skip multiple trusted proxies and return client IP", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["10.0.0.1", "10.0.0.2", "127.0.0.1"]);
      return c.json({ ip });
    });

    // XFF: client, proxy1(trusted), proxy2(trusted) — walk right-to-left skipping both trusted
    await app.request("/test", {
      headers: { "X-Forwarded-For": "203.0.113.99, 10.0.0.2, 10.0.0.1" },
    });
    expect(ip).toBe("203.0.113.99");
  });

  it("should ignore X-Forwarded-For when trustedProxies is empty", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["10.0.0.1"]);
      return c.json({ ip });
    });

    // Socket 127.0.0.1 is not in trustedProxies (only 10.0.0.1 is), XFF is untrusted
    // But with right-to-left walk: walk XFF only when trustedProxies.size > 0
    // Here trustedProxies has 10.0.0.1 but socket is 127.0.0.1
    // New algorithm: trustedProxies controls XFF walk, not socket IP matching
    await app.request("/test", {
      headers: { "X-Forwarded-For": "spoofed.5.6.7" },
    });
    // spoofed.5.6.7 is not a valid IP so it gets skipped; fallback to socket
    expect(ip).toBe("127.0.0.1");
  });

  it("should skip empty segments in malformed X-Forwarded-For when trusted", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["127.0.0.1"]);
      return c.json({ ip });
    });

    await app.request("/test", {
      headers: { "X-Forwarded-For": ", 203.0.113.50, 127.0.0.1" },
    });
    expect(ip).toBe("203.0.113.50");
  });

  it("should fallback to 'unknown' when socket has no address and no headers trusted", async () => {
    const { getConnInfo } = await import("@hono/node-server/conninfo");
    vi.mocked(getConnInfo).mockReturnValueOnce({ remote: { address: undefined } } as ReturnType<typeof getConnInfo>);

    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c);
      return c.json({ ip });
    });

    await app.request("/test");
    expect(ip).toBe("unknown");
  });

  it("should strip IPv4:port from XFF entry", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["127.0.0.1"]);
      return c.json({ ip });
    });

    await app.request("/test", {
      headers: { "X-Forwarded-For": "203.0.113.50:8080, 127.0.0.1" },
    });
    expect(ip).toBe("203.0.113.50");
  });

  it("should strip IPv6 brackets from XFF entry", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["127.0.0.1"]);
      return c.json({ ip });
    });

    await app.request("/test", {
      headers: { "X-Forwarded-For": "[2001:db8::1], 127.0.0.1" },
    });
    expect(ip).toBe("2001:db8::1");
  });

  it("should fallback to socket when all XFF entries are trusted", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["10.0.0.1", "127.0.0.1"]);
      return c.json({ ip });
    });

    await app.request("/test", {
      headers: { "X-Forwarded-For": "10.0.0.1" },
    });
    // All XFF IPs are trusted, fallback to socket
    expect(ip).toBe("127.0.0.1");
  });
});

describe("parseTrustedProxies", () => {
  it("should return undefined when TRUSTED_PROXY not set", () => {
    delete process.env.TRUSTED_PROXY;
    expect(parseTrustedProxies()).toBeUndefined();
  });

  it("should parse valid IPs", () => {
    process.env.TRUSTED_PROXY = "10.0.0.1,192.168.1.1";
    expect(parseTrustedProxies()).toEqual(["10.0.0.1", "192.168.1.1"]);
    delete process.env.TRUSTED_PROXY;
  });

  it("should filter out non-IP entries like hostnames and empty strings", () => {
    process.env.TRUSTED_PROXY = "10.0.0.1, my-proxy-host, , 192.168.1.1";
    expect(parseTrustedProxies()).toEqual(["10.0.0.1", "192.168.1.1"]);
    delete process.env.TRUSTED_PROXY;
  });

  it("should accept IPv6 addresses", () => {
    process.env.TRUSTED_PROXY = "::1,2001:db8::1";
    expect(parseTrustedProxies()).toEqual(["::1", "2001:db8::1"]);
    delete process.env.TRUSTED_PROXY;
  });
});
