/**
 * Observability API routes
 *
 * Provides endpoints for logs and health monitoring.
 * Metrics routes are now provided by @wopr-network/wopr-plugin-metrics.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { type GetLogsOptions, getInstanceLogs, healthMonitor, type LogLevel } from "../observability/index.js";

export const observabilityRouter = new Hono();

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
