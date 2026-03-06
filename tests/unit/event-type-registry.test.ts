import { afterEach, beforeEach, describe, expect, it } from "vitest";

let getEventTypeRegistry: typeof import("../../src/core/event-type-registry.js").getEventTypeRegistry;
let resetEventTypeRegistry: typeof import("../../src/core/event-type-registry.js").resetEventTypeRegistry;

beforeEach(async () => {
  const mod = await import("../../src/core/event-type-registry.js");
  getEventTypeRegistry = mod.getEventTypeRegistry;
  resetEventTypeRegistry = mod.resetEventTypeRegistry;
  resetEventTypeRegistry();
});

afterEach(() => {
  resetEventTypeRegistry();
});

describe("EventTypeRegistry", () => {
  describe("core event types", () => {
    it("should have core event types registered by default", () => {
      const registry = getEventTypeRegistry();
      expect(registry.isRegistered("session:create")).toBe(true);
      expect(registry.isRegistered("plugin:activated")).toBe(true);
      expect(registry.isRegistered("system:shutdown")).toBe(true);
    });

    it("should not allow unregistering core event types", () => {
      const registry = getEventTypeRegistry();
      registry.unregisterEventType("session:create", "some-plugin");
      expect(registry.isRegistered("session:create")).toBe(true);
    });
  });

  describe("plugin event types", () => {
    it("should register a plugin event type", () => {
      const registry = getEventTypeRegistry();
      registry.registerEventType("cron.fired", {}, "wopr-plugin-cron");
      expect(registry.isRegistered("cron.fired")).toBe(true);
    });

    it("should reject duplicate registration from different plugin", () => {
      const registry = getEventTypeRegistry();
      registry.registerEventType("cron.fired", {}, "wopr-plugin-cron");
      expect(() => registry.registerEventType("cron.fired", {}, "other-plugin")).toThrow(
        /already registered by plugin/,
      );
    });

    it("should allow re-registration from same plugin", () => {
      const registry = getEventTypeRegistry();
      registry.registerEventType("cron.fired", {}, "wopr-plugin-cron");
      expect(() => registry.registerEventType("cron.fired", {}, "wopr-plugin-cron")).not.toThrow();
    });

    it("should not allow registering core event type names", () => {
      const registry = getEventTypeRegistry();
      expect(() => registry.registerEventType("session:create", {}, "bad-plugin")).toThrow(/core event type/);
    });

    it("should unregister plugin event types", () => {
      const registry = getEventTypeRegistry();
      registry.registerEventType("cron.fired", {}, "wopr-plugin-cron");
      registry.unregisterEventType("cron.fired", "wopr-plugin-cron");
      expect(registry.isRegistered("cron.fired")).toBe(false);
    });

    it("should not unregister if plugin name does not match", () => {
      const registry = getEventTypeRegistry();
      registry.registerEventType("cron.fired", {}, "wopr-plugin-cron");
      registry.unregisterEventType("cron.fired", "other-plugin");
      expect(registry.isRegistered("cron.fired")).toBe(true);
    });
  });

  describe("unregisterAllForPlugin", () => {
    it("should remove all event types for a plugin", () => {
      const registry = getEventTypeRegistry();
      registry.registerEventType("cron.fired", {}, "wopr-plugin-cron");
      registry.registerEventType("cron.failed", {}, "wopr-plugin-cron");
      registry.registerEventType("memory.indexed", {}, "wopr-plugin-memory");
      registry.unregisterAllForPlugin("wopr-plugin-cron");
      expect(registry.isRegistered("cron.fired")).toBe(false);
      expect(registry.isRegistered("cron.failed")).toBe(false);
      expect(registry.isRegistered("memory.indexed")).toBe(true);
    });
  });

  describe("getAllEventTypes", () => {
    it("should return core + plugin event types", () => {
      const registry = getEventTypeRegistry();
      registry.registerEventType("cron.fired", {}, "wopr-plugin-cron");
      const all = registry.getAllEventTypes();
      expect(all).toContain("session:create");
      expect(all).toContain("cron.fired");
    });
  });

  describe("getPluginEventTypes", () => {
    it("should return only plugin event types with metadata", () => {
      const registry = getEventTypeRegistry();
      registry.registerEventType("cron.fired", { description: "Cron fired" }, "wopr-plugin-cron");
      const pluginTypes = registry.getPluginEventTypes();
      expect(pluginTypes.size).toBe(1);
      const entry = pluginTypes.get("cron.fired");
      expect(entry?.pluginName).toBe("wopr-plugin-cron");
      expect(entry?.registration.description).toBe("Cron fired");
    });
  });
});
