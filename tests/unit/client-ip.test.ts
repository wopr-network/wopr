import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { getClientIp } from "../../src/daemon/middleware/client-ip.js";

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

  it("should trust X-Forwarded-For when connecting IP is in trustedProxies", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["127.0.0.1"]);
      return c.json({ ip });
    });

    await app.request("/test", {
      headers: { "X-Forwarded-For": "203.0.113.50, 127.0.0.1" },
    });
    expect(ip).toBe("203.0.113.50");
  });

  it("should return first IP from X-Forwarded-For when trusted", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["127.0.0.1"]);
      return c.json({ ip });
    });

    await app.request("/test", {
      headers: { "X-Forwarded-For": "client.1.2.3, proxy1, proxy2" },
    });
    expect(ip).toBe("client.1.2.3");
  });

  it("should ignore X-Forwarded-For when connecting IP is NOT in trustedProxies", async () => {
    const app = new Hono();
    let ip: string | undefined;
    app.get("/test", (c) => {
      ip = getClientIp(c, ["10.0.0.1"]);
      return c.json({ ip });
    });

    await app.request("/test", {
      headers: { "X-Forwarded-For": "spoofed.5.6.7" },
    });
    expect(ip).toBe("127.0.0.1");
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
});
