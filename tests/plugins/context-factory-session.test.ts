/**
 * Tests that ctx.session.* extensions are present and callable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the factory
vi.mock("../../src/core/session-context-repository.js", () => ({
  getSessionContext: vi.fn().mockResolvedValue("ctx-content"),
  setSessionContext: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/core/session-repository.js", () => ({
  readConversationLogAsync: vi.fn().mockResolvedValue([{ ts: 1, from: "user", content: "hi", type: "message" }]),
}));
vi.mock("../../src/core/sessions.js", () => ({
  cancelInject: vi.fn().mockReturnValue(false),
  logMessage: vi.fn(),
}));
vi.mock("../../src/core/a2a-mcp.js", () => ({ unregisterA2ATool: vi.fn().mockReturnValue(true) }));
vi.mock("../../src/core/capability-health.js", () => ({ getCapabilityHealthProber: vi.fn().mockReturnValue({ registerProbe: vi.fn() }) }));
vi.mock("../../src/core/capability-registry.js", () => ({ getCapabilityRegistry: vi.fn().mockReturnValue({ registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProviders: vi.fn().mockReturnValue([]), hasProvider: vi.fn().mockReturnValue(false) }) }));
vi.mock("../../src/core/capability-resolver.js", () => ({ resolveCapability: vi.fn().mockReturnValue(null), resolveAllProviders: vi.fn().mockReturnValue([]) }));
vi.mock("../../src/core/channels.js", () => ({ getChannelProvider: vi.fn(), getChannelProviders: vi.fn().mockReturnValue([]), registerChannelProvider: vi.fn(), unregisterChannelProvider: vi.fn() }));
vi.mock("../../src/core/config.js", () => ({ config: { get: vi.fn().mockReturnValue({ plugins: { data: {} } }), getValue: vi.fn(), load: vi.fn(), setValue: vi.fn(), save: vi.fn() } }));
vi.mock("../../src/core/context.js", () => ({ getContextProvider: vi.fn(), registerContextProvider: vi.fn(), unregisterContextProvider: vi.fn() }));
vi.mock("../../src/core/providers.js", () => ({ providerRegistry: { register: vi.fn(), getProvider: vi.fn() } }));
vi.mock("../../src/core/workspace.js", () => ({ resolveIdentity: vi.fn().mockResolvedValue({}), resolveUserProfile: vi.fn().mockResolvedValue({}) }));
vi.mock("../../src/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../src/storage/index.js", () => ({ getStorage: vi.fn().mockReturnValue({}) }));
vi.mock("../../src/plugins/event-bus.js", () => ({ createPluginEventBus: vi.fn().mockReturnValue({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() }) }));
vi.mock("../../src/plugins/extensions.js", () => ({ getPluginExtension: vi.fn(), listPluginExtensions: vi.fn().mockReturnValue([]), registerPluginExtension: vi.fn(), unregisterPluginExtension: vi.fn() }));
vi.mock("../../src/plugins/hook-manager.js", () => ({ createPluginHookManager: vi.fn().mockReturnValue({ on: vi.fn(), off: vi.fn(), offByName: vi.fn(), list: vi.fn().mockReturnValue([]) }) }));
vi.mock("../../src/plugins/plugin-logger.js", () => ({ createPluginLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock("../../src/plugins/schema-converter.js", () => ({ registerA2AServerImpl: vi.fn() }));
vi.mock("../../src/plugins/state.js", () => ({
  channelAdapters: new Map(),
  channelKey: vi.fn().mockReturnValue("k"),
  configSchemas: new Map(),
  PLUGINS_DIR: "/tmp/plugins",
  providerPlugins: new Map(),
  resolvedA2ATools: new Map(),
  setupContextProviders: new Map(),
  uiComponents: new Map(),
  webUiExtensions: new Map(),
}));

import { createPluginContext } from "../../src/plugins/context-factory.js";
import { getSessionContext, setSessionContext } from "../../src/core/session-context-repository.js";
import { readConversationLogAsync } from "../../src/core/session-repository.js";

const makePlugin = () =>
  ({
    name: "test-plugin",
    source: "local",
    path: "/tmp/test-plugin",
    manifest: {},
  }) as Parameters<typeof createPluginContext>[0];

const makeInjectors = () => ({
  inject: vi.fn().mockResolvedValue("response"),
  getSessions: vi.fn().mockReturnValue([]),
});

describe("ctx.session extensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes a session namespace on the plugin context", () => {
    const ctx = createPluginContext(makePlugin(), makeInjectors());
    expect(ctx.session).toBeDefined();
    expect(typeof ctx.session.getContext).toBe("function");
    expect(typeof ctx.session.setContext).toBe("function");
    expect(typeof ctx.session.readConversationLog).toBe("function");
  });

  it("ctx.session.getContext delegates to getSessionContext", async () => {
    const ctx = createPluginContext(makePlugin(), makeInjectors());
    const result = await ctx.session.getContext("my-session", "notes.md");
    expect(getSessionContext).toHaveBeenCalledWith("my-session", "notes.md");
    expect(result).toBe("ctx-content");
  });

  it("ctx.session.setContext delegates to setSessionContext", async () => {
    const ctx = createPluginContext(makePlugin(), makeInjectors());
    await ctx.session.setContext("my-session", "notes.md", "content", "global");
    expect(setSessionContext).toHaveBeenCalledWith("my-session", "notes.md", "content", "global");
  });

  it("ctx.session.readConversationLog delegates to readConversationLogAsync", async () => {
    const ctx = createPluginContext(makePlugin(), makeInjectors());
    const entries = await ctx.session.readConversationLog("my-session", 10);
    expect(readConversationLogAsync).toHaveBeenCalledWith("my-session", 10);
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("hi");
  });
});
