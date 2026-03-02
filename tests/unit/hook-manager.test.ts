/**
 * Hook Manager Unit Tests (WOP-1365)
 *
 * Tests for createPluginHookManager: registration, deregistration,
 * priority ordering, mutable events, once semantics, and cleanup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Capture the bus listener registered by hook-manager
let busListeners: Map<string, (...args: unknown[]) => unknown>;
let busUnsubscribes: Map<string, ReturnType<typeof vi.fn>>;

vi.mock("../../src/core/events.js", () => {
  busListeners = new Map();
  busUnsubscribes = new Map();
  return {
    eventBus: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        busListeners.set(event, handler);
        const unsub = vi.fn(() => {
          busListeners.delete(event);
        });
        busUnsubscribes.set(event, unsub);
        return unsub;
      }),
    },
  };
});

let createPluginHookManager: typeof import("../../src/plugins/hook-manager.js").createPluginHookManager;

beforeEach(async () => {
  vi.resetModules();
  busListeners = new Map();
  busUnsubscribes = new Map();
  vi.doMock("../../src/core/events.js", () => ({
    eventBus: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        busListeners.set(event, handler);
        const unsub = vi.fn(() => {
          busListeners.delete(event);
        });
        busUnsubscribes.set(event, unsub);
        return unsub;
      }),
    },
  }));
  const mod = await import("../../src/plugins/hook-manager.js");
  createPluginHookManager = mod.createPluginHookManager;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPluginHookManager", () => {
  // ========================================================================
  // on() - Registration
  // ========================================================================
  describe("on", () => {
    it("should register a hook and subscribe to the event bus", () => {
      const hooks = createPluginHookManager("test-plugin");
      const handler = vi.fn();

      hooks.on("session:create", handler);

      expect(busListeners.has("session:create")).toBe(true);
    });

    it("should map message:incoming to session:beforeInject on the bus", () => {
      const hooks = createPluginHookManager("test-plugin");
      hooks.on("message:incoming", vi.fn());

      expect(busListeners.has("session:beforeInject")).toBe(true);
    });

    it("should map message:outgoing to session:afterInject on the bus", () => {
      const hooks = createPluginHookManager("test-plugin");
      hooks.on("message:outgoing", vi.fn());

      expect(busListeners.has("session:afterInject")).toBe(true);
    });

    it("should return an unsubscribe function", () => {
      const hooks = createPluginHookManager("test-plugin");
      const unsub = hooks.on("session:create", vi.fn());

      expect(typeof unsub).toBe("function");
    });

    it("should only create one bus subscription per event", () => {
      const hooks = createPluginHookManager("test-plugin");
      hooks.on("session:create", vi.fn());
      hooks.on("session:create", vi.fn());

      expect(busListeners.size).toBe(1);
    });
  });

  // ========================================================================
  // on() unsubscribe - Deregistration
  // ========================================================================
  describe("on - unsubscribe", () => {
    it("should remove the hook entry when unsubscribe is called", async () => {
      const hooks = createPluginHookManager("test-plugin");
      const handler = vi.fn();
      const unsub = hooks.on("session:create", handler);

      unsub();

      const busListener = busListeners.get("session:create");
      if (busListener) {
        await busListener({ session: "test" }, "session:create");
      }
      expect(handler).not.toHaveBeenCalled();
    });

    it("should clean up bus subscription when last hook for event is removed", () => {
      const hooks = createPluginHookManager("test-plugin");
      const unsub = hooks.on("session:create", vi.fn());

      unsub();

      expect(busListeners.has("session:create")).toBe(false);
    });

    it("should not clean up bus subscription when other hooks remain", () => {
      const hooks = createPluginHookManager("test-plugin");
      const unsub1 = hooks.on("session:create", vi.fn());
      hooks.on("session:create", vi.fn());

      unsub1();

      expect(busListeners.has("session:create")).toBe(true);
    });
  });

  // ========================================================================
  // off() - Remove by handler reference
  // ========================================================================
  describe("off", () => {
    it("should remove a hook by handler reference", async () => {
      const hooks = createPluginHookManager("test-plugin");
      const handler = vi.fn();
      hooks.on("session:create", handler);

      hooks.off("session:create", handler);

      const busListener = busListeners.get("session:create");
      if (busListener) {
        await busListener({ session: "test" }, "session:create");
      }
      expect(handler).not.toHaveBeenCalled();
    });

    it("should clean up bus subscription when last hook removed via off()", () => {
      const hooks = createPluginHookManager("test-plugin");
      const handler = vi.fn();
      hooks.on("session:create", handler);

      hooks.off("session:create", handler);

      expect(busListeners.has("session:create")).toBe(false);
    });

    it("should be safe to call off with unregistered handler", () => {
      const hooks = createPluginHookManager("test-plugin");
      expect(() => hooks.off("session:create", vi.fn())).not.toThrow();
    });
  });

  // ========================================================================
  // offByName() - Remove by name
  // ========================================================================
  describe("offByName", () => {
    it("should remove all hooks with the given name across events", () => {
      const hooks = createPluginHookManager("test-plugin");
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      hooks.on("session:create", handler1, { name: "my-hook" });
      hooks.on("session:destroy", handler2, { name: "my-hook" });

      hooks.offByName("my-hook");

      const listed = hooks.list();
      expect(listed).toEqual([]);
    });

    it("should not remove hooks with different names", () => {
      const hooks = createPluginHookManager("test-plugin");
      hooks.on("session:create", vi.fn(), { name: "keep-me" });
      hooks.on("session:create", vi.fn(), { name: "remove-me" });

      hooks.offByName("remove-me");

      const listed = hooks.list();
      expect(listed).toHaveLength(1);
      expect(listed[0].name).toBe("keep-me");
    });

    it("should clean up bus subscription if all hooks for event removed", () => {
      const hooks = createPluginHookManager("test-plugin");
      hooks.on("session:create", vi.fn(), { name: "only-hook" });

      hooks.offByName("only-hook");

      expect(busListeners.has("session:create")).toBe(false);
    });
  });

  // ========================================================================
  // list() - List all hooks
  // ========================================================================
  describe("list", () => {
    it("should return an empty array when no hooks registered", () => {
      const hooks = createPluginHookManager("test-plugin");
      expect(hooks.list()).toEqual([]);
    });

    it("should list all registered hooks sorted by priority", () => {
      const hooks = createPluginHookManager("test-plugin");
      hooks.on("session:create", vi.fn(), { priority: 200, name: "low" });
      hooks.on("session:create", vi.fn(), { priority: 50, name: "high" });
      hooks.on("session:destroy", vi.fn(), { priority: 100, name: "mid" });

      const listed = hooks.list();
      expect(listed).toEqual([
        { event: "session:create", name: "high", priority: 50 },
        { event: "session:destroy", name: "mid", priority: 100 },
        { event: "session:create", name: "low", priority: 200 },
      ]);
    });

    it("should use default priority 100 when not specified", () => {
      const hooks = createPluginHookManager("test-plugin");
      hooks.on("session:create", vi.fn());

      const listed = hooks.list();
      expect(listed[0].priority).toBe(100);
    });
  });

  // ========================================================================
  // Priority ordering - execution order
  // ========================================================================
  describe("priority ordering", () => {
    it("should execute hooks in priority order (lower = first)", async () => {
      const hooks = createPluginHookManager("test-plugin");
      const order: number[] = [];

      hooks.on("session:create", () => { order.push(3); }, { priority: 300 });
      hooks.on("session:create", () => { order.push(1); }, { priority: 10 });
      hooks.on("session:create", () => { order.push(2); }, { priority: 100 });

      const busListener = busListeners.get("session:create");
      expect(busListener).toBeTypeOf("function");
      await busListener!({ session: "test" }, "session:create");

      expect(order).toEqual([1, 2, 3]);
    });

    it("should maintain insertion order for equal priorities", async () => {
      const hooks = createPluginHookManager("test-plugin");
      const order: string[] = [];

      hooks.on("session:create", () => { order.push("first"); }, { priority: 100 });
      hooks.on("session:create", () => { order.push("second"); }, { priority: 100 });
      hooks.on("session:create", () => { order.push("third"); }, { priority: 100 });

      const busListener = busListeners.get("session:create");
      await busListener!({ session: "test" }, "session:create");

      expect(order).toEqual(["first", "second", "third"]);
    });
  });

  // ========================================================================
  // once option - Hook fires once then auto-removes
  // ========================================================================
  describe("once option", () => {
    it("should remove hook after first execution for non-mutable events", async () => {
      const hooks = createPluginHookManager("test-plugin");
      const handler = vi.fn();

      hooks.on("session:create", handler, { once: true });

      const busListener = busListeners.get("session:create");
      await busListener!({ session: "test" }, "session:create");
      expect(handler).toHaveBeenCalledTimes(1);

      expect(hooks.list()).toEqual([]);
    });

    it("should remove only the once hook, not other hooks for same event", async () => {
      const hooks = createPluginHookManager("test-plugin");
      const onceHandler = vi.fn();
      const persistentHandler = vi.fn();

      hooks.on("session:create", onceHandler, { once: true, priority: 10 });
      hooks.on("session:create", persistentHandler, { priority: 20 });

      const busListener = busListeners.get("session:create");
      await busListener!({ session: "test" }, "session:create");

      expect(onceHandler).toHaveBeenCalledTimes(1);
      expect(persistentHandler).toHaveBeenCalledTimes(1);

      expect(hooks.list()).toHaveLength(1);
    });
  });

  // ========================================================================
  // Mutable events - preventDefault, MutableHookEvent wrapping
  // ========================================================================
  describe("mutable events", () => {
    it("should wrap payload in MutableHookEvent for message:incoming", async () => {
      const hooks = createPluginHookManager("test-plugin");
      let receivedEvent: unknown;

      hooks.on("message:incoming", (evt: unknown) => {
        receivedEvent = evt;
      });

      const busListener = busListeners.get("session:beforeInject");
      await busListener!(
        { session: "s1", message: "hello", from: "user" },
        "session:beforeInject",
      );

      expect(receivedEvent).toMatchObject({ data: { session: "s1", message: "hello", from: "user" } });
      const evt = receivedEvent as Record<string, unknown>;
      expect(evt["data"]).toEqual({ session: "s1", message: "hello", from: "user" });
      expect(evt["session"]).toBe("s1");
      expect(typeof evt["preventDefault"]).toBe("function");
      expect(typeof evt["isPrevented"]).toBe("function");
      expect((evt["isPrevented"] as () => boolean)()).toBe(false);
    });

    it("should stop executing remaining hooks when preventDefault is called", async () => {
      const hooks = createPluginHookManager("test-plugin");
      const order: number[] = [];

      hooks.on("message:incoming", (evt: unknown) => {
        order.push(1);
        (evt as Record<string, unknown>)["preventDefault"]?.();
      }, { priority: 10 });

      hooks.on("message:incoming", (_evt: unknown) => {
        order.push(2); // should NOT run
      }, { priority: 20 });

      const busListener = busListeners.get("session:beforeInject");
      await busListener!(
        { session: "s1", message: "hello", from: "user" },
        "session:beforeInject",
      );

      expect(order).toEqual([1]);
    });

    it("should set _prevented on payload object when preventDefault called", async () => {
      const hooks = createPluginHookManager("test-plugin");

      hooks.on("message:incoming", (evt: unknown) => {
        (evt as Record<string, unknown>)["preventDefault"]?.();
      });

      const payload: Record<string, unknown> = { session: "s1", message: "hello", from: "user" };
      const busListener = busListeners.get("session:beforeInject");
      await busListener!(payload, "session:beforeInject");

      expect(payload["_prevented"]).toBe(true);
    });

    it("should use 'default' session when payload has no session field", async () => {
      const hooks = createPluginHookManager("test-plugin");
      let receivedSession: string | undefined;

      hooks.on("message:incoming", (evt: unknown) => {
        receivedSession = (evt as Record<string, unknown>)["session"] as string;
      });

      const busListener = busListeners.get("session:beforeInject");
      await busListener!({ message: "hello", from: "user" }, "session:beforeInject");

      expect(receivedSession).toBe("default");
    });

    it("should wrap channel:message as a mutable event", async () => {
      const hooks = createPluginHookManager("test-plugin");
      let receivedEvent: unknown;

      hooks.on("channel:message", (evt: unknown) => {
        receivedEvent = evt;
      });

      const busListener = busListeners.get("channel:message");
      await busListener!(
        { channel: { type: "discord", id: "123" }, message: "hi", from: "user" },
        "channel:message",
      );

      expect((receivedEvent as Record<string, unknown>)["data"]).toEqual({ channel: { type: "discord", id: "123" }, message: "hi", from: "user" });
      expect(typeof (receivedEvent as Record<string, unknown>)["preventDefault"]).toBe("function");
    });
  });

  // ========================================================================
  // Non-mutable events — raw payload passthrough
  // ========================================================================
  describe("non-mutable events", () => {
    it("should pass raw payload to handlers for non-mutable events", async () => {
      const hooks = createPluginHookManager("test-plugin");
      let receivedPayload: unknown;

      hooks.on("session:create", (payload: unknown) => {
        receivedPayload = payload;
      });

      const busListener = busListeners.get("session:create");
      await busListener!({ session: "s1", config: {} }, "session:create");

      expect(receivedPayload).toEqual({ session: "s1", config: {} });
      expect((receivedPayload as Record<string, unknown>)["preventDefault"]).toBeUndefined();
    });

    it("should propagate error from handler (no error isolation in current impl)", async () => {
      const hooks = createPluginHookManager("test-plugin");

      hooks.on("session:create", () => {
        throw new Error("handler error");
      }, { priority: 10 });

      const handler2 = vi.fn();
      hooks.on("session:create", handler2, { priority: 20 });

      const busListener = busListeners.get("session:create");

      await expect(busListener!({ session: "test" }, "session:create")).rejects.toThrow("handler error");
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Bus subscription cleanup
  // ========================================================================
  describe("bus subscription cleanup", () => {
    it("should clean up bus subscription after all once-hooks fire", async () => {
      const hooks = createPluginHookManager("test-plugin");
      hooks.on("session:create", vi.fn(), { once: true });

      const busListener = busListeners.get("session:create");
      await busListener!({ session: "test" }, "session:create");

      expect(busListeners.has("session:create")).toBe(false);
    });

    it("should clean up bus subscription when all hooks removed via off()", () => {
      const hooks = createPluginHookManager("test-plugin");
      const h1 = vi.fn();
      const h2 = vi.fn();
      hooks.on("session:create", h1);
      hooks.on("session:create", h2);

      hooks.off("session:create", h1);
      hooks.off("session:create", h2);

      expect(busListeners.has("session:create")).toBe(false);
    });

    it("should re-create bus subscription if new hook added after cleanup", () => {
      const hooks = createPluginHookManager("test-plugin");
      const unsub = hooks.on("session:create", vi.fn());
      unsub();
      expect(busListeners.has("session:create")).toBe(false);

      hooks.on("session:create", vi.fn());
      expect(busListeners.has("session:create")).toBe(true);
    });
  });
});
