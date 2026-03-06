import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  shouldLogStack: () => false,
}));

let createEventTools: any;
let getEventTypeRegistry: any;
let resetEventTypeRegistry: any;

beforeEach(async () => {
  vi.resetModules();
  const regMod = await import("../../src/core/event-type-registry.js");
  getEventTypeRegistry = regMod.getEventTypeRegistry;
  resetEventTypeRegistry = regMod.resetEventTypeRegistry;
  resetEventTypeRegistry();
  const mod = await import("../../src/core/a2a-tools/events.js");
  createEventTools = mod.createEventTools;
});

afterEach(() => {
  resetEventTypeRegistry?.();
  vi.restoreAllMocks();
});

describe("event_list tool", () => {
  it("should include core event types", async () => {
    const tools = createEventTools("test-session");
    const eventListTool = tools[1] as any;
    const result = await eventListTool.handler({});
    const text = result.content[0].text;
    expect(text).toContain("session:create");
    expect(text).toContain("system:shutdown");
    expect(text).toContain("Core events:");
  });

  it("should include plugin-registered event types", async () => {
    getEventTypeRegistry().registerEventType("cron.fired", { description: "Cron job fired" }, "wopr-plugin-cron");
    const tools = createEventTools("test-session");
    const eventListTool = tools[1] as any;
    const result = await eventListTool.handler({});
    const text = result.content[0].text;
    expect(text).toContain("cron.fired");
    expect(text).toContain("wopr-plugin-cron");
    expect(text).toContain("Plugin events:");
  });

  it("should not include unregistered plugin types after uninstall", async () => {
    const registry = getEventTypeRegistry();
    registry.registerEventType("cron.fired", {}, "wopr-plugin-cron");
    registry.unregisterAllForPlugin("wopr-plugin-cron");
    const tools = createEventTools("test-session");
    const eventListTool = tools[1] as any;
    const result = await eventListTool.handler({});
    const text = result.content[0].text;
    expect(text).not.toContain("cron.fired");
  });

  it("should show description in plugin event listing", async () => {
    getEventTypeRegistry().registerEventType("webhook.received", { description: "Webhook received" }, "wopr-plugin-webhook");
    const tools = createEventTools("test-session");
    const eventListTool = tools[1] as any;
    const result = await eventListTool.handler({});
    const text = result.content[0].text;
    expect(text).toContain("Webhook received");
  });
});
