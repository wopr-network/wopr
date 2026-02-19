/**
 * CORS Configuration Tests (WOP-622)
 *
 * Verifies that the daemon CORS policy:
 * - Allows requests from known localhost origins
 * - Rejects cross-origin requests from unknown origins
 * - Allows requests with credentials from whitelisted origins
 * - Reflects the daemon port from WOPR_DAEMON_PORT env var
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCorsOrigins } from "../../src/daemon/cors.js";

function createTestApp(origins: string[]) {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: origins,
      credentials: true,
    }),
  );
  app.get("/health", (c) => c.json({ status: "ok" }));
  return app;
}

describe("buildCorsOrigins", () => {
  const originalEnv = process.env.WOPR_DAEMON_PORT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.WOPR_DAEMON_PORT;
    } else {
      process.env.WOPR_DAEMON_PORT = originalEnv;
    }
  });

  it("includes localhost and 127.0.0.1 on the default port 7437", () => {
    delete process.env.WOPR_DAEMON_PORT;
    const origins = buildCorsOrigins();
    expect(origins).toContain("http://localhost:7437");
    expect(origins).toContain("http://127.0.0.1:7437");
  });

  it("includes platform-ui dev server origin http://localhost:3000", () => {
    delete process.env.WOPR_DAEMON_PORT;
    const origins = buildCorsOrigins();
    expect(origins).toContain("http://localhost:3000");
  });

  it("reflects custom port from WOPR_DAEMON_PORT env var", () => {
    process.env.WOPR_DAEMON_PORT = "9000";
    const origins = buildCorsOrigins();
    expect(origins).toContain("http://localhost:9000");
    expect(origins).toContain("http://127.0.0.1:9000");
  });

  it("does not include wildcard origin", () => {
    const origins = buildCorsOrigins();
    expect(origins.some((o) => o === "*")).toBe(false);
  });

  it("returns only string origins (no wildcard function)", () => {
    const origins = buildCorsOrigins();
    for (const origin of origins) {
      expect(typeof origin).toBe("string");
    }
  });
});

describe("CORS middleware with localhost whitelist", () => {
  it("reflects http://localhost:7437 in Access-Control-Allow-Origin", async () => {
    const app = createTestApp(buildCorsOrigins());
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:7437",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:7437");
  });

  it("reflects http://127.0.0.1:7437 in Access-Control-Allow-Origin", async () => {
    const app = createTestApp(buildCorsOrigins());
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:7437",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:7437");
  });

  it("reflects http://localhost:3000 in Access-Control-Allow-Origin", async () => {
    const app = createTestApp(buildCorsOrigins());
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("does not allow unknown external origin https://evil.example.com", async () => {
    const app = createTestApp(buildCorsOrigins());
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
    expect(allowOrigin).not.toBe("*");
    expect(allowOrigin).not.toBe("https://evil.example.com");
  });

  it("does not set * for simple GET from unknown origin", async () => {
    const app = createTestApp(buildCorsOrigins());
    const res = await app.request("/health", {
      headers: { Origin: "https://malicious.example.com" },
    });
    const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
    expect(allowOrigin).not.toBe("*");
  });

  it("sets Access-Control-Allow-Credentials: true for whitelisted origin", async () => {
    const app = createTestApp(buildCorsOrigins());
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });
});
