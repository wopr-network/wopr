/**
 * Observability API routes
 *
 * Provides endpoints for metrics, logs, and health monitoring.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { WOPR_HOME } from "../../paths.js";
import {
  type GetLogsOptions,
  getInstanceLogs,
  healthMonitor,
  type LogLevel,
  MetricsStore,
} from "../observability/index.js";

export const observabilityRouter = new Hono();

// Lazily initialize the metrics store
let metricsStore: MetricsStore | null = null;

function getMetricsStore(): MetricsStore {
  if (!metricsStore) {
    const metricsDir = join(WOPR_HOME, "metrics");
    mkdirSync(metricsDir, { recursive: true });
    metricsStore = new MetricsStore(join(metricsDir, "metrics.sqlite"));
  }
  return metricsStore;
}

// --- Metrics Routes ---

// GET /observability/metrics — platform-wide metrics summary
observabilityRouter.get("/metrics", (c) => {
  const store = getMetricsStore();
  const summary = store.getPlatformSummary();
  return c.json(summary);
});

// GET /observability/instances/:id/metrics — per-instance metrics
observabilityRouter.get("/instances/:id/metrics", (c) => {
  const instanceId = c.req.param("id");
  const store = getMetricsStore();
  const summary = store.getInstanceSummary(instanceId);
  return c.json(summary);
});

// POST /observability/metrics — record a metric data point
observabilityRouter.post("/metrics", async (c) => {
  const body = await c.req.json();
  const { name, value, instance_id, tags } = body;

  if (!name || value === undefined) {
    return c.json({ error: "name and value are required" }, 400);
  }

  const store = getMetricsStore();
  store.record(name, value, instance_id ?? null, tags ?? {});
  return c.json({ recorded: true }, 201);
});

// --- Logs Routes ---

// GET /observability/instances/:id/logs — instance logs with filters
observabilityRouter.get("/instances/:id/logs", (c) => {
  const instanceId = c.req.param("id");
  const level = c.req.query("level") as LogLevel | undefined;
  const limitParam = c.req.query("limit");
  const since = c.req.query("since");

  const options: GetLogsOptions = {};
  if (level) options.level = level;
  if (limitParam) options.limit = parseInt(limitParam, 10);
  if (since) options.since = since;

  const logs = getInstanceLogs(instanceId, options);
  return c.json({
    instance_id: instanceId,
    logs,
    count: logs.length,
  });
});

// --- Health Routes ---

// GET /observability/health — platform health
observabilityRouter.get("/health", (c) => {
  const health = healthMonitor.getPlatformHealth();
  const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
  return c.json(health, statusCode);
});

// GET /observability/instances/:id/health — per-instance health
observabilityRouter.get("/instances/:id/health", (c) => {
  const instanceId = c.req.param("id");
  const health = healthMonitor.getInstanceHealth(instanceId);

  if (!health) {
    return c.json({ error: "Instance not found" }, 404);
  }

  return c.json(health);
});

/**
 * Close the metrics store (for clean shutdown).
 */
export function closeMetricsStore(): void {
  if (metricsStore) {
    metricsStore.close();
    metricsStore = null;
  }
}
