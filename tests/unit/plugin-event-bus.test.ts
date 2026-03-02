import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger to suppress output
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Use vi.hoisted so mockCoreEventBus is available inside vi.mock factory
const mockCoreEventBus = vi.hoisted(() => ({
  on: vi.fn(() => vi.fn()),
  once: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(async () => {}),
  emitCustom: vi.fn(async () => {}),
  listenerCount: vi.fn(() => 0),
  removeAllListeners: vi.fn(),
}));

vi.mock("../../src/core/events.js", () => ({
  eventBus: mockCoreEventBus,
}));

import { createPluginEventBus } from "../../src/plugins/event-bus.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockCoreEventBus.on.mockReturnValue(vi.fn());
});

describe("createPluginEventBus", () => {
  const PLUGIN_NAME = "test-plugin";

  describe("on", () => {
    it("should delegate to core eventBus.on with a wrapped handler", () => {
      const bus = createPluginEventBus(PLUGIN_NAME);
      const handler = vi.fn();

      bus.on("session:create", handler);

      expect(mockCoreEventBus.on).toHaveBeenCalledTimes(1);
      expect(mockCoreEventBus.on).toHaveBeenCalledWith(
        "session:create",
        expect.any(Function),
      );
    });

    it("should return the unsubscribe function from core eventBus.on", () => {
      const mockUnsub = vi.fn();
      mockCoreEventBus.on.mockReturnValueOnce(mockUnsub);

      const bus = createPluginEventBus(PLUGIN_NAME);
      const unsub = bus.on("session:create", vi.fn());

      expect(unsub).toBe(mockUnsub);
    });

    it("should inject pluginName as source in the wrapped handler", async () => {
      let capturedWrapper: ((...args: unknown[]) => Promise<void>) | undefined;
      mockCoreEventBus.on.mockImplementationOnce((_event: string, wrapper: (...args: unknown[]) => Promise<void>) => {
        capturedWrapper = wrapper;
        return vi.fn();
      });

      const bus = createPluginEventBus(PLUGIN_NAME);
      const handler = vi.fn();
      bus.on("session:create", handler);

      const payload = { session: "s1" };
      const evt = { type: "session:create", payload, timestamp: 1, source: "core" };
      await capturedWrapper!(payload, evt);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({ source: PLUGIN_NAME }),
      );
    });

    it("should support multiple listeners for the same event", () => {
      const bus = createPluginEventBus(PLUGIN_NAME);
      bus.on("session:create", vi.fn());
      bus.on("session:create", vi.fn());

      expect(mockCoreEventBus.on).toHaveBeenCalledTimes(2);
    });
  });

  describe("once", () => {
    it("should delegate to core eventBus.once with a wrapped handler", () => {
      const bus = createPluginEventBus(PLUGIN_NAME);
      const handler = vi.fn();

      bus.once("plugin:afterInit", handler);

      expect(mockCoreEventBus.once).toHaveBeenCalledTimes(1);
      expect(mockCoreEventBus.once).toHaveBeenCalledWith(
        "plugin:afterInit",
        expect.any(Function),
      );
    });

    it("should inject pluginName as source in the once wrapper", async () => {
      let capturedWrapper: ((...args: unknown[]) => Promise<void>) | undefined;
      mockCoreEventBus.once.mockImplementationOnce((_event: string, wrapper: (...args: unknown[]) => Promise<void>) => {
        capturedWrapper = wrapper;
      });

      const bus = createPluginEventBus(PLUGIN_NAME);
      const handler = vi.fn();
      bus.once("plugin:afterInit", handler);

      const payload = { plugin: "p", version: "1.0" };
      const evt = { type: "plugin:afterInit", payload, timestamp: 1, source: "core" };
      await capturedWrapper!(payload, evt);

      expect(handler).toHaveBeenCalledWith(
        payload,
        expect.objectContaining({ source: PLUGIN_NAME }),
      );
    });
  });

  describe("off", () => {
    it("should call core eventBus.off with the wrapped handler", () => {
      let capturedWrapper: unknown;
      mockCoreEventBus.on.mockImplementationOnce((_event: string, wrapper: unknown) => {
        capturedWrapper = wrapper;
        return vi.fn();
      });

      const bus = createPluginEventBus(PLUGIN_NAME);
      const handler = vi.fn();
      bus.on("session:create", handler);
      bus.off("session:create", handler);

      expect(mockCoreEventBus.off).toHaveBeenCalledTimes(1);
      expect(mockCoreEventBus.off).toHaveBeenCalledWith("session:create", capturedWrapper);
    });

    it("should be a no-op when calling off with an unregistered handler", () => {
      const bus = createPluginEventBus(PLUGIN_NAME);
      const handler = vi.fn();

      expect(() => bus.off("session:create", handler)).not.toThrow();
      expect(mockCoreEventBus.off).not.toHaveBeenCalled();
    });

    it("should allow off after once registration", () => {
      let capturedWrapper: unknown;
      mockCoreEventBus.once.mockImplementationOnce((_event: string, wrapper: unknown) => {
        capturedWrapper = wrapper;
      });

      const bus = createPluginEventBus(PLUGIN_NAME);
      const handler = vi.fn();
      bus.once("plugin:error", handler);
      bus.off("plugin:error", handler);

      expect(mockCoreEventBus.off).toHaveBeenCalledWith("plugin:error", capturedWrapper);
    });

    it("should not affect other handlers when removing one", () => {
      const bus = createPluginEventBus(PLUGIN_NAME);
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus.on("session:create", handler1);
      bus.on("session:create", handler2);
      bus.off("session:create", handler1);

      expect(mockCoreEventBus.off).toHaveBeenCalledTimes(1);
    });
  });

  describe("emit", () => {
    it("should delegate to core eventBus.emit with pluginName as source", async () => {
      const bus = createPluginEventBus(PLUGIN_NAME);

      await bus.emit("session:create", { session: "s1" });

      expect(mockCoreEventBus.emit).toHaveBeenCalledTimes(1);
      expect(mockCoreEventBus.emit).toHaveBeenCalledWith(
        "session:create",
        { session: "s1" },
        PLUGIN_NAME,
      );
    });
  });

  describe("emitCustom", () => {
    it("should delegate to core eventBus.emitCustom with pluginName as source", async () => {
      const bus = createPluginEventBus(PLUGIN_NAME);

      await bus.emitCustom("test-plugin:custom", { data: "hello" });

      expect(mockCoreEventBus.emitCustom).toHaveBeenCalledTimes(1);
      expect(mockCoreEventBus.emitCustom).toHaveBeenCalledWith(
        "test-plugin:custom",
        { data: "hello" },
        PLUGIN_NAME,
      );
    });
  });

  describe("listenerCount", () => {
    it("should delegate to core eventBus.listenerCount", () => {
      mockCoreEventBus.listenerCount.mockReturnValueOnce(3);

      const bus = createPluginEventBus(PLUGIN_NAME);
      const count = bus.listenerCount("session:create");

      expect(count).toBe(3);
      expect(mockCoreEventBus.listenerCount).toHaveBeenCalledWith("session:create");
    });
  });

  describe("plugin isolation", () => {
    it("should inject different source for different plugin names", async () => {
      let wrapper1: ((...args: unknown[]) => Promise<void>) | undefined;
      let wrapper2: ((...args: unknown[]) => Promise<void>) | undefined;

      mockCoreEventBus.on
        .mockImplementationOnce((_e: string, w: (...args: unknown[]) => Promise<void>) => { wrapper1 = w; return vi.fn(); })
        .mockImplementationOnce((_e: string, w: (...args: unknown[]) => Promise<void>) => { wrapper2 = w; return vi.fn(); });

      const bus1 = createPluginEventBus("plugin-a");
      const bus2 = createPluginEventBus("plugin-b");

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus1.on("session:create", handler1);
      bus2.on("session:create", handler2);

      const payload = { session: "s1" };
      const evt = { type: "session:create", payload, timestamp: 1, source: "core" };

      await wrapper1!(payload, evt);
      await wrapper2!(payload, evt);

      expect(handler1).toHaveBeenCalledWith(payload, expect.objectContaining({ source: "plugin-a" }));
      expect(handler2).toHaveBeenCalledWith(payload, expect.objectContaining({ source: "plugin-b" }));
    });

    it("should not cross-pollute handler maps between plugin buses", () => {
      const bus1 = createPluginEventBus("plugin-a");
      const bus2 = createPluginEventBus("plugin-b");

      const handler = vi.fn();
      bus1.on("session:create", handler);

      bus2.off("session:create", handler);

      expect(mockCoreEventBus.off).not.toHaveBeenCalled();
    });
  });
});
