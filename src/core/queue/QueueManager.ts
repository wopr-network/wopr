/**
 * QueueManager - Manages all session queues
 *
 * Central coordinator for inject queues across all sessions.
 * Provides unified interface for queueing, cancellation, and monitoring.
 */

import { logger } from "../../logger.js";
import { SessionQueue } from "./SessionQueue.js";
import type { InjectOptions, InjectResult, MultimodalMessage, QueueEventHandler, QueueStats } from "./types.js";

export class QueueManager {
  private queues = new Map<string, SessionQueue>();
  private lastActivityMs = new Map<string, number>();
  private globalEventHandlers = new Set<QueueEventHandler>();

  /** Function to execute an inject - set via setExecutor */
  private executeInject?: (
    sessionKey: string,
    message: string | MultimodalMessage,
    options: InjectOptions | undefined,
    abortSignal: AbortSignal,
  ) => Promise<InjectResult>;

  /**
   * Set the inject executor function
   * Must be called before any inject operations
   */
  setExecutor(
    executor: (
      sessionKey: string,
      message: string | MultimodalMessage,
      options: InjectOptions | undefined,
      abortSignal: AbortSignal,
    ) => Promise<InjectResult>,
  ): void {
    this.executeInject = executor;
    logger.info("[queue-manager] Executor set");
  }

  /**
   * Get or create a queue for a session
   */
  private getQueue(sessionKey: string): SessionQueue {
    if (!this.executeInject) {
      throw new Error("QueueManager: executor not set. Call setExecutor() first.");
    }

    let queue = this.queues.get(sessionKey);
    if (!queue) {
      queue = new SessionQueue(sessionKey, this.executeInject);

      // Forward events to global handlers
      queue.on((event) => {
        for (const handler of this.globalEventHandlers) {
          try {
            handler(event);
          } catch (e) {
            logger.error({ msg: "[queue-manager] Global handler error", error: String(e) });
          }
        }
      });

      this.queues.set(sessionKey, queue);
      logger.info({ msg: "[queue-manager] Created queue for session", sessionKey });
    }
    this.lastActivityMs.set(sessionKey, Date.now());
    return queue;
  }

  /**
   * Queue an inject for a session
   * This is the main entry point for all inject operations
   */
  async inject(
    sessionKey: string,
    message: string | MultimodalMessage,
    options?: InjectOptions,
  ): Promise<InjectResult> {
    const queue = this.getQueue(sessionKey);
    return queue.enqueue(message, options);
  }

  /**
   * Cancel the active inject for a session
   */
  cancelActive(sessionKey: string): boolean {
    const queue = this.queues.get(sessionKey);
    return queue?.cancelActive() ?? false;
  }

  /**
   * Cancel all queued (not yet started) injects for a session
   */
  cancelQueued(sessionKey: string): number {
    const queue = this.queues.get(sessionKey);
    return queue?.cancelQueued() ?? 0;
  }

  /**
   * Cancel everything for a session
   */
  cancelAll(sessionKey: string): { active: boolean; queued: number } {
    const queue = this.queues.get(sessionKey);
    return queue?.cancelAll() ?? { active: false, queued: 0 };
  }

  /**
   * Cancel all injects across all sessions
   */
  cancelEverything(): Map<string, { active: boolean; queued: number }> {
    const results = new Map<string, { active: boolean; queued: number }>();
    for (const [sessionKey, queue] of this.queues) {
      results.set(sessionKey, queue.cancelAll());
    }
    return results;
  }

  /**
   * Check if a session has an active inject
   */
  isActive(sessionKey: string): boolean {
    return this.queues.get(sessionKey)?.isActive() ?? false;
  }

  /**
   * Check if a session has queued items
   */
  hasQueued(sessionKey: string): boolean {
    return this.queues.get(sessionKey)?.hasQueued() ?? false;
  }

  /**
   * Check if a session has any pending work (active or queued)
   */
  hasPending(sessionKey: string): boolean {
    const queue = this.queues.get(sessionKey);
    return queue ? queue.isActive() || queue.hasQueued() : false;
  }

  /**
   * Get stats for a specific session
   */
  getStats(sessionKey: string): QueueStats | null {
    return this.queues.get(sessionKey)?.getStats() ?? null;
  }

  /**
   * Get stats for all sessions
   */
  getAllStats(): Map<string, QueueStats> {
    const stats = new Map<string, QueueStats>();
    for (const [sessionKey, queue] of this.queues) {
      stats.set(sessionKey, queue.getStats());
    }
    return stats;
  }

  /**
   * Get stats only for active sessions (sessions with work)
   */
  getActiveStats(): Map<string, QueueStats> {
    const stats = new Map<string, QueueStats>();
    for (const [sessionKey, queue] of this.queues) {
      if (queue.isActive() || queue.hasQueued()) {
        stats.set(sessionKey, queue.getStats());
      }
    }
    return stats;
  }

  /**
   * Subscribe to events from all queues
   */
  on(handler: QueueEventHandler): () => void {
    this.globalEventHandlers.add(handler);
    return () => this.globalEventHandlers.delete(handler);
  }

  /**
   * Clean up inactive queues (no pending work, idle for a while)
   * Call periodically to prevent memory leaks
   */
  cleanup(maxIdleMs: number = 5 * 60 * 1000): number {
    let cleaned = 0;
    const now = Date.now();
    for (const [sessionKey, queue] of this.queues) {
      const stats = queue.getStats();
      if (!stats.isProcessing && stats.queueDepth === 0) {
        const lastActivity = this.lastActivityMs.get(sessionKey) ?? 0;
        if (now - lastActivity >= maxIdleMs) {
          this.queues.delete(sessionKey);
          this.lastActivityMs.delete(sessionKey);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      logger.info({ msg: "[queue-manager] Cleaned up idle queues", count: cleaned });
    }
    return cleaned;
  }

  /**
   * Get the total number of active queues
   */
  get queueCount(): number {
    return this.queues.size;
  }
}

// Singleton instance
export const queueManager = new QueueManager();
