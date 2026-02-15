/**
 * Restart-on-Idle Routes
 *
 * API endpoints for scheduling graceful daemon restarts.
 */

import { Hono } from "hono";
import { logger } from "../../logger.js";
import { restartOnIdleManager } from "../restart-on-idle.js";

export const restartRouter = new Hono();

/**
 * POST /api/daemon/restart-on-idle
 * Schedule a restart when daemon becomes idle
 */
restartRouter.post("/restart-on-idle", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { idleThresholdSeconds, maxWaitSeconds, drainMode } = body;

    const config = {
      ...(idleThresholdSeconds !== undefined && { idleThresholdSeconds: Number(idleThresholdSeconds) }),
      ...(maxWaitSeconds !== undefined && { maxWaitSeconds: Number(maxWaitSeconds) }),
      ...(drainMode !== undefined && { drainMode: String(drainMode) as "graceful" | "force" }),
    };

    const status = restartOnIdleManager.scheduleRestart(config);

    logger.info(`[restart-api] Restart scheduled via API: ${JSON.stringify(status)}`);

    return c.json({
      success: true,
      status: status.state,
      estimatedRestartIn: status.estimatedRestartIn,
      batchedRequests: status.batchedRequests,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[restart-api] Failed to schedule restart: ${errMsg}`);
    return c.json({ success: false, error: errMsg }, 500);
  }
});

/**
 * GET /api/daemon/restart-status
 * Get current restart status
 */
restartRouter.get("/restart-status", (c) => {
  const status = restartOnIdleManager.getStatus();
  return c.json({
    pending: status.pending,
    state: status.state,
    requestedAt: status.requestedAt,
    config: status.config,
    activeInjects: status.activeInjects,
    idleSeconds: Math.round(status.idleSeconds * 10) / 10,
    estimatedRestartIn: status.estimatedRestartIn,
    batchedRequests: status.batchedRequests,
  });
});

/**
 * DELETE /api/daemon/restart-on-idle
 * Cancel pending restart
 */
restartRouter.delete("/restart-on-idle", (c) => {
  restartOnIdleManager.cancel();
  logger.info("[restart-api] Restart cancelled via API");
  return c.json({ success: true, status: "cancelled" });
});
