/**
 * Event Bus Tests (WOP-12)
 *
 * Tests on/once/off subscription, emit (concurrent + sequential),
 * wildcard listeners, custom events, and error handling.
 *
 * NOTE: The eventBus singleton's emit() method iterates listeners manually
 * (not via Node's emitter.emit()), so some Node-level behaviors like
 * auto-removal of once() listeners don't apply automatically. The
 * implementation handles this by checking after the handler runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need fresh module state for each test to avoid listener leakage.
// vi.mock at the top registers the factory, but vi.resetModules() will
// re-create the mock for each re-import.
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let eventBus: any;

beforeEach(async () => {
  vi.resetModules();
  const eventsModule = await import("../../src/core/events.js");
  eventBus = eventsModule.eventBus;
});

afterEach(() => {
  eventBus?.removeAllListeners();
  vi.restoreAllMocks();
});

describe("Event Bus", () => {
  // ========================================================================
  // on() - Subscribe to events
  // ========================================================================
  describe("on", () => {
    it("should call handler when event is emitted", async () => {
      const handler = vi.fn();
      eventBus.on("session:create", handler);

      await eventBus.emit("session:create", { session: "test", config: {} }, "core");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        { session: "test", config: {} },
        expect.objectContaining({ type: "session:create", source: "core" }),
      );
    });

    it("should return an unsubscribe function", async () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.on("session:create", handler);

      await eventBus.emit("session:create", { session: "test" }, "core");
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      await eventBus.emit("session:create", { session: "test2" }, "core");
      expect(handler).toHaveBeenCalledTimes(1); // still 1
    });

    it("should support multiple handlers for same event", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on("session:create", handler1);
      eventBus.on("session:create", handler2);

      await eventBus.emit("session:create", { session: "test" }, "core");

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should de-duplicate if same handler registered twice for same event", async () => {
      const handler = vi.fn();
      eventBus.on("session:create", handler);
      eventBus.on("session:create", handler);

      await eventBus.emit("session:create", { session: "test" }, "core");

      // WeakMap de-duplication: replaces existing wrapper, so only 1 call
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // once() - Subscribe once
  // ========================================================================
  describe("once", () => {
    it("should provide full event context to once handler", async () => {
      const handler = vi.fn();
      eventBus.once("plugin:afterInit", handler);

      await eventBus.emit("plugin:afterInit", { plugin: "test-plugin", version: "1.0" }, "core");

      expect(handler).toHaveBeenCalledWith(
        { plugin: "test-plugin", version: "1.0" },
        expect.objectContaining({ type: "plugin:afterInit" }),
      );
    });

    it("should be removable via off() before it fires", async () => {
      const handler = vi.fn();
      eventBus.once("plugin:error", handler);
      eventBus.off("plugin:error", handler);

      await eventBus.emit("plugin:error", { plugin: "test", error: new Error("fail") }, "core");

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // off() - Unsubscribe
  // ========================================================================
  describe("off", () => {
    it("should remove a specific handler", async () => {
      const handler = vi.fn();
      eventBus.on("session:create", handler);

      eventBus.off("session:create", handler);

      await eventBus.emit("session:create", { session: "test" }, "core");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should not affect other handlers when removing one", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on("session:create", handler1);
      eventBus.on("session:create", handler2);

      eventBus.off("session:create", handler1);

      await eventBus.emit("session:create", { session: "test" }, "core");
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should be safe to call off with unregistered handler", () => {
      const handler = vi.fn();
      // Should not throw
      eventBus.off("session:create", handler);
    });
  });

  // ========================================================================
  // emit() - Sequential events (beforeInject, afterInject, etc.)
  // ========================================================================
  describe("emit - sequential events", () => {
    it("should run handlers sequentially for session:beforeInject", async () => {
      const order: number[] = [];

      eventBus.on("session:beforeInject", async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      });
      eventBus.on("session:beforeInject", async () => {
        order.push(2);
      });

      await eventBus.emit(
        "session:beforeInject",
        { session: "test", message: "hello", from: "user" },
        "core",
      );

      // Sequential: handler 1 finishes before handler 2 starts
      expect(order).toEqual([1, 2]);
    });

    it("should allow payload mutation in sequential events", async () => {
      const payload = { session: "test", message: "original", from: "user" };

      eventBus.on("session:beforeInject", (p: any) => {
        p.message = "modified";
      });

      eventBus.on("session:beforeInject", (p: any) => {
        // Should see the modified value
        expect(p.message).toBe("modified");
      });

      await eventBus.emit("session:beforeInject", payload as any, "core");
      expect(payload.message).toBe("modified");
    });
  });

  // ========================================================================
  // emit() - Concurrent events
  // ========================================================================
  describe("emit - concurrent events", () => {
    it("should run handlers concurrently for non-sequential events", async () => {
      const startTimes: number[] = [];

      eventBus.on("session:create", async () => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
      });
      eventBus.on("session:create", async () => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
      });

      await eventBus.emit("session:create", { session: "test" }, "core");

      // Both should start at roughly the same time (within 20ms)
      expect(Math.abs(startTimes[0] - startTimes[1])).toBeLessThan(20);
    });
  });

  // ========================================================================
  // Wildcard listeners
  // ========================================================================
  describe("wildcard listeners", () => {
    it("should receive all events via '*' listener", async () => {
      const handler = vi.fn();
      eventBus.on("*", handler);

      await eventBus.emit("session:create", { session: "test" }, "core");
      await eventBus.emit("plugin:afterInit", { plugin: "p", version: "1" }, "core");

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should receive shallow-copied payload to prevent mutation", async () => {
      const originalPayload = { session: "test", config: { key: "value" } };

      eventBus.on("*", (event: any) => {
        event.session = "mutated"; // should not affect original
      });

      await eventBus.emit("session:create", originalPayload as any, "core");

      // Wildcard receives a WOPREvent wrapper with shallow-copied payload,
      // so top-level mutation doesn't affect original
      expect(originalPayload.session).toBe("test");
    });
  });

  // ========================================================================
  // emitCustom()
  // ========================================================================
  describe("emitCustom", () => {
    it("should emit custom events with plugin prefix", async () => {
      const handler = vi.fn();
      eventBus.on("myplugin:custom" as any, handler);

      await eventBus.emitCustom("myplugin:custom", { data: "value" }, "myplugin");

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // Error handling
  // ========================================================================
  describe("error handling", () => {
    it("should catch and log handler errors without breaking other handlers", async () => {
      const handler1 = vi.fn(() => {
        throw new Error("handler error");
      });
      const handler2 = vi.fn();

      eventBus.on("session:create", handler1);
      eventBus.on("session:create", handler2);

      // Should not throw
      await eventBus.emit("session:create", { session: "test" }, "core");

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it("should catch async handler rejection without breaking other handlers", async () => {
      const handler1 = vi.fn(async () => {
        throw new Error("async error");
      });
      const handler2 = vi.fn();

      eventBus.on("session:create", handler1);
      eventBus.on("session:create", handler2);

      await eventBus.emit("session:create", { session: "test" }, "core");

      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // listenerCount() and removeAllListeners()
  // ========================================================================
  describe("listenerCount", () => {
    it("should return the number of listeners for an event", () => {
      eventBus.on("session:create", vi.fn());
      eventBus.on("session:create", vi.fn());

      expect(eventBus.listenerCount("session:create")).toBe(2);
    });

    it("should return 0 for event with no listeners", () => {
      expect(eventBus.listenerCount("session:destroy")).toBe(0);
    });
  });

  describe("removeAllListeners", () => {
    it("should remove all listeners for a specific event", async () => {
      const handler = vi.fn();
      eventBus.on("session:create", handler);

      eventBus.removeAllListeners("session:create");

      await eventBus.emit("session:create", { session: "test" }, "core");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should remove listeners for specified event only", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on("session:create", handler1);
      eventBus.on("plugin:afterInit", handler2);

      eventBus.removeAllListeners("session:create");

      await eventBus.emit("session:create", { session: "test" }, "core");
      await eventBus.emit("plugin:afterInit", { plugin: "p", version: "1" }, "core");

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });
});
