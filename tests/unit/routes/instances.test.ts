import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetStore, instancesRouter } from "../../../src/daemon/routes/instances.js";

const app = new Hono().route("/", instancesRouter);

function post(url: string, body: unknown) {
  return app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(url: string, body: unknown) {
  return app.request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST / — create instance", () => {
  beforeEach(() => _resetStore());

  it("creates instance with minimal fields", async () => {
    const res = await post("/", { name: "test-bot" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.instance.name).toBe("test-bot");
    expect(data.instance.status).toBe("created");
    expect(data.instance.id).toBeDefined();
    expect(data.instance.config).toEqual({});
    expect(data.instance.plugins).toEqual([]);
  });

  it("creates instance with template", async () => {
    const res = await post("/", { name: "chat-bot", template: "chat" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.instance.config).toEqual({ mode: "chat" });
    expect(data.instance.plugins).toEqual(["wopr-plugin-discord"]);
    expect(data.instance.template).toBe("chat");
  });

  it("merges user config over template config", async () => {
    const res = await post("/", {
      name: "custom",
      template: "agent",
      config: { autonomous: false, extra: true },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.instance.config).toEqual({ mode: "agent", autonomous: false, extra: true });
  });

  it("user plugins override template plugins", async () => {
    const res = await post("/", {
      name: "custom",
      template: "chat",
      plugins: ["my-plugin"],
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.instance.plugins).toEqual(["my-plugin"]);
  });

  it("returns 400 for unknown template", async () => {
    const res = await post("/", { name: "bad", template: "nonexistent" });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Unknown template");
  });

  it("returns 400 for missing name", async () => {
    const res = await post("/", {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Validation failed");
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });
});

describe("GET / — list instances", () => {
  beforeEach(() => _resetStore());

  it("returns empty list when no instances exist", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instances).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("returns created instances", async () => {
    await post("/", { name: "a" });
    await post("/", { name: "b" });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instances).toHaveLength(2);
    expect(data.total).toBe(2);
  });

  it("filters by status", async () => {
    await post("/", { name: "a" });
    await post("/", { name: "b" });
    const res = await app.request("/?status=running");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instances).toHaveLength(0);
  });

  it("filters by template", async () => {
    await post("/", { name: "a", template: "chat" });
    await post("/", { name: "b" });
    const res = await app.request("/?template=chat");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].template).toBe("chat");
  });

  it("paginates with limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      await post("/", { name: `bot-${i}` });
    }
    const res = await app.request("/?limit=2&offset=1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instances).toHaveLength(2);
    expect(data.limit).toBe(2);
    expect(data.offset).toBe(1);
    expect(data.total).toBe(5);
  });

  it("returns 400 for invalid query params", async () => {
    const res = await app.request("/?limit=-1");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid query parameters");
  });
});

describe("GET /:id — get instance", () => {
  beforeEach(() => _resetStore());

  it("returns instance by id", async () => {
    const createRes = await post("/", { name: "test" });
    const { instance } = await createRes.json();
    const res = await app.request(`/${instance.id}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.id).toBe(instance.id);
    expect(data.instance.name).toBe("test");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/nonexistent-id");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Instance not found");
  });
});

describe("PATCH /:id — update instance", () => {
  beforeEach(() => _resetStore());

  it("updates instance name", async () => {
    const createRes = await post("/", { name: "original" });
    const { instance } = await createRes.json();
    const res = await patch(`/${instance.id}`, { name: "renamed" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.name).toBe("renamed");
  });

  it("merges config", async () => {
    const createRes = await post("/", { name: "cfg", config: { a: 1 } });
    const { instance } = await createRes.json();
    const res = await patch(`/${instance.id}`, { config: { b: 2 } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.config).toEqual({ a: 1, b: 2 });
  });

  it("replaces plugins array", async () => {
    const createRes = await post("/", { name: "p", plugins: ["old"] });
    const { instance } = await createRes.json();
    const res = await patch(`/${instance.id}`, { plugins: ["new"] });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.plugins).toEqual(["new"]);
  });

  it("returns 404 for unknown id", async () => {
    const res = await patch("/unknown", { name: "x" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid JSON body", async () => {
    const createRes = await post("/", { name: "test" });
    const { instance } = await createRes.json();
    const res = await app.request(`/${instance.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "bad",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });
});

describe("DELETE /:id — delete instance", () => {
  beforeEach(() => _resetStore());

  it("deletes a stopped instance", async () => {
    const createRes = await post("/", { name: "del" });
    const { instance } = await createRes.json();
    const res = await app.request(`/${instance.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(true);
    expect(data.id).toBe(instance.id);

    // Verify it's gone
    const getRes = await app.request(`/${instance.id}`);
    expect(getRes.status).toBe(404);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/unknown", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("returns 409 for running instance", async () => {
    const createRes = await post("/", { name: "running" });
    const { instance } = await createRes.json();
    await app.request(`/${instance.id}/start`, { method: "POST" });
    const res = await app.request(`/${instance.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("Cannot delete");
  });
});

describe("POST /:id/start — start instance", () => {
  beforeEach(() => _resetStore());

  it("starts a created instance", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    const res = await app.request(`/${instance.id}/start`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.status).toBe("running");
    expect(data.instance.health.healthy).toBe(true);
    expect(data.instance.startedAt).toBeDefined();
  });

  it("starts a stopped instance", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    await app.request(`/${instance.id}/start`, { method: "POST" });
    await app.request(`/${instance.id}/stop`, { method: "POST" });
    const res = await app.request(`/${instance.id}/start`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.status).toBe("running");
  });

  it("returns 409 if already running", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    await app.request(`/${instance.id}/start`, { method: "POST" });
    const res = await app.request(`/${instance.id}/start`, { method: "POST" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already running");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/unknown/start", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("POST /:id/stop — stop instance", () => {
  beforeEach(() => _resetStore());

  it("stops a running instance", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    await app.request(`/${instance.id}/start`, { method: "POST" });
    const res = await app.request(`/${instance.id}/stop`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.status).toBe("stopped");
    expect(data.instance.health.healthy).toBe(false);
    expect(data.instance.stoppedAt).toBeDefined();
  });

  it("returns 409 for a created (not started) instance", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    const res = await app.request(`/${instance.id}/stop`, { method: "POST" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("not running");
  });

  it("returns 409 for already stopped instance", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    await app.request(`/${instance.id}/start`, { method: "POST" });
    await app.request(`/${instance.id}/stop`, { method: "POST" });
    const res = await app.request(`/${instance.id}/stop`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/unknown/stop", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("POST /:id/restart — restart instance", () => {
  beforeEach(() => _resetStore());

  it("restarts a running instance", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    await app.request(`/${instance.id}/start`, { method: "POST" });
    const res = await app.request(`/${instance.id}/restart`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.status).toBe("running");
    expect(data.instance.health.healthy).toBe(true);
  });

  it("restarts a stopped instance", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    await app.request(`/${instance.id}/start`, { method: "POST" });
    await app.request(`/${instance.id}/stop`, { method: "POST" });
    const res = await app.request(`/${instance.id}/restart`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.status).toBe("running");
  });

  it("returns 409 for a created instance", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    const res = await app.request(`/${instance.id}/restart`, { method: "POST" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("running or stopped");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/unknown/restart", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("GET /:id/logs — instance logs", () => {
  beforeEach(() => _resetStore());

  it("returns logs after creation", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    const res = await app.request(`/${instance.id}/logs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instanceId).toBe(instance.id);
    expect(data.logs.length).toBeGreaterThanOrEqual(1);
    expect(data.logs[0].message).toContain("created");
  });

  it("returns logs after lifecycle events", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    await app.request(`/${instance.id}/start`, { method: "POST" });
    await app.request(`/${instance.id}/stop`, { method: "POST" });
    const res = await app.request(`/${instance.id}/logs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    // created + starting + started + stopped = 4
    expect(data.logs.length).toBeGreaterThanOrEqual(4);
  });

  it("respects lines parameter", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    await app.request(`/${instance.id}/start`, { method: "POST" });
    await app.request(`/${instance.id}/stop`, { method: "POST" });
    const res = await app.request(`/${instance.id}/logs?lines=2`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs).toHaveLength(2);
  });

  it("filters by since timestamp", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    const futureTs = Date.now() + 100_000;
    const res = await app.request(`/${instance.id}/logs?since=${futureTs}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.logs).toHaveLength(0);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/unknown/logs");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid query params (lines=0)", async () => {
    const createRes = await post("/", { name: "bot" });
    const { instance } = await createRes.json();
    const res = await app.request(`/${instance.id}/logs?lines=0`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid query parameters");
  });
});
