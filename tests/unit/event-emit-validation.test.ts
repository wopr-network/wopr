import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  shouldLogStack: () => false,
}));

let eventBus: any;
let resetEventTypeRegistry: any;
let getEventTypeRegistry: any;

beforeEach(async () => {
  vi.resetModules();
  const registryModule = await import("../../src/core/event-type-registry.js");
  getEventTypeRegistry = registryModule.getEventTypeRegistry;
  resetEventTypeRegistry = registryModule.resetEventTypeRegistry;
  resetEventTypeRegistry();
  const eventsModule = await import("../../src/core/events.js");
  eventBus = eventsModule.eventBus;
});

afterEach(() => {
  eventBus?.removeAllListeners();
  resetEventTypeRegistry?.();
  vi.restoreAllMocks();
});

describe("emitCustom validation", () => {
  it("should reject unregistered event types", async () => {
    await expect(eventBus.emitCustom("unknown.event", {}, "test")).rejects.toThrow(
      /not a registered event type/,
    );
  });

  it("should allow core event types", async () => {
    const handler = vi.fn();
    eventBus.on("session:create" as any, handler);
    await expect(eventBus.emitCustom("session:create", { session: "s1" }, "test")).resolves.not.toThrow();
  });

  it("should allow plugin-registered event types", async () => {
    getEventTypeRegistry().registerEventType("cron.fired", {}, "wopr-plugin-cron");
    const handler = vi.fn();
    eventBus.on("cron.fired" as any, handler);
    await expect(eventBus.emitCustom("cron.fired", {}, "test")).resolves.not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should throw with helpful message including event name", async () => {
    await expect(eventBus.emitCustom("my.custom.event", {}, "test")).rejects.toThrow(/my\.custom\.event/);
  });
});
