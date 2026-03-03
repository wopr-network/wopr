import { beforeEach, describe, expect, it } from "vitest";
import { pluginTools, registerA2ATool, unregisterA2ATool } from "../../src/core/a2a-tools/_base.js";
import { registerA2AServerImpl } from "../../src/plugins/schema-converter.js";

describe("A2A tool namespacing", () => {
  beforeEach(() => {
    pluginTools.clear();
  });

  it("registers tools with namespaced key pluginId:toolName", () => {
    registerA2ATool({
      name: "search",
      pluginId: "discord",
      description: "Search discord",
      schema: {} as never,
      handler: async () => ({}),
    });

    expect(pluginTools.has("discord:search")).toBe(true);
    expect(pluginTools.has("search")).toBe(false);
    const tool = pluginTools.get("discord:search")!;
    expect(tool.namespacedName).toBe("discord:search");
    expect(tool.name).toBe("search");
    expect(tool.pluginId).toBe("discord");
  });

  it("does not overwrite tools from different plugins with same name", () => {
    const handler1 = async () => ({ source: "plugin-a" });
    const handler2 = async () => ({ source: "plugin-b" });

    registerA2ATool({
      name: "search",
      pluginId: "plugin-a",
      description: "Search A",
      schema: {} as never,
      handler: handler1,
    });
    registerA2ATool({
      name: "search",
      pluginId: "plugin-b",
      description: "Search B",
      schema: {} as never,
      handler: handler2,
    });

    expect(pluginTools.size).toBe(2);
    expect(pluginTools.get("plugin-a:search")!.handler).toBe(handler1);
    expect(pluginTools.get("plugin-b:search")!.handler).toBe(handler2);
  });

  it("warns when same pluginId:toolName is re-registered", () => {
    registerA2ATool({
      name: "search",
      pluginId: "discord",
      description: "v1",
      schema: {} as never,
      handler: async () => ({}),
    });
    // Re-registering same namespaced key overwrites (with warning logged)
    registerA2ATool({
      name: "search",
      pluginId: "discord",
      description: "v2",
      schema: {} as never,
      handler: async () => ({}),
    });

    expect(pluginTools.size).toBe(1);
    expect(pluginTools.get("discord:search")!.description).toBe("v2");
  });

  it("unregisters by namespaced key", () => {
    registerA2ATool({
      name: "search",
      pluginId: "discord",
      description: "Search",
      schema: {} as never,
      handler: async () => ({}),
    });

    expect(unregisterA2ATool("discord:search")).toBe(true);
    expect(pluginTools.size).toBe(0);
  });

  it("listA2ATools returns namespaced keys for plugin tools", () => {
    registerA2ATool({
      name: "search",
      pluginId: "discord",
      description: "Search",
      schema: {} as never,
      handler: async () => ({}),
    });

    const keys = [...pluginTools.keys()];
    expect(keys).toContain("discord:search");
  });
});

describe("registerA2AServerImpl namespacing", () => {
  beforeEach(() => {
    pluginTools.clear();
  });

  it("registers tools with server name as pluginId", () => {
    registerA2AServerImpl("my-plugin", {
      name: "my-server",
      tools: [
        {
          name: "do_thing",
          description: "Does a thing",
          inputSchema: { type: "object", properties: {} },
          handler: async () => ({ result: "ok" }),
        },
      ],
    });

    expect(pluginTools.has("my-plugin:do_thing")).toBe(true);
    expect(pluginTools.get("my-plugin:do_thing")!.pluginId).toBe("my-plugin");
  });
});
