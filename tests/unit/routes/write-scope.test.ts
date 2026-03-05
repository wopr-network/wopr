import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { requireWriteScope } from "../../../src/daemon/middleware/auth.js";
import { _resetStore, instancesRouter } from "../../../src/daemon/routes/instances.js";
import { templatesRouter } from "../../../src/daemon/routes/templates.js";

// ---------------------------------------------------------------------------
// Unit tests for requireWriteScope() middleware
// ---------------------------------------------------------------------------

describe("requireWriteScope", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.post("/test", requireWriteScope(), (c) => c.json({ ok: true }));
  });

  it("allows requests with no apiKeyScope (daemon bearer token)", async () => {
    const res = await app.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("allows requests with apiKeyScope=full", async () => {
    const app2 = new Hono();
    app2.use("*", async (c, next) => {
      c.set("apiKeyScope", "full");
      return next();
    });
    app2.post("/test", requireWriteScope(), (c) => c.json({ ok: true }));
    const res = await app2.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("allows requests with instance-scoped key", async () => {
    const app2 = new Hono();
    app2.use("*", async (c, next) => {
      c.set("apiKeyScope", "instance:my-bot");
      return next();
    });
    app2.post("/test", requireWriteScope(), (c) => c.json({ ok: true }));
    const res = await app2.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("blocks read-only API keys with 403", async () => {
    const app2 = new Hono();
    app2.use("*", async (c, next) => {
      c.set("apiKeyScope", "read-only");
      return next();
    });
    app2.post("/test", requireWriteScope(), (c) => c.json({ ok: true }));
    const res = await app2.request("/test", { method: "POST" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("read-only");
  });

  it("returns OpenAI-style error envelope when format is 'openai'", async () => {
    const app2 = new Hono();
    app2.use("*", async (c, next) => {
      c.set("apiKeyScope", "read-only");
      return next();
    });
    app2.post("/test", requireWriteScope({ format: "openai" }), (c) => c.json({ ok: true }));
    const res = await app2.request("/test", { method: "POST" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toEqual({
      message: "Forbidden: read-only API key cannot perform write operations",
      type: "insufficient_scope",
      code: "forbidden",
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests: verify requireWriteScope blocks on actual route files
// ---------------------------------------------------------------------------

describe("write scope enforcement - instances routes", () => {
  let app: Hono;

  beforeEach(() => {
    _resetStore();
    app = new Hono();
    // Simulate read-only API key
    app.use("*", async (c, next) => {
      c.set("apiKeyScope", "read-only");
      return next();
    });
    app.route("/instances", instancesRouter);
  });

  const mutatingRoutes = [
    { method: "POST" as const, path: "/instances", body: { name: "test" } },
    { method: "PATCH" as const, path: "/instances/fake-id", body: { name: "x" } },
    { method: "DELETE" as const, path: "/instances/fake-id" },
    { method: "POST" as const, path: "/instances/fake-id/start" },
    { method: "POST" as const, path: "/instances/fake-id/stop" },
    { method: "POST" as const, path: "/instances/fake-id/restart" },
  ];

  for (const route of mutatingRoutes) {
    it(`blocks read-only on ${route.method} ${route.path}`, async () => {
      const res = await app.request(route.path, {
        method: route.method,
        headers: { "Content-Type": "application/json" },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(res.status).toBe(403);
    });
  }

  it("allows read-only key to GET /instances (read route)", async () => {
    const res = await app.request("/instances");
    expect(res.status).toBe(200);
  });
});

describe("write scope enforcement - templates routes", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.use("*", async (c, next) => {
      c.set("apiKeyScope", "read-only");
      return next();
    });
    app.route("/templates", templatesRouter);
  });

  const mutatingRoutes = [
    {
      method: "POST" as const,
      path: "/templates",
      body: { name: "t", description: "d", plugins: [], providers: [], tags: [] },
    },
    { method: "POST" as const, path: "/templates/default/apply", body: { instanceId: "x" } },
    { method: "DELETE" as const, path: "/templates/custom-t" },
  ];

  for (const route of mutatingRoutes) {
    it(`blocks read-only on ${route.method} ${route.path}`, async () => {
      const res = await app.request(route.path, {
        method: route.method,
        headers: { "Content-Type": "application/json" },
        body: route.body ? JSON.stringify(route.body) : undefined,
      });
      expect(res.status).toBe(403);
    });
  }

  it("allows read-only key to GET /templates (read route)", async () => {
    const res = await app.request("/templates");
    expect(res.status).toBe(200);
  });
});
