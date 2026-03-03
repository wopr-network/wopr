/**
 * Plugin Context Factory Tests (WOP-1417)
 *
 * Tests for src/plugins/context-factory.ts covering:
 * - createPluginContext returns correct shape (all WOPRPluginContext methods)
 * - Delegation to core modules
 * - Plugin-scoped state isolation
 * - Config read/write
 * - Error paths
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (must be before imports; no top-level variable references inside factories) ---

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/plugins/event-bus.js", () => ({
  createPluginEventBus: vi.fn(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() })),
}));

vi.mock("../../src/plugins/hook-manager.js", () => ({
  createPluginHookManager: vi.fn(() => ({ register: vi.fn(), unregister: vi.fn() })),
}));

vi.mock("../../src/plugins/plugin-logger.js", () => ({
  createPluginLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("../../src/plugins/schema-converter.js", () => ({
  registerA2AServerImpl: vi.fn(),
}));

vi.mock("../../src/core/a2a-mcp.js", () => ({
  unregisterA2ATool: vi.fn(() => true),
}));

vi.mock("../../src/core/capability-registry.js", () => ({
  getCapabilityRegistry: vi.fn(() => ({
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProviders: vi.fn(() => []),
    hasProvider: vi.fn(() => false),
  })),
}));

vi.mock("../../src/core/capability-resolver.js", () => ({
  resolveCapability: vi.fn(),
  resolveAllProviders: vi.fn(() => []),
}));

vi.mock("../../src/core/capability-health.js", () => ({
  getCapabilityHealthProber: vi.fn(() => ({ registerProbe: vi.fn() })),
}));

vi.mock("../../src/core/context.js", () => ({
  registerContextProvider: vi.fn(),
  unregisterContextProvider: vi.fn(),
  getContextProvider: vi.fn(),
}));

vi.mock("../../src/core/channels.js", () => ({
  registerChannelProvider: vi.fn(),
  unregisterChannelProvider: vi.fn(),
  getChannelProvider: vi.fn(),
  getChannelProviders: vi.fn(() => []),
}));

vi.mock("../../src/core/config.js", () => ({
  config: {
    get: vi.fn(() => ({ plugins: { data: {} } })),
    load: vi.fn(),
    getValue: vi.fn(),
    setValue: vi.fn(),
    save: vi.fn(),
  },
}));

vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    register: vi.fn(),
    listProviders: vi.fn(() => []),
    getProvider: vi.fn(),
  },
}));

vi.mock("../../src/core/sessions.js", () => ({
  logMessage: vi.fn(),
  cancelInject: vi.fn(),
}));

vi.mock("../../src/core/workspace.js", () => ({
  resolveIdentity: vi.fn(async () => ({ name: "test-agent" })),
  resolveUserProfile: vi.fn(async () => ({ name: "test-user" })),
}));

vi.mock("../../src/plugins/extensions.js", () => ({
  registerPluginExtension: vi.fn(),
  unregisterPluginExtension: vi.fn(),
  getPluginExtension: vi.fn(),
  listPluginExtensions: vi.fn(() => []),
}));

vi.mock("../../src/storage/index.js", () => ({
  getStorage: vi.fn(() => ({ defineTable: vi.fn(), getRepository: vi.fn() })),
}));

// --- Imports (after mocks) ---

import { config as centralConfig } from "../../src/core/config.js";
import {
  getContextProvider as mockGetCtxProvider,
  registerContextProvider as mockRegisterCtxProvider,
  unregisterContextProvider as mockUnregisterCtxProvider,
} from "../../src/core/context.js";
import { cancelInject as mockCancelInject, logMessage as mockLogMessage } from "../../src/core/sessions.js";
import { providerRegistry as mockProviderRegistry } from "../../src/core/providers.js";
import { getCapabilityRegistry } from "../../src/core/capability-registry.js";
import { createPluginEventBus } from "../../src/plugins/event-bus.js";
import { createPluginHookManager } from "../../src/plugins/hook-manager.js";
import { createPluginLogger } from "../../src/plugins/plugin-logger.js";
import { getStorage } from "../../src/storage/index.js";
import { createPluginContext } from "../../src/plugins/context-factory.js";
import {
  channelAdapters,
  channelKey,
  configSchemas,
  providerPlugins,
  setupContextProviders,
  uiComponents,
  webUiExtensions,
} from "../../src/plugins/state.js";
import type { InstalledPlugin } from "../../src/types.js";

// --- Helpers ---

function makePlugin(overrides?: Partial<InstalledPlugin>): InstalledPlugin {
  return {
    name: "test-plugin",
    version: "1.0.0",
    source: "local",
    path: "/fake/path/test-plugin",
    enabled: true,
    installedAt: Date.now(),
    ...overrides,
  };
}

function makeInjectors() {
  return {
    inject: vi.fn(async () => "injected"),
    getSessions: vi.fn(() => ["session-1", "session-2"]),
  };
}

// --- Tests ---

describe("createPluginContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock return values after clearAllMocks
    vi.mocked(centralConfig.get).mockReturnValue({ plugins: { data: {} } } as any);
    vi.mocked(mockProviderRegistry.listProviders).mockReturnValue([]);
    vi.mocked(getCapabilityRegistry).mockReturnValue({
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      getProviders: vi.fn(() => []),
      hasProvider: vi.fn(() => false),
    } as any);
    vi.mocked(createPluginEventBus).mockReturnValue({ on: vi.fn(), off: vi.fn(), emit: vi.fn() } as any);
    vi.mocked(createPluginHookManager).mockReturnValue({ register: vi.fn(), unregister: vi.fn() } as any);
    vi.mocked(createPluginLogger).mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any);
    vi.mocked(getStorage).mockReturnValue({ defineTable: vi.fn(), getRepository: vi.fn() } as any);
    // Clear shared state maps
    channelAdapters.clear();
    webUiExtensions.clear();
    uiComponents.clear();
    configSchemas.clear();
    providerPlugins.clear();
    setupContextProviders.clear();
  });

  describe("shape", () => {
    it("should return an object with all WOPRPluginContext methods", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());

      // Session methods
      expect(typeof ctx.inject).toBe("function");
      expect(typeof ctx.logMessage).toBe("function");
      expect(typeof ctx.getSessions).toBe("function");
      expect(typeof ctx.cancelInject).toBe("function");

      // Event bus & hooks
      expect(ctx.events).toBeDefined();
      expect(ctx.hooks).toBeDefined();

      // Context providers
      expect(typeof ctx.registerContextProvider).toBe("function");
      expect(typeof ctx.unregisterContextProvider).toBe("function");
      expect(typeof ctx.getContextProvider).toBe("function");

      // Channels
      expect(typeof ctx.registerChannel).toBe("function");
      expect(typeof ctx.unregisterChannel).toBe("function");
      expect(typeof ctx.getChannel).toBe("function");
      expect(typeof ctx.getChannels).toBe("function");
      expect(typeof ctx.getChannelsForSession).toBe("function");

      // UI extensions
      expect(typeof ctx.registerWebUiExtension).toBe("function");
      expect(typeof ctx.unregisterWebUiExtension).toBe("function");
      expect(typeof ctx.getWebUiExtensions).toBe("function");
      expect(typeof ctx.registerUiComponent).toBe("function");
      expect(typeof ctx.unregisterUiComponent).toBe("function");
      expect(typeof ctx.getUiComponents).toBe("function");

      // Config
      expect(typeof ctx.getConfig).toBe("function");
      expect(typeof ctx.saveConfig).toBe("function");
      expect(typeof ctx.getMainConfig).toBe("function");

      // LLM providers
      expect(typeof ctx.registerLLMProvider).toBe("function");
      expect(typeof ctx.unregisterLLMProvider).toBe("function");
      expect(typeof ctx.getLLMProvider).toBe("function");

      // Identity
      expect(typeof ctx.getAgentIdentity).toBe("function");
      expect(typeof ctx.getUserProfile).toBe("function");

      // Config schemas
      expect(typeof ctx.registerConfigSchema).toBe("function");
      expect(typeof ctx.unregisterConfigSchema).toBe("function");
      expect(typeof ctx.getConfigSchema).toBe("function");

      // Extensions
      expect(typeof ctx.registerExtension).toBe("function");
      expect(typeof ctx.unregisterExtension).toBe("function");
      expect(typeof ctx.getExtension).toBe("function");
      expect(typeof ctx.listExtensions).toBe("function");

      // Channel providers
      expect(typeof ctx.registerChannelProvider).toBe("function");
      expect(typeof ctx.unregisterChannelProvider).toBe("function");
      expect(typeof ctx.getChannelProvider).toBe("function");
      expect(typeof ctx.getChannelProviders).toBe("function");

      // A2A
      expect(typeof ctx.registerA2AServer).toBe("function");
      expect(typeof ctx.unregisterA2AServer).toBe("function");

      // Logger
      expect(ctx.log).toBeDefined();

      // Plugin dir
      expect(typeof ctx.getPluginDir).toBe("function");

      // Capability
      expect(typeof ctx.registerCapabilityProvider).toBe("function");
      expect(typeof ctx.unregisterCapabilityProvider).toBe("function");
      expect(typeof ctx.getCapabilityProviders).toBe("function");
      expect(typeof ctx.hasCapability).toBe("function");
      expect(typeof ctx.resolveCapability).toBe("function");
      expect(typeof ctx.resolveAllProviders).toBe("function");
      expect(typeof ctx.registerHealthProbe).toBe("function");

      // Setup context provider
      expect(typeof ctx.registerSetupContextProvider).toBe("function");
      expect(typeof ctx.unregisterSetupContextProvider).toBe("function");

      // Storage
      expect(ctx.storage).toBeDefined();
    });
  });

  describe("session delegation", () => {
    it("should delegate inject() to injectors.inject", async () => {
      const injectors = makeInjectors();
      const ctx = createPluginContext(makePlugin(), injectors);

      await ctx.inject("sess-1", "hello", { from: "test" });
      expect(injectors.inject).toHaveBeenCalledWith("sess-1", "hello", { from: "test" });
    });

    it("should delegate getSessions() to injectors.getSessions", () => {
      const injectors = makeInjectors();
      const ctx = createPluginContext(makePlugin(), injectors);

      const sessions = ctx.getSessions();
      expect(sessions).toEqual(["session-1", "session-2"]);
      expect(injectors.getSessions).toHaveBeenCalled();
    });

    it("should delegate logMessage() to core sessions.logMessage", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      ctx.logMessage("sess-1", "hi", { from: "bot" });
      expect(mockLogMessage).toHaveBeenCalledWith("sess-1", "hi", { from: "bot" });
    });

    it("should delegate cancelInject() to core sessions.cancelInject", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      ctx.cancelInject("sess-1");
      expect(mockCancelInject).toHaveBeenCalledWith("sess-1");
    });
  });

  describe("context providers", () => {
    it("should delegate registerContextProvider to core", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const provider = { name: "test", getContext: vi.fn() } as any;
      ctx.registerContextProvider(provider);
      expect(mockRegisterCtxProvider).toHaveBeenCalledWith(provider);
    });

    it("should delegate unregisterContextProvider to core", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      ctx.unregisterContextProvider("test");
      expect(mockUnregisterCtxProvider).toHaveBeenCalledWith("test");
    });

    it("should delegate getContextProvider to core", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      ctx.getContextProvider("test");
      expect(mockGetCtxProvider).toHaveBeenCalledWith("test");
    });
  });

  describe("channel adapters", () => {
    it("should register a channel adapter in the shared map", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const adapter = { channel: { type: "discord", id: "ch-1" }, session: "s1", send: vi.fn() } as any;
      ctx.registerChannel(adapter);
      expect(channelAdapters.get(channelKey({ type: "discord", id: "ch-1" }))).toBe(adapter);
    });

    it("should unregister a channel adapter from the shared map", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const adapter = { channel: { type: "discord", id: "ch-1" }, session: "s1", send: vi.fn() } as any;
      ctx.registerChannel(adapter);
      ctx.unregisterChannel({ type: "discord", id: "ch-1" });
      expect(channelAdapters.has(channelKey({ type: "discord", id: "ch-1" }))).toBe(false);
    });

    it("should get a channel adapter by ref", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const adapter = { channel: { type: "discord", id: "ch-1" }, session: "s1", send: vi.fn() } as any;
      ctx.registerChannel(adapter);
      expect(ctx.getChannel({ type: "discord", id: "ch-1" })).toBe(adapter);
    });

    it("should return all channel adapters", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const a1 = { channel: { type: "discord", id: "1" }, session: "s1", send: vi.fn() } as any;
      const a2 = { channel: { type: "p2p", id: "2" }, session: "s2", send: vi.fn() } as any;
      ctx.registerChannel(a1);
      ctx.registerChannel(a2);
      expect(ctx.getChannels()).toHaveLength(2);
    });

    it("should filter channels by session", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const a1 = { channel: { type: "discord", id: "1" }, session: "s1", send: vi.fn() } as any;
      const a2 = { channel: { type: "p2p", id: "2" }, session: "s2", send: vi.fn() } as any;
      ctx.registerChannel(a1);
      ctx.registerChannel(a2);
      const result = ctx.getChannelsForSession("s1");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(a1);
    });
  });

  describe("web UI extensions", () => {
    it("should register with pluginName:id key", () => {
      const ctx = createPluginContext(makePlugin({ name: "my-plugin" }), makeInjectors());
      const ext = { id: "panel", render: vi.fn() } as any;
      ctx.registerWebUiExtension(ext);
      expect(webUiExtensions.get("my-plugin:panel")).toBe(ext);
    });

    it("should unregister with pluginName:id key", () => {
      const ctx = createPluginContext(makePlugin({ name: "my-plugin" }), makeInjectors());
      const ext = { id: "panel", render: vi.fn() } as any;
      ctx.registerWebUiExtension(ext);
      ctx.unregisterWebUiExtension("panel");
      expect(webUiExtensions.has("my-plugin:panel")).toBe(false);
    });

    it("should return all web UI extensions", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const ext = { id: "panel", render: vi.fn() } as any;
      ctx.registerWebUiExtension(ext);
      expect(ctx.getWebUiExtensions()).toHaveLength(1);
    });
  });

  describe("UI components", () => {
    it("should register with pluginName:id key", () => {
      const ctx = createPluginContext(makePlugin({ name: "my-plugin" }), makeInjectors());
      const comp = { id: "btn", component: "Button" } as any;
      ctx.registerUiComponent(comp);
      expect(uiComponents.get("my-plugin:btn")).toBe(comp);
    });

    it("should unregister with pluginName:id key", () => {
      const ctx = createPluginContext(makePlugin({ name: "my-plugin" }), makeInjectors());
      const comp = { id: "btn", component: "Button" } as any;
      ctx.registerUiComponent(comp);
      ctx.unregisterUiComponent("btn");
      expect(uiComponents.has("my-plugin:btn")).toBe(false);
    });

    it("should return all UI components", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const comp = { id: "btn", component: "Button" } as any;
      ctx.registerUiComponent(comp);
      expect(ctx.getUiComponents()).toHaveLength(1);
    });
  });

  describe("config", () => {
    it("getConfig() should return plugin-specific config from central config", () => {
      vi.mocked(centralConfig.get).mockReturnValue({
        plugins: { data: { "test-plugin": { apiKey: "secret" } } },
      } as any);
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      expect(ctx.getConfig()).toEqual({ apiKey: "secret" });
    });

    it("getConfig() should return empty object when no plugin config exists", () => {
      vi.mocked(centralConfig.get).mockReturnValue({ plugins: { data: {} } } as any);
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      expect(ctx.getConfig()).toEqual({});
    });

    it("getConfig() should return empty object when plugins.data is undefined", () => {
      vi.mocked(centralConfig.get).mockReturnValue({ plugins: {} } as any);
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      expect(ctx.getConfig()).toEqual({});
    });

    it("saveConfig() should persist plugin config to central config", async () => {
      vi.mocked(centralConfig.get).mockReturnValue({ plugins: { data: {} } } as any);
      const ctx = createPluginContext(makePlugin({ name: "my-plug" }), makeInjectors());
      await ctx.saveConfig({ token: "abc" });

      expect(centralConfig.load).toHaveBeenCalled();
      expect(centralConfig.setValue).toHaveBeenCalledWith("plugins.data", { "my-plug": { token: "abc" } });
      expect(centralConfig.save).toHaveBeenCalled();
    });

    it("saveConfig() should initialize plugins.data if undefined", async () => {
      vi.mocked(centralConfig.get).mockReturnValue({ plugins: {} } as any);
      const ctx = createPluginContext(makePlugin({ name: "x" }), makeInjectors());
      await ctx.saveConfig({ key: "val" });

      expect(centralConfig.setValue).toHaveBeenCalledWith("plugins.data", { x: { key: "val" } });
    });

    it("getMainConfig() without key returns full config", () => {
      const fullCfg = { plugins: {}, sessions: {} };
      vi.mocked(centralConfig.get).mockReturnValue(fullCfg as any);
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      expect(ctx.getMainConfig()).toBe(fullCfg);
    });

    it("getMainConfig() with key delegates to config.getValue", () => {
      vi.mocked(centralConfig.getValue).mockReturnValue("some-value");
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      expect(ctx.getMainConfig("sessions.default")).toBe("some-value");
      expect(centralConfig.getValue).toHaveBeenCalledWith("sessions.default");
    });
  });

  describe("LLM providers", () => {
    it("registerLLMProvider() should add to providerPlugins map and registry", () => {
      const capReg = {
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        getProviders: vi.fn(() => []),
        hasProvider: vi.fn(() => false),
      };
      vi.mocked(getCapabilityRegistry).mockReturnValue(capReg as any);
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const provider = { id: "my-llm", name: "My LLM" } as any;
      ctx.registerLLMProvider(provider);

      expect(providerPlugins.get("my-llm")).toBe(provider);
      expect(mockProviderRegistry.register).toHaveBeenCalledWith(provider);
      expect(capReg.registerProvider).toHaveBeenCalledWith("text-gen", {
        id: "my-llm",
        name: "My LLM",
      });
    });

    it("unregisterLLMProvider() should remove from providerPlugins and capability registry", () => {
      const capReg = {
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        getProviders: vi.fn(() => []),
        hasProvider: vi.fn(() => false),
      };
      vi.mocked(getCapabilityRegistry).mockReturnValue(capReg as any);
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      providerPlugins.set("my-llm", { id: "my-llm" } as any);
      ctx.unregisterLLMProvider("my-llm");

      expect(providerPlugins.has("my-llm")).toBe(false);
      expect(capReg.unregisterProvider).toHaveBeenCalledWith("text-gen", "my-llm");
    });

    it("getLLMProvider() should check providerPlugins first", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const provider = { id: "my-llm" } as any;
      providerPlugins.set("my-llm", provider);
      expect(ctx.getLLMProvider("my-llm")).toBe(provider);
    });

    it("getLLMProvider() should fall back to providerRegistry.getProvider", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const provider = { id: "fallback-llm" } as any;
      vi.mocked(mockProviderRegistry.getProvider).mockReturnValue({ provider } as any);
      expect(ctx.getLLMProvider("fallback-llm")).toBe(provider);
    });
  });

  describe("getPluginDir", () => {
    it("should return plugin.path for local source", () => {
      const ctx = createPluginContext(
        makePlugin({ source: "local", path: "/my/local/path" }),
        makeInjectors(),
      );
      expect(ctx.getPluginDir()).toBe("/my/local/path");
    });

    it("should return PLUGINS_DIR/name for non-local source", () => {
      const ctx = createPluginContext(
        makePlugin({ source: "npm", name: "cool-plugin" }),
        makeInjectors(),
      );
      expect(ctx.getPluginDir()).toContain("cool-plugin");
      expect(ctx.getPluginDir()).not.toBe("/fake/path/test-plugin");
    });
  });

  describe("identity", () => {
    it("getAgentIdentity() should delegate to resolveIdentity", async () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const identity = await ctx.getAgentIdentity();
      expect(identity).toEqual({ name: "test-agent" });
    });

    it("getUserProfile() should delegate to resolveUserProfile", async () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const profile = await ctx.getUserProfile();
      expect(profile).toEqual({ name: "test-user" });
    });
  });

  describe("config schemas", () => {
    it("should register and retrieve config schema", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      const schema = { fields: [] } as any;
      ctx.registerConfigSchema("my-plugin", schema);
      expect(configSchemas.get("my-plugin")).toBe(schema);
      expect(ctx.getConfigSchema("my-plugin")).toBe(schema);
    });

    it("should unregister config schema", () => {
      const ctx = createPluginContext(makePlugin(), makeInjectors());
      ctx.registerConfigSchema("my-plugin", {} as any);
      ctx.unregisterConfigSchema("my-plugin");
      expect(configSchemas.has("my-plugin")).toBe(false);
    });
  });

  describe("setup context providers", () => {
    it("should register scoped to plugin name", () => {
      const ctx = createPluginContext(makePlugin({ name: "abc" }), makeInjectors());
      const fn = vi.fn();
      ctx.registerSetupContextProvider(fn);
      expect(setupContextProviders.get("abc")).toBe(fn);
    });

    it("should unregister scoped to plugin name", () => {
      const ctx = createPluginContext(makePlugin({ name: "abc" }), makeInjectors());
      setupContextProviders.set("abc", vi.fn());
      ctx.unregisterSetupContextProvider();
      expect(setupContextProviders.has("abc")).toBe(false);
    });
  });

  describe("isolation", () => {
    it("two contexts from different plugins should not share scoped state", () => {
      const ctxA = createPluginContext(makePlugin({ name: "plugin-a" }), makeInjectors());
      const ctxB = createPluginContext(makePlugin({ name: "plugin-b" }), makeInjectors());

      ctxA.registerWebUiExtension({ id: "panel" } as any);
      ctxB.registerWebUiExtension({ id: "panel" } as any);

      expect(webUiExtensions.has("plugin-a:panel")).toBe(true);
      expect(webUiExtensions.has("plugin-b:panel")).toBe(true);
      expect(webUiExtensions.size).toBe(2);

      ctxA.unregisterWebUiExtension("panel");
      expect(webUiExtensions.has("plugin-a:panel")).toBe(false);
      expect(webUiExtensions.has("plugin-b:panel")).toBe(true);
    });

    it("getConfig returns different data per plugin", () => {
      vi.mocked(centralConfig.get).mockReturnValue({
        plugins: { data: { "plugin-a": { x: 1 }, "plugin-b": { y: 2 } } },
      } as any);
      const ctxA = createPluginContext(makePlugin({ name: "plugin-a" }), makeInjectors());
      const ctxB = createPluginContext(makePlugin({ name: "plugin-b" }), makeInjectors());

      expect(ctxA.getConfig()).toEqual({ x: 1 });
      expect(ctxB.getConfig()).toEqual({ y: 2 });
    });

    it("setup context providers are scoped per plugin", () => {
      const ctxA = createPluginContext(makePlugin({ name: "plugin-a" }), makeInjectors());
      const ctxB = createPluginContext(makePlugin({ name: "plugin-b" }), makeInjectors());
      const fnA = vi.fn();
      const fnB = vi.fn();
      ctxA.registerSetupContextProvider(fnA);
      ctxB.registerSetupContextProvider(fnB);

      expect(setupContextProviders.get("plugin-a")).toBe(fnA);
      expect(setupContextProviders.get("plugin-b")).toBe(fnB);

      ctxA.unregisterSetupContextProvider();
      expect(setupContextProviders.has("plugin-a")).toBe(false);
      expect(setupContextProviders.has("plugin-b")).toBe(true);
    });
  });
});
