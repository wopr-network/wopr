/**
 * SessionQueue - FIFO queue for a single session
 *
 * Manages ordered execution of inject requests for one session.
 * Supports priority ordering and cancellation.
 */

import { logger } from "../../logger.js";
import type {
  ActiveInject,
  InjectOptions,
  InjectResult,
  MultimodalMessage,
  QueuedInject,
  QueueEvent,
  QueueEventHandler,
  QueueStats,
} from "./types.js";

let injectIdCounter = 0;
function generateInjectId(): string {
  return `inject-${Date.now()}-${++injectIdCounter}`;
}

export class SessionQueue {
  private readonly sessionKey: string;
  private readonly queue: QueuedInject[] = [];
  private active: ActiveInject | null = null;
  private processing = false;
  private eventHandlers: Set<QueueEventHandler> = new Set();

  /** Function to execute an inject - injected to avoid circular deps */
  private executeInject: (
    sessionKey: string,
    message: string | MultimodalMessage,
    options: InjectOptions | undefined,
    abortSignal: AbortSignal,
  ) => Promise<InjectResult>;

  constructor(
    sessionKey: string,
    executeInject: (
      sessionKey: string,
      message: string | MultimodalMessage,
      options: InjectOptions | undefined,
      abortSignal: AbortSignal,
    ) => Promise<InjectResult>,
  ) {
    this.sessionKey = sessionKey;
    this.executeInject = executeInject;
  }

  /**
   * Add an inject request to the queue
   */
  enqueue(message: string | MultimodalMessage, options?: InjectOptions): Promise<InjectResult> {
    return new Promise((resolve, reject) => {
      const id = generateInjectId();
      const abortController = new AbortController();

      const item: QueuedInject = {
        id,
        sessionKey: this.sessionKey,
        message,
        options,
        priority: options?.priority ?? 0,
        queuedAt: Date.now(),
        resolve,
        reject,
        abortController,
      };

      // Insert by priority (higher priority first)
      const insertIndex = this.queue.findIndex((q) => q.priority < item.priority);
      if (insertIndex === -1) {
        this.queue.push(item);
      } else {
        this.queue.splice(insertIndex, 0, item);
      }

      this.emit({
        type: "enqueue",
        sessionKey: this.sessionKey,
        injectId: id,
        timestamp: Date.now(),
        data: { queueDepth: this.queue.length, priority: item.priority },
      });

      logger.info({
        msg: "[queue] Enqueued inject",
        sessionKey: this.sessionKey,
        injectId: id,
        queueDepth: this.queue.length,
        priority: item.priority,
      });

      // Start processing if not already
      this.processNext();
    });
  }

  /**
   * Process the next item in the queue
   */
  private async processNext(): Promise<void> {
    // Already processing or queue empty
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      this.emit({
        type: "dequeue",
        sessionKey: this.sessionKey,
        injectId: item.id,
        timestamp: Date.now(),
        data: { queueDepth: this.queue.length },
      });

      // Check if cancelled before we even start
      if (item.abortController.signal.aborted) {
        item.reject(new Error("Inject cancelled before start"));
        continue;
      }

      // Set as active
      this.active = {
        id: item.id,
        sessionKey: this.sessionKey,
        startTime: Date.now(),
        abortController: item.abortController,
      };

      this.emit({
        type: "start",
        sessionKey: this.sessionKey,
        injectId: item.id,
        timestamp: Date.now(),
        data: { waitTime: Date.now() - item.queuedAt },
      });

      logger.info({
        msg: "[queue] Starting inject",
        sessionKey: this.sessionKey,
        injectId: item.id,
        waitTime: Date.now() - item.queuedAt,
      });

      try {
        // No hard timeout here - the executor has its own idle timeout
        // that resets on each message. This allows long-running injects
        // as long as they're making progress.
        const result = await this.executeInject(
          this.sessionKey,
          item.message,
          item.options,
          item.abortController.signal,
        );

        this.emit({
          type: "complete",
          sessionKey: this.sessionKey,
          injectId: item.id,
          timestamp: Date.now(),
          data: { duration: Date.now() - this.active.startTime },
        });

        logger.info({
          msg: "[queue] Inject complete",
          sessionKey: this.sessionKey,
          injectId: item.id,
          duration: Date.now() - this.active.startTime,
        });

        item.resolve(result);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isCancelled = item.abortController.signal.aborted || errorMsg.toLowerCase().includes("cancel");

        this.emit({
          type: isCancelled ? "cancel" : "error",
          sessionKey: this.sessionKey,
          injectId: item.id,
          timestamp: Date.now(),
          data: { error: errorMsg },
        });

        logger.error({
          msg: "[queue] Inject failed",
          sessionKey: this.sessionKey,
          injectId: item.id,
          error: errorMsg,
          cancelled: isCancelled,
        });

        item.reject(error instanceof Error ? error : new Error(errorMsg));
      } finally {
        this.active = null;
      }
    }

    this.processing = false;
  }

  /**
   * Cancel the active inject
   */
  cancelActive(): boolean {
    if (this.active) {
      this.active.abortController.abort();
      logger.info({
        msg: "[queue] Cancelled active inject",
        sessionKey: this.sessionKey,
        injectId: this.active.id,
      });
      return true;
    }
    return false;
  }

  /**
   * Cancel all queued (but not yet started) injects
   */
  cancelQueued(): number {
    const count = this.queue.length;
    for (const item of this.queue) {
      item.abortController.abort();
      item.reject(new Error("Inject cancelled - queue cleared"));
    }
    this.queue.length = 0;
    logger.info({
      msg: "[queue] Cancelled all queued injects",
      sessionKey: this.sessionKey,
      count,
    });
    return count;
  }

  /**
   * Cancel everything - active and queued
   */
  cancelAll(): { active: boolean; queued: number } {
    const activeWasCancelled = this.cancelActive();
    const queuedCount = this.cancelQueued();
    return { active: activeWasCancelled, queued: queuedCount };
  }

  /**
   * Check if there's an active inject
   */
  isActive(): boolean {
    return this.active !== null;
  }

  /**
   * Check if there are queued items
   */
  hasQueued(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return {
      sessionKey: this.sessionKey,
      queueDepth: this.queue.length,
      isProcessing: this.processing,
      activeInjectId: this.active?.id,
      activeInjectDuration: this.active ? Date.now() - this.active.startTime : undefined,
      oldestQueuedAt: this.queue[0]?.queuedAt,
    };
  }

  /**
   * Subscribe to queue events
   */
  on(handler: QueueEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: QueueEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        logger.error({ msg: "[queue] Event handler error", error: String(e) });
      }
    }
  }
}
