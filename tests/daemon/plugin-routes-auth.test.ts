import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../../src/daemon/auth-token.js", () => ({
  ensureToken: vi.fn(() => "test-token"),
}));

vi.mock("../../src/plugins/extensions.js", () => {
  const skillsRouter = new Hono();
  skillsRouter.get("/list", (c) => c.json({ skills: [] }));

  const cronsRouter = new Hono();
  cronsRouter.get("/list", (c) => c.json({ crons: [] }));

  const canvasRouter = new Hono();
  canvasRouter.get("/state", (c) => c.json({ canvas: {} }));

  const metricsRouter = new Hono();
  metricsRouter.get("/health", (c) => c.json({ healthy: true }));

  return {
    getPluginExtension: vi.fn((key: string) => {
      const map: Record<string, Hono> = {
        "skills:router": skillsRouter,
        "crons:router": cronsRouter,
        "canvas:router": canvasRouter,
        "metrics:router": metricsRouter,
      };
      return map[key] ?? null;
    }),
  };
});

// Import requireAuth and create a minimal app that mirrors daemon setup
import { requireAuth } from "../../src/daemon/middleware/auth.js";
import { getPluginExtension } from "../../src/plugins/extensions.js";

function buildTestApp() {
  const app = new Hono();

  // Apply requireAuth before mounting, same as production
  app.use("/skills/*", requireAuth());
  app.use("/crons/*", requireAuth());
  app.use("/canvas/*", requireAuth());
  app.use("/observability/*", requireAuth());

  const skills = getPluginExtension("skills:router");
  if (skills) app.route("/skills", skills as Hono);

  const crons = getPluginExtension("crons:router");
  if (crons) app.route("/crons", crons as Hono);

  const canvas = getPluginExtension("canvas:router");
  if (canvas) app.route("/canvas", canvas as Hono);

  const metrics = getPluginExtension("metrics:router");
  if (metrics) app.route("/observability", metrics as Hono);

  return app;
}

describe("plugin-mounted routes require auth (WOP-1546)", () => {
  let app: Hono;

  beforeEach(() => {
    app = buildTestApp();
  });

  const routes = [
    { path: "/skills/list", name: "skills" },
    { path: "/crons/list", name: "crons" },
    { path: "/canvas/state", name: "canvas" },
    { path: "/observability/health", name: "observability" },
  ];

  for (const { path, name } of routes) {
    it(`${name}: rejects requests without auth header`, async () => {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Authorization");
    });

    it(`${name}: rejects requests with invalid token`, async () => {
      const res = await app.request(path, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
    });

    it(`${name}: accepts requests with valid daemon bearer token`, async () => {
      const res = await app.request(path, {
        headers: { Authorization: "Bearer test-token" },
      });
      expect(res.status).toBe(200);
    });
  }
});
