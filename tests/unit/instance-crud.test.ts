import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { instancesRouter, _resetStore } from "../../src/daemon/routes/instances.js";

function createApp() {
  const app = new Hono();
  app.route("/api/instances", instancesRouter);
  return app;
}

function json(body: unknown) {
  return new Request("http://localhost/api/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonPatch(id: string, body: unknown) {
  return new Request(`http://localhost/api/instances/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Instance CRUD Routes", () => {
  let app: Hono;

  beforeEach(() => {
    _resetStore();
    app = createApp();
  });

  // ── Create ───────────────────────────────────────────────────────
  describe("POST /api/instances", () => {
    it("creates an instance with a name", async () => {
      const res = await app.request(json({ name: "test-1" }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.instance.name).toBe("test-1");
      expect(data.instance.id).toBeDefined();
      expect(data.instance.status).toBe("created");
    });

    it("creates an instance from a template", async () => {
      const res = await app.request(json({ name: "chat-bot", template: "chat" }));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.instance.template).toBe("chat");
      expect(data.instance.config).toEqual({ mode: "chat" });
      expect(data.instance.plugins).toContain("wopr-plugin-discord");
    });

    it("merges custom config over template defaults", async () => {
      const res = await app.request(
        json({ name: "custom-chat", template: "chat", config: { mode: "custom", extra: true } }),
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.instance.config.mode).toBe("custom");
      expect(data.instance.config.extra).toBe(true);
    });

    it("rejects unknown template", async () => {
      const res = await app.request(json({ name: "bad", template: "nonexistent" }));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Unknown template");
    });

    it("rejects missing name", async () => {
      const res = await app.request(json({}));
      expect(res.status).toBe(400);
    });

    it("rejects invalid JSON body", async () => {
      const res = await app.request(
        new Request("http://localhost/api/instances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not-json",
        }),
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Invalid JSON body");
    });
  });

  // ── List ─────────────────────────────────────────────────────────
  describe("GET /api/instances", () => {
    it("returns empty list initially", async () => {
      const res = await app.request(new Request("http://localhost/api/instances"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.instances).toEqual([]);
      expect(data.total).toBe(0);
    });

    it("lists created instances", async () => {
      await app.request(json({ name: "a" }));
      await app.request(json({ name: "b" }));
      const res = await app.request(new Request("http://localhost/api/instances"));
      const data = await res.json();
      expect(data.total).toBe(2);
      expect(data.instances.length).toBe(2);
    });

    it("supports pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await app.request(json({ name: `i-${i}` }));
      }
      const res = await app.request(new Request("http://localhost/api/instances?limit=2&offset=0"));
      const data = await res.json();
      expect(data.instances.length).toBe(2);
      expect(data.total).toBe(5);
    });

    it("filters by status", async () => {
      const created = await (await app.request(json({ name: "a" }))).json();
      await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/start`, { method: "POST" }),
      );
      await app.request(json({ name: "b" }));

      const res = await app.request(new Request("http://localhost/api/instances?status=running"));
      const data = await res.json();
      expect(data.total).toBe(1);
      expect(data.instances[0].status).toBe("running");
    });

    it("filters by template", async () => {
      await app.request(json({ name: "t1", template: "chat" }));
      await app.request(json({ name: "t2", template: "agent" }));
      await app.request(json({ name: "t3" }));

      const res = await app.request(new Request("http://localhost/api/instances?template=chat"));
      const data = await res.json();
      expect(data.total).toBe(1);
      expect(data.instances[0].template).toBe("chat");
    });
  });

  // ── Get ──────────────────────────────────────────────────────────
  describe("GET /api/instances/:id", () => {
    it("returns instance by id", async () => {
      const created = await (await app.request(json({ name: "detail" }))).json();
      const res = await app.request(new Request(`http://localhost/api/instances/${created.instance.id}`));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.instance.name).toBe("detail");
    });

    it("returns 404 for unknown id", async () => {
      const res = await app.request(
        new Request("http://localhost/api/instances/00000000-0000-0000-0000-000000000000"),
      );
      expect(res.status).toBe(404);
    });
  });

  // ── Update ───────────────────────────────────────────────────────
  describe("PATCH /api/instances/:id", () => {
    it("updates instance name", async () => {
      const created = await (await app.request(json({ name: "old" }))).json();
      const res = await app.request(jsonPatch(created.instance.id, { name: "new" }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.instance.name).toBe("new");
    });

    it("merges config", async () => {
      const created = await (await app.request(json({ name: "cfg", config: { a: 1 } }))).json();
      const res = await app.request(jsonPatch(created.instance.id, { config: { b: 2 } }));
      const data = await res.json();
      expect(data.instance.config).toEqual({ a: 1, b: 2 });
    });

    it("replaces plugins array", async () => {
      const created = await (await app.request(json({ name: "plg", plugins: ["a"] }))).json();
      const res = await app.request(jsonPatch(created.instance.id, { plugins: ["b", "c"] }));
      const data = await res.json();
      expect(data.instance.plugins).toEqual(["b", "c"]);
    });

    it("returns 404 for unknown id", async () => {
      const res = await app.request(jsonPatch("00000000-0000-0000-0000-000000000000", { name: "x" }));
      expect(res.status).toBe(404);
    });
  });

  // ── Delete ───────────────────────────────────────────────────────
  describe("DELETE /api/instances/:id", () => {
    it("deletes a stopped instance", async () => {
      const created = await (await app.request(json({ name: "del" }))).json();
      const res = await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}`, { method: "DELETE" }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);
    });

    it("refuses to delete a running instance", async () => {
      const created = await (await app.request(json({ name: "running" }))).json();
      await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/start`, { method: "POST" }),
      );
      const res = await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}`, { method: "DELETE" }),
      );
      expect(res.status).toBe(409);
    });

    it("returns 404 for unknown id", async () => {
      const res = await app.request(
        new Request("http://localhost/api/instances/00000000-0000-0000-0000-000000000000", { method: "DELETE" }),
      );
      expect(res.status).toBe(404);
    });
  });

  // ── Start / Stop / Restart ───────────────────────────────────────
  describe("POST /api/instances/:id/start", () => {
    it("starts a created instance", async () => {
      const created = await (await app.request(json({ name: "s" }))).json();
      const res = await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/start`, { method: "POST" }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.instance.status).toBe("running");
      expect(data.instance.startedAt).toBeDefined();
      expect(data.instance.health.healthy).toBe(true);
    });

    it("rejects starting an already running instance", async () => {
      const created = await (await app.request(json({ name: "s" }))).json();
      await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/start`, { method: "POST" }),
      );
      const res = await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/start`, { method: "POST" }),
      );
      expect(res.status).toBe(409);
    });

    it("returns 404 for unknown id", async () => {
      const res = await app.request(
        new Request("http://localhost/api/instances/00000000-0000-0000-0000-000000000000/start", { method: "POST" }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/instances/:id/stop", () => {
    it("stops a running instance", async () => {
      const created = await (await app.request(json({ name: "s" }))).json();
      await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/start`, { method: "POST" }),
      );
      const res = await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/stop`, { method: "POST" }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.instance.status).toBe("stopped");
      expect(data.instance.stoppedAt).toBeDefined();
    });

    it("rejects stopping a non-running instance", async () => {
      const created = await (await app.request(json({ name: "s" }))).json();
      const res = await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/stop`, { method: "POST" }),
      );
      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/instances/:id/restart", () => {
    it("restarts an instance", async () => {
      const created = await (await app.request(json({ name: "r" }))).json();
      await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/start`, { method: "POST" }),
      );
      const res = await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/restart`, { method: "POST" }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.instance.status).toBe("running");
    });

    it("returns 404 for unknown id", async () => {
      const res = await app.request(
        new Request("http://localhost/api/instances/00000000-0000-0000-0000-000000000000/restart", { method: "POST" }),
      );
      expect(res.status).toBe(404);
    });
  });

  // ── Logs ─────────────────────────────────────────────────────────
  describe("GET /api/instances/:id/logs", () => {
    it("returns logs for an instance", async () => {
      const created = await (await app.request(json({ name: "log-test" }))).json();
      const res = await app.request(
        new Request(`http://localhost/api/instances/${created.instance.id}/logs`),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.logs.length).toBeGreaterThan(0);
      expect(data.logs[0].message).toContain("created");
    });

    it("respects lines param", async () => {
      const created = await (await app.request(json({ name: "log-lines" }))).json();
      const id = created.instance.id;
      // Generate extra logs by starting and stopping
      await app.request(new Request(`http://localhost/api/instances/${id}/start`, { method: "POST" }));
      await app.request(new Request(`http://localhost/api/instances/${id}/stop`, { method: "POST" }));

      const res = await app.request(new Request(`http://localhost/api/instances/${id}/logs?lines=1`));
      const data = await res.json();
      expect(data.logs.length).toBe(1);
    });

    it("filters by since timestamp", async () => {
      const created = await (await app.request(json({ name: "log-since" }))).json();
      const id = created.instance.id;

      const futureSince = Date.now() + 100_000;
      const res = await app.request(
        new Request(`http://localhost/api/instances/${id}/logs?since=${futureSince}`),
      );
      const data = await res.json();
      expect(data.logs.length).toBe(0);
    });

    it("returns 404 for unknown id", async () => {
      const res = await app.request(
        new Request("http://localhost/api/instances/00000000-0000-0000-0000-000000000000/logs"),
      );
      expect(res.status).toBe(404);
    });
  });
});
