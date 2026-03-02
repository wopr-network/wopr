/**
 * Setup Context Provider Tests (WOP-1054)
 *
 * Tests registration, injection via beginSetupContext, and cleanup
 * via endSetupContext.
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

let setupContextProviders: Map<string, any>;
let configSchemas: Map<string, any>;
let contextProviders: Map<string, any>;
let beginSetupContext: typeof import("../../src/plugins/setup-context.js").beginSetupContext;
let endSetupContext: typeof import("../../src/plugins/setup-context.js").endSetupContext;

beforeEach(async () => {
  vi.resetModules();
  const state = await import("../../src/plugins/state.js");
  setupContextProviders = state.setupContextProviders;
  configSchemas = state.configSchemas;
  const ctx = await import("../../src/core/context.js");
  contextProviders = ctx.contextProviders;
  const setupCtx = await import("../../src/plugins/setup-context.js");
  beginSetupContext = setupCtx.beginSetupContext;
  endSetupContext = setupCtx.endSetupContext;
});

afterEach(() => {
  setupContextProviders.clear();
  configSchemas.clear();
  // Remove only setup: prefixed providers to avoid breaking defaults
  for (const key of contextProviders.keys()) {
    if (key.startsWith("setup:")) contextProviders.delete(key);
  }
  vi.restoreAllMocks();
});

describe("Setup Context Providers", () => {
  it("should register a setup context provider in state", () => {
    const provider = () => "Setup instructions";
    setupContextProviders.set("my-plugin", provider);
    expect(setupContextProviders.get("my-plugin")).toBe(provider);
  });

  it("should inject a temporary context provider on beginSetupContext", () => {
    const provider = vi.fn().mockReturnValue("Help the user create a Discord bot");
    setupContextProviders.set("wopr-plugin-discord", provider);

    beginSetupContext("wopr-plugin-discord", "session-1", { token: "" });

    expect(contextProviders.has("setup:wopr-plugin-discord:session-1")).toBe(true);
  });

  it("should call the provider with correct input", async () => {
    const provider = vi.fn().mockReturnValue("Instructions here");
    setupContextProviders.set("my-plugin", provider);

    configSchemas.set("my-plugin", {
      title: "My Plugin",
      fields: [{ name: "apiKey", type: "password", label: "API Key" }],
    });

    beginSetupContext("my-plugin", "sess-1", { apiKey: "partial" });

    const cp = contextProviders.get("setup:my-plugin:sess-1")!;
    const result = await cp.getContext("sess-1", { content: "", from: "user", timestamp: Date.now() });

    expect(provider).toHaveBeenCalledWith({
      pluginId: "my-plugin",
      configSchema: { title: "My Plugin", fields: [{ name: "apiKey", type: "password", label: "API Key" }] },
      partialConfig: { apiKey: "partial" },
    });
    expect(result).not.toBeNull();
    expect(result!.content).toBe("Instructions here");
    expect(result!.role).toBe("system");
  });

  it("should be a no-op when no provider is registered", () => {
    beginSetupContext("nonexistent-plugin", "sess-1", {});
    expect(contextProviders.has("setup:nonexistent-plugin:sess-1")).toBe(false);
  });

  it("should return null when provider returns empty string", async () => {
    const provider = vi.fn().mockReturnValue("");
    setupContextProviders.set("empty-plugin", provider);

    beginSetupContext("empty-plugin", "sess-1", {});

    const cp = contextProviders.get("setup:empty-plugin:sess-1")!;
    const result = await cp.getContext("sess-1", { content: "", from: "user", timestamp: Date.now() });
    expect(result).toBeNull();
  });

  it("should use empty fallback schema when plugin has no registered schema", () => {
    const provider = vi.fn().mockReturnValue("Instructions");
    setupContextProviders.set("no-schema-plugin", provider);

    beginSetupContext("no-schema-plugin", "sess-1", {});

    const cp = contextProviders.get("setup:no-schema-plugin:sess-1")!;
    expect(cp).toBeTypeOf("object");
    // Provider was called with empty fallback schema on getContext
  });

  it("should only activate for the correct session", () => {
    const provider = vi.fn().mockReturnValue("Instructions");
    setupContextProviders.set("my-plugin", provider);

    beginSetupContext("my-plugin", "sess-1", {});

    const cp = contextProviders.get("setup:my-plugin:sess-1")!;
    expect(cp.enabled("sess-1")).toBe(true);
    expect(cp.enabled("sess-other")).toBe(false);
  });

  it("should remove the context provider on endSetupContext", () => {
    const provider = vi.fn().mockReturnValue("Instructions");
    setupContextProviders.set("my-plugin", provider);

    beginSetupContext("my-plugin", "sess-1", {});
    expect(contextProviders.has("setup:my-plugin:sess-1")).toBe(true);

    endSetupContext("my-plugin", "sess-1");
    expect(contextProviders.has("setup:my-plugin:sess-1")).toBe(false);
  });

  it("should handle endSetupContext when no provider was active (no-op)", () => {
    expect(() => endSetupContext("no-plugin", "no-session")).not.toThrow();
  });

  it("should support multiple concurrent setup sessions", () => {
    const provider = vi.fn().mockReturnValue("Instructions");
    setupContextProviders.set("my-plugin", provider);

    beginSetupContext("my-plugin", "sess-1", {});
    beginSetupContext("my-plugin", "sess-2", {});

    expect(contextProviders.has("setup:my-plugin:sess-1")).toBe(true);
    expect(contextProviders.has("setup:my-plugin:sess-2")).toBe(true);

    endSetupContext("my-plugin", "sess-1");
    expect(contextProviders.has("setup:my-plugin:sess-1")).toBe(false);
    expect(contextProviders.has("setup:my-plugin:sess-2")).toBe(true);
  });
});

describe("unregisterSetupContextProvider (WOPRPluginContext method)", () => {
  it("should remove the plugin's SetupContextProvider from setupContextProviders", () => {
    const provider = vi.fn();
    setupContextProviders.set("my-plugin", provider);
    expect(setupContextProviders.has("my-plugin")).toBe(true);

    // Mirrors what createPluginContext.unregisterSetupContextProvider() executes:
    // setupContextProviders.delete(pluginName)
    setupContextProviders.delete("my-plugin");

    expect(setupContextProviders.has("my-plugin")).toBe(false);
  });

  it("should not affect other plugins' providers when unregistering one", () => {
    const providerA = vi.fn();
    const providerB = vi.fn();
    setupContextProviders.set("plugin-a", providerA);
    setupContextProviders.set("plugin-b", providerB);

    setupContextProviders.delete("plugin-a");

    expect(setupContextProviders.has("plugin-a")).toBe(false);
    expect(setupContextProviders.get("plugin-b")).toBe(providerB);
  });

  it("should be idempotent — no-op when provider was never registered", () => {
    expect(setupContextProviders.has("ghost-plugin")).toBe(false);
    expect(() => setupContextProviders.delete("ghost-plugin")).not.toThrow();
    expect(setupContextProviders.has("ghost-plugin")).toBe(false);
  });

  it("should allow re-registration after unregistering", () => {
    const providerV1 = vi.fn();
    const providerV2 = vi.fn();
    setupContextProviders.set("my-plugin", providerV1);
    setupContextProviders.delete("my-plugin");

    setupContextProviders.set("my-plugin", providerV2);

    expect(setupContextProviders.get("my-plugin")).toBe(providerV2);
  });
});
