/**
 * Instance CRUD REST endpoints (WOP-202)
 *
 * Control plane HTTP routes for managing WOPR instances:
 * create, list, get, update, delete, start, stop, restart, logs.
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { logger } from "../../logger.js";

// ============================================================================
// Types
// ============================================================================

export type InstanceStatus = "created" | "starting" | "running" | "stopping" | "stopped" | "error";

export interface Instance {
  id: string;
  name: string;
  status: InstanceStatus;
  template?: string;
  config: Record<string, unknown>;
  health: {
    healthy: boolean;
    lastCheck?: number;
    message?: string;
  };
  plugins: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  stoppedAt?: number;
}

export interface InstanceLogEntry {
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

const CreateInstanceSchema = z.object({
  name: z.string().min(1, "Name is required").max(128),
  template: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  plugins: z.array(z.string()).optional(),
});

const UpdateInstanceSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  plugins: z.array(z.string()).optional(),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(["created", "starting", "running", "stopping", "stopped", "error"]).optional(),
  template: z.string().optional(),
});

const LogsQuerySchema = z.object({
  lines: z.coerce.number().int().min(1).max(10000).optional().default(100),
  since: z.coerce.number().optional(),
});

// ============================================================================
// In-memory store (will be replaced by persistent storage)
// ============================================================================

const instances = new Map<string, Instance>();
const instanceLogs = new Map<string, InstanceLogEntry[]>();

/** Visible for testing — resets all in-memory state. */
export function _resetStore(): void {
  instances.clear();
  instanceLogs.clear();
}

const MAX_LOG_ENTRIES = 10_000;

function appendLog(id: string, level: InstanceLogEntry["level"], message: string): void {
  let logs = instanceLogs.get(id);
  if (!logs) {
    logs = [];
    instanceLogs.set(id, logs);
  }
  logs.push({ ts: Date.now(), level, message });
  if (logs.length > MAX_LOG_ENTRIES) {
    const excess = logs.length - MAX_LOG_ENTRIES;
    logs.splice(0, excess);
  }
}

// ============================================================================
// Templates (simple built-in set; extensible later)
// ============================================================================

const TEMPLATES: Record<string, { config: Record<string, unknown>; plugins: string[] }> = {
  default: { config: {}, plugins: [] },
  chat: { config: { mode: "chat" }, plugins: ["wopr-plugin-discord"] },
  agent: { config: { mode: "agent", autonomous: true }, plugins: [] },
};

// ============================================================================
// Router
// ============================================================================

export const instancesRouter = new Hono();

// POST /api/instances — Create instance
instancesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = CreateInstanceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const { name, template, config: userConfig, plugins: userPlugins } = parsed.data;

  // Resolve template if provided
  let baseConfig: Record<string, unknown> = {};
  let basePlugins: string[] = [];
  if (template) {
    const tpl = TEMPLATES[template];
    if (!tpl) {
      return c.json({ error: `Unknown template: ${template}` }, 400);
    }
    baseConfig = { ...tpl.config };
    basePlugins = [...tpl.plugins];
  }

  const id = randomUUID();
  const now = Date.now();

  const instance: Instance = {
    id,
    name,
    status: "created",
    template: template ?? undefined,
    config: { ...baseConfig, ...userConfig },
    health: { healthy: false },
    plugins: userPlugins ?? basePlugins,
    createdAt: now,
    updatedAt: now,
  };

  instances.set(id, instance);
  appendLog(id, "info", `Instance "${name}" created`);
  logger.info({ msg: "[instances] Created", id, name });

  return c.json({ instance }, 201);
});

// GET /api/instances — List instances
instancesRouter.get("/", (c) => {
  const query = ListQuerySchema.safeParse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
    status: c.req.query("status"),
    template: c.req.query("template"),
  });

  if (!query.success) {
    return c.json({ error: "Invalid query parameters", details: query.error.issues }, 400);
  }

  const { limit, offset, status, template } = query.data;
  let items = Array.from(instances.values());

  // Filter
  if (status) {
    items = items.filter((i) => i.status === status);
  }
  if (template) {
    items = items.filter((i) => i.template === template);
  }

  const total = items.length;

  // Sort newest first
  items.sort((a, b) => b.createdAt - a.createdAt);

  // Paginate
  items = items.slice(offset, offset + limit);

  return c.json({ instances: items, total, limit, offset });
});

// GET /api/instances/:id — Instance detail
instancesRouter.get("/:id", (c) => {
  const id = c.req.param("id");
  const instance = instances.get(id);
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }
  return c.json({ instance });
});

// PATCH /api/instances/:id — Update instance config
instancesRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const instance = instances.get(id);
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = UpdateInstanceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const { name, config, plugins } = parsed.data;

  if (name !== undefined) instance.name = name;
  if (config !== undefined) instance.config = { ...instance.config, ...config };
  if (plugins !== undefined) instance.plugins = plugins;
  instance.updatedAt = Date.now();

  appendLog(id, "info", "Instance config updated");

  return c.json({ instance });
});

// DELETE /api/instances/:id — Destroy instance
instancesRouter.delete("/:id", (c) => {
  const id = c.req.param("id");
  const instance = instances.get(id);
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  if (instance.status === "running" || instance.status === "starting" || instance.status === "stopping") {
    return c.json({ error: "Cannot delete a running instance. Stop it first." }, 409);
  }

  instances.delete(id);
  instanceLogs.delete(id);
  logger.info({ msg: "[instances] Deleted", id });

  return c.json({ deleted: true, id });
});

// POST /api/instances/:id/start — Start instance
instancesRouter.post("/:id/start", (c) => {
  const id = c.req.param("id");
  const instance = instances.get(id);
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  if (instance.status === "running") {
    return c.json({ error: "Instance is already running" }, 409);
  }
  if (instance.status === "starting") {
    return c.json({ error: "Instance is already starting" }, 409);
  }

  instance.status = "starting";
  instance.updatedAt = Date.now();
  appendLog(id, "info", "Instance starting");

  instance.status = "running";
  instance.startedAt = Date.now();
  instance.updatedAt = Date.now();
  instance.health = { healthy: true, lastCheck: Date.now() };

  appendLog(id, "info", "Instance started");

  return c.json({ instance });
});

// POST /api/instances/:id/stop — Stop instance
instancesRouter.post("/:id/stop", (c) => {
  const id = c.req.param("id");
  const instance = instances.get(id);
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  if (instance.status === "stopped" || instance.status === "created") {
    return c.json({ error: "Instance is not running" }, 409);
  }

  instance.status = "stopped";
  instance.stoppedAt = Date.now();
  instance.updatedAt = Date.now();
  instance.health = { healthy: false, lastCheck: Date.now(), message: "Stopped" };

  appendLog(id, "info", "Instance stopped");

  return c.json({ instance });
});

// POST /api/instances/:id/restart — Restart instance
instancesRouter.post("/:id/restart", (c) => {
  const id = c.req.param("id");
  const instance = instances.get(id);
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  if (instance.status !== "running" && instance.status !== "stopped") {
    return c.json({ error: "Can only restart a running or stopped instance" }, 409);
  }

  instance.status = "starting";
  instance.updatedAt = Date.now();
  appendLog(id, "info", "Instance restarting");

  instance.status = "running";
  instance.startedAt = Date.now();
  instance.updatedAt = Date.now();
  instance.health = { healthy: true, lastCheck: Date.now() };

  appendLog(id, "info", "Instance restarted");

  return c.json({ instance });
});

// GET /api/instances/:id/logs — Instance logs
instancesRouter.get("/:id/logs", (c) => {
  const id = c.req.param("id");
  const instance = instances.get(id);
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  const query = LogsQuerySchema.safeParse({
    lines: c.req.query("lines"),
    since: c.req.query("since"),
  });

  if (!query.success) {
    return c.json({ error: "Invalid query parameters", details: query.error.issues }, 400);
  }

  const { lines, since } = query.data;
  let logs = instanceLogs.get(id) ?? [];

  // Take last N lines first, then filter by timestamp
  logs = logs.slice(-lines);

  if (since) {
    logs = logs.filter((l) => l.ts >= since);
  }

  return c.json({ instanceId: id, logs, count: logs.length });
});
