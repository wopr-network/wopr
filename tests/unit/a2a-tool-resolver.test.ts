import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/a2a-tools/_base.js", () => ({
  pluginTools: new Map(),
  isAsyncIterable: vi.fn((v: unknown) => v != null && typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"),
}));

vi.mock("../../src/plugins/state.js", () => ({
  pluginManifests: new Map(),
  loadedPlugins: new Map(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { pluginTools } from "../../src/core/a2a-tools/_base.js";
import { logger } from "../../src/logger.js";
import { resolveA2AToolDependencies } from "../../src/plugins/a2a-tool-resolver.js";
import { pluginManifests } from "../../src/plugins/state.js";

describe("resolveA2AToolDependencies", () => {
  beforeEach(() => {
    (pluginTools as Map<string, unknown>).clear();
    (pluginManifests as Map<string, unknown>).clear();
    vi.clearAllMocks();
  });

  it("injects resolved tools into plugin context", () => {
    const searchHandler = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: "found" }] });
    (pluginTools as Map<string, unknown>).set("search", {
      name: "search",
      description: "Search tool",
      inputSchema: {},
      handler: searchHandler,
    });

    (pluginManifests as Map<string, unknown>).set("plugin-a", {
      name: "plugin-a",
      version: "1.0.0",
      description: "test",
      capabilities: [],
      toolDependencies: [{ toolName: "search" }],
    });

    const result = resolveA2AToolDependencies();

    expect(result.resolved).toContain("plugin-a:search");
    expect(result.missing).toHaveLength(0);

    const toolProxy = result.toolMap.get("plugin-a")?.get("search");
    expect(toolProxy).toBeDefined();
  });

  it("proxy calls the registered handler", async () => {
    const handler = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: "result" }] });
    (pluginTools as Map<string, unknown>).set("mytool", {
      name: "mytool",
      description: "My tool",
      inputSchema: {},
      handler,
    });

    (pluginManifests as Map<string, unknown>).set("plugin-a", {
      name: "plugin-a",
      version: "1.0.0",
      description: "test",
      capabilities: [],
      toolDependencies: [{ toolName: "mytool" }],
    });

    const result = resolveA2AToolDependencies();
    const proxy = result.toolMap.get("plugin-a")?.get("mytool");
    expect(proxy).toBeDefined();
    const output = await proxy!({ foo: "bar" });
    expect(handler).toHaveBeenCalledWith({ foo: "bar" }, { sessionName: "a2a-dependency" });
    expect(output).toEqual({ content: [{ type: "text", text: "result" }] });
  });

  it("logs warning for missing optional dependency", () => {
    (pluginManifests as Map<string, unknown>).set("plugin-a", {
      name: "plugin-a",
      version: "1.0.0",
      description: "test",
      capabilities: [],
      toolDependencies: [{ toolName: "nonexistent", optional: true }],
    });

    const result = resolveA2AToolDependencies();

    expect(result.missing).toContain("plugin-a:nonexistent");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("nonexistent"),
    );
  });

  it("logs error for missing required dependency", () => {
    (pluginManifests as Map<string, unknown>).set("plugin-a", {
      name: "plugin-a",
      version: "1.0.0",
      description: "test",
      capabilities: [],
      toolDependencies: [{ toolName: "nonexistent" }],
    });

    const result = resolveA2AToolDependencies();

    expect(result.missing).toContain("plugin-a:nonexistent");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("nonexistent"),
    );
  });

  it("handles plugins with no toolDependencies gracefully", () => {
    (pluginManifests as Map<string, unknown>).set("plugin-a", {
      name: "plugin-a",
      version: "1.0.0",
      description: "test",
      capabilities: [],
    });

    const result = resolveA2AToolDependencies();

    expect(result.resolved).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it("resolves both sides of circular tool dependencies without error", () => {
    (pluginTools as Map<string, unknown>).set("tool-a", {
      name: "tool-a",
      description: "Tool A",
      inputSchema: {},
      handler: vi.fn(),
    });
    (pluginTools as Map<string, unknown>).set("tool-b", {
      name: "tool-b",
      description: "Tool B",
      inputSchema: {},
      handler: vi.fn(),
    });

    (pluginManifests as Map<string, unknown>).set("plugin-a", {
      name: "plugin-a",
      version: "1.0.0",
      description: "test",
      capabilities: [],
      toolDependencies: [{ toolName: "tool-b" }],
    });
    (pluginManifests as Map<string, unknown>).set("plugin-b", {
      name: "plugin-b",
      version: "1.0.0",
      description: "test",
      capabilities: [],
      toolDependencies: [{ toolName: "tool-a" }],
    });

    const result = resolveA2AToolDependencies();

    expect(result.resolved).toContain("plugin-a:tool-b");
    expect(result.resolved).toContain("plugin-b:tool-a");
    expect(result.missing).toHaveLength(0);
  });
});
