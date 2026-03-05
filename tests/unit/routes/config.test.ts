import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock auth middleware
vi.mock("../../../src/daemon/middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    const role = c.req.header("X-Test-Role") || "viewer";
    c.set("role", role);
    return next();
  },
  requireAdmin: () => async (c: any, next: any) => {
    const role = c.get("role");
    if (role !== "admin" && role !== "owner") {
      return c.json({ error: "Forbidden: admin access required" }, 403);
    }
    return next();
  },
  requireWriteScope: () => async (_c: any, next: any) => next(),
}));

// Mock config
vi.mock("../../../src/core/config.js", () => ({
  config: {
    load: vi.fn(),
    get: vi.fn(() => ({ some: "config" })),
    getValue: vi.fn((key: string) => (key === "known" ? "value" : undefined)),
    setValue: vi.fn(),
    save: vi.fn(),
    reset: vi.fn(),
  },
}));

// Mock redact
vi.mock("../../../src/security/redact.js", () => ({
  redactSensitive: vi.fn((v: any) => v),
}));

// Dynamic import after vi.mock() declarations for consistency (matches openapi.test.ts pattern)
const { configRouter } = await import("../../../src/daemon/routes/config.js");

describe("config routes authorization", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/config", configRouter);
  });

  describe("GET /config", () => {
    it("allows viewer role", async () => {
      const res = await app.request("/config", {
        headers: { "X-Test-Role": "viewer" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /config/:key", () => {
    it("allows viewer role", async () => {
      const res = await app.request("/config/known", {
        headers: { "X-Test-Role": "viewer" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("PUT /config/:key", () => {
    it("rejects viewer role with 403", async () => {
      const res = await app.request("/config/some.key", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Role": "viewer",
        },
        body: JSON.stringify({ value: "test" }),
      });
      expect(res.status).toBe(403);
    });

    it("allows admin role", async () => {
      const res = await app.request("/config/some.key", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Role": "admin",
        },
        body: JSON.stringify({ value: "test" }),
      });
      expect(res.status).toBe(200);
    });

    it("allows owner role", async () => {
      const res = await app.request("/config/some.key", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Test-Role": "owner",
        },
        body: JSON.stringify({ value: "test" }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("DELETE /config", () => {
    it("rejects viewer role with 403", async () => {
      const res = await app.request("/config", {
        method: "DELETE",
        headers: { "X-Test-Role": "viewer" },
      });
      expect(res.status).toBe(403);
    });

    it("allows admin role", async () => {
      const res = await app.request("/config", {
        method: "DELETE",
        headers: { "X-Test-Role": "admin" },
      });
      expect(res.status).toBe(200);
    });

    it("allows owner role", async () => {
      const res = await app.request("/config", {
        method: "DELETE",
        headers: { "X-Test-Role": "owner" },
      });
      expect(res.status).toBe(200);
    });

    it("calls config.load() after config.reset() to restore env overrides", async () => {
      const { config } = await import("../../../src/core/config.js");
      vi.mocked(config.reset).mockClear();
      vi.mocked(config.load).mockClear();

      const callOrder: string[] = [];
      vi.mocked(config.reset).mockImplementation(() => {
        callOrder.push("reset");
      });
      vi.mocked(config.load).mockImplementation(async () => {
        callOrder.push("load");
      });

      await app.request("/config", {
        method: "DELETE",
        headers: { "X-Test-Role": "admin" },
      });

      expect(callOrder).toEqual(["reset", "load"]);
    });
  });
});
