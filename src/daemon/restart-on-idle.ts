/**
 * Restart-on-Idle Manager
 *
 * Schedules graceful daemon restarts when idle.
 * Used for zero-downtime plugin activation.
 */

import { eventBus } from "../core/events.js";
import { queueManager } from "../core/queue/QueueManager.js";
import { logger } from "../logger.js";

export type RestartState = "IDLE" | "PENDING" | "DRAINING" | "RESTARTING" | "FORCED";

export interface RestartOnIdleConfig {
  /** How many seconds of no active message processing = "idle" */
  idleThresholdSeconds: number;
  /** Max wait time before force-restart (prevents infinite wait) */
  maxWaitSeconds: number;
  /** Stop accepting new messages immediately (drain mode) */
  drainMode: "graceful" | "force";
}

export interface RestartStatus {
  state: RestartState;
  pending: boolean;
  requestedAt: number | null;
  config: RestartOnIdleConfig | null;
  activeInjects: number;
  idleSeconds: number;
  estimatedRestartIn: string;
  batchedRequests: number;
}

const DEFAULT_CONFIG: RestartOnIdleConfig = {
  idleThresholdSeconds: 5,
  maxWaitSeconds: 300,
  drainMode: "graceful",
};

export class RestartOnIdleManager {
  private state: RestartState = "IDLE";
  private requestedAt: number | null = null;
  private lastIdleSince: number | null = null;
  private config: RestartOnIdleConfig | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private batchedRequests = 0;
  private onRestartCallback: (() => void) | null = null;

  /**
   * Schedule a restart when idle.
   * Multiple rapid calls are batched.
   */
  async scheduleRestart(config?: Partial<RestartOnIdleConfig>): Promise<RestartStatus> {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    // If already pending, increment batch counter and update config
    if (this.state === "PENDING" || this.state === "DRAINING") {
      this.batchedRequests++;
      this.requestedAt = Date.now();
      this.config = finalConfig;
      logger.info(
        `[restart-on-idle] Batching request ${this.batchedRequests} - will restart once when idle (max wait reset)`,
      );
      return this.getStatus();
    }

    // If a restart is already in progress, reject
    if (this.state === "RESTARTING" || this.state === "FORCED") {
      throw new Error("Restart already in progress");
    }

    // Start new restart request
    this.state = "PENDING";
    this.requestedAt = Date.now();
    this.lastIdleSince = null;
    this.config = finalConfig;
    this.batchedRequests = 1;

    logger.info(
      `[restart-on-idle] Restart scheduled: idle=${finalConfig.idleThresholdSeconds}s, maxWait=${finalConfig.maxWaitSeconds}s, drain=${finalConfig.drainMode}`,
    );

    // Emit system event
    await eventBus.emit(
      "system:restartScheduled",
      {
        requestedAt: this.requestedAt,
        idleThresholdSeconds: finalConfig.idleThresholdSeconds,
        maxWaitSeconds: finalConfig.maxWaitSeconds,
        batchedRequests: this.batchedRequests,
      },
      "core",
    );

    // Start idle check loop (ensures only one timer runs)
    this.startIdleCheck();

    return this.getStatus();
  }

  /**
   * Get current restart status
   */
  getStatus(): RestartStatus {
    const activeStats = queueManager.getActiveStats();
    const activeInjects = activeStats.size;
    const idleSeconds = this.lastIdleSince ? (Date.now() - this.lastIdleSince) / 1000 : 0;

    let estimatedRestartIn = "unknown";
    if (this.state === "PENDING" || this.state === "DRAINING") {
      if (activeInjects === 0 && this.config && this.lastIdleSince) {
        const remainingIdle = Math.max(0, this.config.idleThresholdSeconds - idleSeconds);
        estimatedRestartIn = remainingIdle < 1 ? "< 1s" : `~${Math.ceil(remainingIdle)}s`;
      } else if (this.config && this.requestedAt) {
        const elapsed = (Date.now() - this.requestedAt) / 1000;
        const maxWait = this.config.maxWaitSeconds;
        const remaining = Math.max(0, maxWait - elapsed);
        estimatedRestartIn = `< ${Math.ceil(remaining)}s (max wait)`;
      }
    }

    return {
      state: this.state,
      pending: this.state === "PENDING" || this.state === "DRAINING",
      requestedAt: this.requestedAt,
      config: this.config,
      activeInjects,
      idleSeconds,
      estimatedRestartIn,
      batchedRequests: this.batchedRequests,
    };
  }

  /**
   * Cancel pending restart
   */
  cancel(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.state = "IDLE";
    this.requestedAt = null;
    this.lastIdleSince = null;
    this.config = null;
    this.batchedRequests = 0;
    logger.info("[restart-on-idle] Restart cancelled");
  }

  /**
   * Set callback to execute when restart is triggered
   */
  onRestart(callback: () => void): void {
    this.onRestartCallback = callback;
  }

  /**
   * Start idle check loop (polls every second)
   */
  private startIdleCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.checkIdleAndRestart();
    }, 1000);
  }

  /**
   * Check if idle and trigger restart if conditions met
   */
  private checkIdleAndRestart(): void {
    if (!this.config || !this.requestedAt) return;

    const now = Date.now();
    const elapsed = (now - this.requestedAt) / 1000;
    const activeStats = queueManager.getActiveStats();
    const activeInjects = activeStats.size;

    // Check for force restart on max wait exceeded
    if (elapsed >= this.config.maxWaitSeconds) {
      logger.warn(
        `[restart-on-idle] Max wait (${this.config.maxWaitSeconds}s) exceeded with ${activeInjects} active injects - forcing restart`,
      );
      this.state = "FORCED";
      this.triggerRestart();
      return;
    }

    // Check for graceful restart when idle
    if (activeInjects === 0) {
      // No active injects - set lastIdleSince if not already set
      if (this.lastIdleSince === null) {
        this.lastIdleSince = now;
        logger.debug("[restart-on-idle] System now idle, starting idle timer");
      }

      // Check if we've been idle long enough
      const idleDuration = (now - this.lastIdleSince) / 1000;
      if (idleDuration >= this.config.idleThresholdSeconds) {
        logger.info(
          `[restart-on-idle] Idle threshold met (${this.config.idleThresholdSeconds}s) - restarting`,
        );
        this.state = "RESTARTING";
        this.triggerRestart();
      }
    } else {
      // Still processing - reset idle timer
      this.lastIdleSince = null;

      // Update state to draining if in force mode
      if (this.config.drainMode === "force" && this.state === "PENDING") {
        this.state = "DRAINING";
        logger.info(
          `[restart-on-idle] Draining mode: ${activeInjects} active inject(s), waiting for completion`,
        );
      }
    }
  }

  /**
   * Trigger the actual restart
   */
  private triggerRestart(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    logger.info(
      `[restart-on-idle] Triggering restart (batched ${this.batchedRequests} request(s))`,
    );

    if (this.onRestartCallback) {
      this.onRestartCallback();
    }
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

// Singleton instance
export const restartOnIdleManager = new RestartOnIdleManager();
