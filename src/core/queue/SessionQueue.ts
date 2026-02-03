/**
 * SessionQueue - FIFO queue for a single session
 *
 * Manages ordered execution of inject requests for one session.
 * Supports priority ordering, cancellation, and V2 active session injection.
 */

import { logger } from "../../logger.js";
import type {
  QueuedInject,
  ActiveInject,
  InjectResult,
  InjectOptions,
  MultimodalMessage,
  QueueStats,
  QueueEvent,
  QueueEventHandler,
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
    abortSignal: AbortSignal
  ) => Promise<InjectResult>;

  /** Optional V2 injector for active sessions */
  private v2Injector?: (
    sessionKey: string,
    message: string | MultimodalMessage
  ) => Promise<void>;

  constructor(
    sessionKey: string,
    executeInject: (
      sessionKey: string,
      message: string | MultimodalMessage,
      options: InjectOptions | undefined,
      abortSignal: AbortSignal
    ) => Promise<InjectResult>,
    v2Injector?: (sessionKey: string, message: string | MultimodalMessage) => Promise<void>
  ) {
    this.sessionKey = sessionKey;
    this.executeInject = executeInject;
    this.v2Injector = v2Injector;
  }

  /**
   * Add an inject request to the queue
   */
  enqueue(
    message: string | MultimodalMessage,
    options?: InjectOptions
  ): Promise<InjectResult> {
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
      const insertIndex = this.queue.findIndex(q => q.priority < item.priority);
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
   * Try V2 injection into active session (if supported and active)
   * Returns true if V2 injection succeeded, false if should use normal queue
   */
  async tryV2Inject(
    message: string | MultimodalMessage,
    options?: InjectOptions
  ): Promise<{ success: boolean; result?: InjectResult }> {
    // Check if V2 is enabled and there's an active session
    if (!this.v2Injector || !this.active || options?.allowV2Inject === false) {
      return { success: false };
    }

    try {
      logger.info({
        msg: "[queue] Attempting V2 inject into active session",
        sessionKey: this.sessionKey,
        activeInjectId: this.active.id,
      });

      await this.v2Injector(this.sessionKey, message);

      this.emit({
        type: "v2-inject",
        sessionKey: this.sessionKey,
        injectId: this.active.id,
        timestamp: Date.now(),
      });

      // V2 inject doesn't return a response - it flows through the original stream
      return {
        success: true,
        result: { response: "", sessionId: this.active.id, cost: 0 },
      };
    } catch (error) {
      logger.warn({
        msg: "[queue] V2 inject failed, will use normal queue",
        sessionKey: this.sessionKey,
        error: String(error),
      });
      return { success: false };
    }
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
      const item = this.queue.shift()!;

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
        const result = await this.executeInject(
          this.sessionKey,
          item.message,
          item.options,
          item.abortController.signal
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
        const isCancelled = item.abortController.signal.aborted ||
          errorMsg.toLowerCase().includes("cancel");

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
      activeInjectDuration: this.active
        ? Date.now() - this.active.startTime
        : undefined,
      oldestQueuedAt: this.queue[0]?.queuedAt,
    };
  }

  /**
   * Set the active query generator (for V2 injection support)
   */
  setActiveQueryGenerator(generator: AsyncGenerator<unknown>): void {
    if (this.active) {
      this.active.queryGenerator = generator;
    }
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
