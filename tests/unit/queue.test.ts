/**
 * Queue System Tests (WOP-12)
 *
 * Tests SessionQueue FIFO ordering, priority, cancellation,
 * event emission, and QueueManager multi-session management.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import the classes directly
const { SessionQueue } = await import("../../src/core/queue/SessionQueue.js");
const { QueueManager } = await import("../../src/core/queue/QueueManager.js");
type InjectResult = { response: string; sessionId: string };

/**
 * Helper: create an executor that resolves after a delay
 */
function createDelayExecutor(delayMs = 0, response = "ok") {
  return vi.fn(
    async (
      sessionKey: string,
      message: string | { text: string; images?: string[] },
      _options: any,
      signal: AbortSignal,
    ): Promise<InjectResult> => {
      if (delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, delayMs);
          signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("Inject cancelled"));
          });
        });
      }
      if (signal.aborted) throw new Error("Inject cancelled");
      const text = typeof message === "string" ? message : message.text;
      return { response: `${response}: ${text}`, sessionId: `session-${sessionKey}` };
    },
  );
}

describe("SessionQueue", () => {
  let executor: ReturnType<typeof createDelayExecutor>;

  beforeEach(() => {
    executor = createDelayExecutor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // FIFO Ordering
  // ========================================================================
  describe("FIFO ordering", () => {
    it("should process messages in order within a session", async () => {
      const order: string[] = [];
      const slowExecutor = vi.fn(async (_sk: string, msg: string | any, _opts: any, _signal: AbortSignal) => {
        const text = typeof msg === "string" ? msg : msg.text;
        await new Promise((r) => setTimeout(r, 10));
        order.push(text);
        return { response: text, sessionId: "s1" };
      });

      const queue = new SessionQueue("test-session", slowExecutor);

      // Enqueue 3 messages - they should be processed in FIFO order
      const p1 = queue.enqueue("first");
      const p2 = queue.enqueue("second");
      const p3 = queue.enqueue("third");

      await Promise.all([p1, p2, p3]);
      expect(order).toEqual(["first", "second", "third"]);
    });
  });

  // ========================================================================
  // Priority
  // ========================================================================
  describe("priority ordering", () => {
    it("should process higher priority items first", async () => {
      const order: string[] = [];
      const gateResolve: Array<() => void> = [];

      // First message blocks so we can queue up priority messages
      const gatedExecutor = vi.fn(async (_sk: string, msg: string | any, _opts: any, _signal: AbortSignal) => {
        const text = typeof msg === "string" ? msg : msg.text;
        if (text === "blocker") {
          await new Promise<void>((r) => gateResolve.push(r));
        }
        order.push(text);
        return { response: text, sessionId: "s1" };
      });

      const queue = new SessionQueue("test", gatedExecutor);

      // First message starts processing immediately (blocks)
      const p1 = queue.enqueue("blocker");

      // Queue up messages with different priorities while first is blocking
      await new Promise((r) => setTimeout(r, 5)); // let first start
      const p2 = queue.enqueue("low", { priority: 1 });
      const p3 = queue.enqueue("high", { priority: 10 });
      const p4 = queue.enqueue("medium", { priority: 5 });

      // Release the blocker
      gateResolve[0]();

      await Promise.all([p1, p2, p3, p4]);

      // blocker runs first (already started), then priority order: high, medium, low
      expect(order).toEqual(["blocker", "high", "medium", "low"]);
    });
  });

  // ========================================================================
  // Cancellation
  // ========================================================================
  describe("cancellation", () => {
    it("should cancel active inject via AbortController", async () => {
      const longExecutor = createDelayExecutor(5000, "should-not-complete");
      const queue = new SessionQueue("test", longExecutor);

      const promise = queue.enqueue("long-running");

      // Wait for it to start
      await new Promise((r) => setTimeout(r, 10));

      const cancelled = queue.cancelActive();
      expect(cancelled).toBe(true);

      await expect(promise).rejects.toThrow("cancelled");
    });

    it("should cancel queued items", async () => {
      const gateResolve: Array<() => void> = [];
      const gatedExecutor = vi.fn(async (_sk: string, msg: string | any, _opts: any, _signal: AbortSignal) => {
        const text = typeof msg === "string" ? msg : msg.text;
        if (text === "blocker") {
          await new Promise<void>((r) => gateResolve.push(r));
        }
        return { response: text, sessionId: "s1" };
      });

      const queue = new SessionQueue("test", gatedExecutor);

      const p1 = queue.enqueue("blocker");
      await new Promise((r) => setTimeout(r, 5));

      const p2 = queue.enqueue("queued1");
      const p3 = queue.enqueue("queued2");

      const count = queue.cancelQueued();
      expect(count).toBe(2);

      // Release blocker so p1 completes
      gateResolve[0]();
      await p1;

      // Queued items should reject
      await expect(p2).rejects.toThrow("cancelled");
      await expect(p3).rejects.toThrow("cancelled");
    });

    it("cancelAll should cancel both active and queued", async () => {
      const longExecutor = createDelayExecutor(5000);
      const queue = new SessionQueue("test", longExecutor);

      const p1 = queue.enqueue("active");
      await new Promise((r) => setTimeout(r, 10));
      const p2 = queue.enqueue("queued");

      const result = queue.cancelAll();
      expect(result.active).toBe(true);
      expect(result.queued).toBe(1);

      await expect(p1).rejects.toThrow();
      await expect(p2).rejects.toThrow();
    });
  });

  // ========================================================================
  // Event Emission
  // ========================================================================
  describe("event emission", () => {
    it("should emit enqueue, dequeue, start, complete events", async () => {
      const events: string[] = [];
      const queue = new SessionQueue("test", executor);

      queue.on((event) => {
        events.push(event.type);
      });

      await queue.enqueue("test message");

      expect(events).toContain("enqueue");
      expect(events).toContain("dequeue");
      expect(events).toContain("start");
      expect(events).toContain("complete");
    });

    it("should emit error event on executor failure", async () => {
      const failExecutor = vi.fn(async () => {
        throw new Error("execution failed");
      });
      const events: string[] = [];
      const queue = new SessionQueue("test", failExecutor as any);

      queue.on((event) => {
        events.push(event.type);
      });

      await expect(queue.enqueue("fail")).rejects.toThrow("execution failed");

      expect(events).toContain("error");
    });

    it("should emit cancel event when inject is cancelled", async () => {
      const longExecutor = createDelayExecutor(5000);
      const events: string[] = [];
      const queue = new SessionQueue("test", longExecutor);

      queue.on((event) => {
        events.push(event.type);
      });

      const p = queue.enqueue("cancel-me");
      await new Promise((r) => setTimeout(r, 10));
      queue.cancelActive();

      await expect(p).rejects.toThrow();
      expect(events).toContain("cancel");
    });
  });

  // ========================================================================
  // Queue Stats
  // ========================================================================
  describe("getStats", () => {
    it("should return queue statistics", async () => {
      const queue = new SessionQueue("test-session", executor);

      const stats = queue.getStats();
      expect(stats.sessionKey).toBe("test-session");
      expect(stats.queueDepth).toBe(0);
      expect(stats.isProcessing).toBe(false);
    });
  });

  // ========================================================================
  // Multimodal Messages
  // ========================================================================
  describe("multimodal messages", () => {
    it("should support text + images in MultimodalMessage format", async () => {
      const queue = new SessionQueue("test", executor);

      const result = await queue.enqueue({ text: "describe this image", images: ["http://img.png"] });

      expect(result.response).toContain("describe this image");
    });
  });

  // ========================================================================
  // Inject ID Generation
  // ========================================================================
  describe("inject ID generation", () => {
    it("should generate unique inject IDs matching inject-{timestamp}-{counter}", async () => {
      const ids: string[] = [];
      const queue = new SessionQueue("test", executor);

      queue.on((event) => {
        if (event.type === "enqueue") {
          ids.push(event.injectId);
        }
      });

      await queue.enqueue("msg1");
      await queue.enqueue("msg2");

      expect(ids).toHaveLength(2);
      expect(ids[0]).toMatch(/^inject-\d+-\d+$/);
      expect(ids[1]).toMatch(/^inject-\d+-\d+$/);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });
});

describe("QueueManager", () => {
  let manager: InstanceType<typeof QueueManager>;
  let executor: ReturnType<typeof createDelayExecutor>;

  beforeEach(() => {
    manager = new QueueManager();
    executor = createDelayExecutor();
    manager.setExecutor(executor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Multi-session
  // ========================================================================
  describe("multi-session support", () => {
    it("should maintain independent queues per session", async () => {
      const r1 = await manager.inject("session-a", "msg for a");
      const r2 = await manager.inject("session-b", "msg for b");

      expect(r1.sessionId).toContain("session-a");
      expect(r2.sessionId).toContain("session-b");
    });

    it("should track queue count", async () => {
      await manager.inject("session-a", "msg");
      await manager.inject("session-b", "msg");

      expect(manager.queueCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================================================
  // Idle Cleanup
  // ========================================================================
  describe("idle cleanup", () => {
    it("should clean up queues idle for longer than maxIdleMs", async () => {
      await manager.inject("session-old", "msg");

      // Simulate idle time by directly manipulating (or just clean with 0ms)
      const cleaned = manager.cleanup(0); // 0ms = clean everything idle
      expect(cleaned).toBeGreaterThanOrEqual(1);
    });

    it("should not clean up active queues", async () => {
      const longExecutor = createDelayExecutor(5000);
      const activeManager = new QueueManager();
      activeManager.setExecutor(longExecutor);

      const p = activeManager.inject("active-session", "long msg");
      await new Promise((r) => setTimeout(r, 10));

      const cleaned = activeManager.cleanup(0);
      expect(cleaned).toBe(0); // active queue not cleaned

      activeManager.cancelEverything();
      await p.catch(() => {}); // swallow cancel error
    });
  });

  // ========================================================================
  // Global Events
  // ========================================================================
  describe("global event forwarding", () => {
    it("should forward queue events to global handlers", async () => {
      const events: string[] = [];
      manager.on((event) => {
        events.push(event.type);
      });

      await manager.inject("test", "msg");

      expect(events).toContain("enqueue");
      expect(events).toContain("complete");
    });
  });

  // ========================================================================
  // Executor not set
  // ========================================================================
  describe("executor guard", () => {
    it("should throw if inject called without executor", async () => {
      const noExecManager = new QueueManager();
      await expect(noExecManager.inject("test", "msg")).rejects.toThrow("executor not set");
    });
  });

  // ========================================================================
  // hasPending / isActive
  // ========================================================================
  describe("state queries", () => {
    it("should report hasPending correctly", async () => {
      expect(manager.hasPending("nonexistent")).toBe(false);

      const longExecutor = createDelayExecutor(5000);
      const mgr = new QueueManager();
      mgr.setExecutor(longExecutor);

      const p = mgr.inject("test", "msg");
      await new Promise((r) => setTimeout(r, 10));

      expect(mgr.hasPending("test")).toBe(true);
      expect(mgr.isActive("test")).toBe(true);

      mgr.cancelEverything();
      await p.catch(() => {});
    });
  });

  // ========================================================================
  // getAllStats
  // ========================================================================
  describe("getAllStats", () => {
    it("should return stats for all sessions", async () => {
      await manager.inject("a", "msg");
      await manager.inject("b", "msg");

      const stats = manager.getAllStats();
      expect(stats.size).toBeGreaterThanOrEqual(2);
    });
  });
});
