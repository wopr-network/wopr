/**
 * Observability API routes
 *
 * Provides endpoints for metrics, logs, and health monitoring.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getStorage } from "../../storage/index.js";
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

async function getMetricsStore(): Promise<MetricsStore> {
  if (!metricsStore) {
    const storage = getStorage();
    metricsStore = await MetricsStore.create(storage);
  }
  return metricsStore;
}

// --- Metrics Routes ---

// GET /observability/metrics — platform-wide metrics summary
observabilityRouter.get(
  "/metrics",
  describeRoute({
    tags: ["Observability"],
    summary: "Platform-wide metrics summary",
    responses: {
      200: { description: "Aggregated platform metrics" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const store = await getMetricsStore();
    const summary = await store.getPlatformSummary();
    return c.json(summary);
  },
);

// GET /observability/instances/:id/metrics — per-instance metrics
observabilityRouter.get(
  "/instances/:id/metrics",
  describeRoute({
    tags: ["Observability"],
    summary: "Per-instance metrics summary",
    responses: {
      200: { description: "Instance metrics" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const instanceId = c.req.param("id");
    const store = await getMetricsStore();
    const summary = await store.getInstanceSummary(instanceId);
    return c.json(summary);
  },
);

// POST /observability/metrics — record a metric data point
observabilityRouter.post(
  "/metrics",
  describeRoute({
    tags: ["Observability"],
    summary: "Record a metric data point",
    responses: {
      201: { description: "Metric recorded" },
      400: { description: "name and value are required" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const body = await c.req.json();
    const { name, value, instance_id, tags } = body;

    if (!name || value === undefined) {
      return c.json({ error: "name and value are required" }, 400);
    }

    const store = await getMetricsStore();
    await store.record(name, value, instance_id ?? null, tags ?? {});
    return c.json({ recorded: true }, 201);
  },
);

// --- Logs Routes ---

// GET /observability/instances/:id/logs — instance logs with filters
observabilityRouter.get(
  "/instances/:id/logs",
  describeRoute({
    tags: ["Observability"],
    summary: "Instance logs with filters",
    responses: {
      200: { description: "Log entries for the instance" },
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
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
  },
);

// --- Health Routes ---

// GET /observability/health — platform health
observabilityRouter.get(
  "/health",
  describeRoute({
    tags: ["Observability"],
    summary: "Platform health status",
    responses: {
      200: { description: "Platform is healthy or degraded" },
      503: { description: "Platform is unhealthy" },
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const health = healthMonitor.getPlatformHealth();
    const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
    return c.json(health, statusCode);
  },
);

// GET /observability/instances/:id/health — per-instance health
observabilityRouter.get(
  "/instances/:id/health",
  describeRoute({
    tags: ["Observability"],
    summary: "Per-instance health status",
    responses: {
      200: { description: "Instance health details" },
      404: { description: "Instance not found" },
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const instanceId = c.req.param("id");
    const health = healthMonitor.getInstanceHealth(instanceId);

    if (!health) {
      return c.json({ error: "Instance not found" }, 404);
    }

    return c.json(health);
  },
);
