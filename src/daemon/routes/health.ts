/**
 * /healthz endpoint - Comprehensive instance health report.
 *
 * This route is unauthenticated (like /health and /ready) so that
 * external monitoring systems can poll it without credentials.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { HealthMonitor } from "../health.js";

export function createHealthzRouter(monitor: HealthMonitor): Hono {
  const router = new Hono();

  router.get(
    "/",
    describeRoute({
      tags: ["Health"],
      summary: "Comprehensive health check",
      responses: {
        200: { description: "Daemon is healthy" },
        503: { description: "Daemon is unhealthy" },
      },
    }),
    async (c) => {
      const snapshot = await monitor.check();
      const statusCode = snapshot.status === "unhealthy" ? 503 : 200;
      return c.json(snapshot, statusCode);
    },
  );

  router.get(
    "/history",
    describeRoute({
      tags: ["Health"],
      summary: "Health check history",
      responses: {
        200: { description: "Recent health check results" },
      },
    }),
    (c) => {
      const limitParam = c.req.query("limit");
      const parsedLimit = limitParam ? parseInt(limitParam, 10) : undefined;
      const limit =
        parsedLimit !== undefined && !Number.isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
      const history = monitor.getHistory(limit);
      return c.json({ history });
    },
  );

  return router;
}
