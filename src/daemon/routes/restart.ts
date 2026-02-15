/**
 * Restart-on-Idle Routes
 *
 * API endpoints for scheduling graceful daemon restarts.
 */

import { Hono } from "hono";
import { z } from "zod";
import { logger } from "../../logger.js";
import { requireAuth } from "../middleware/auth.js";
import { restartOnIdleManager } from "../restart-on-idle.js";

const RestartRequestSchema = z.object({
  idleThresholdSeconds: z.number().optional(),
  maxWaitSeconds: z.number().optional(),
  drainMode: z.enum(["graceful", "force"]).optional(),
});

export const restartRouter = new Hono();

/**
 * POST /api/daemon/restart-on-idle
 * Schedule a restart when daemon becomes idle
 */
restartRouter.post("/restart-on-idle", requireAuth(), async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = RestartRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ success: false, error: "Invalid request body", details: parsed.error.issues }, 400);
    }

    const { idleThresholdSeconds, maxWaitSeconds, drainMode } = parsed.data;

    const config = {
      ...(idleThresholdSeconds !== undefined && { idleThresholdSeconds }),
      ...(maxWaitSeconds !== undefined && { maxWaitSeconds }),
      ...(drainMode !== undefined && { drainMode }),
    };

    const status = await restartOnIdleManager.scheduleRestart(config);

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
restartRouter.get("/restart-status", requireAuth(), (c) => {
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
restartRouter.delete("/restart-on-idle", requireAuth(), (c) => {
  restartOnIdleManager.cancel();
  logger.info("[restart-api] Restart cancelled via API");
  return c.json({ success: true, status: "cancelled" });
});
