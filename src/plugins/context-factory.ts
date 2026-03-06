/**
 * Plugin context factory.
 *
 * Builds the WOPRPluginContext object that every plugin receives during init.
 * This is the main API surface plugins interact with.
 */

import { join } from "node:path";
import { unregisterA2ATool } from "../core/a2a-mcp.js";
import { getCapabilityHealthProber } from "../core/capability-health.js";
import { getCapabilityRegistry } from "../core/capability-registry.js";
import { resolveAllProviders, resolveCapability } from "../core/capability-resolver.js";
import {
  getChannelProvider as getChannelProviderCore,
  getChannelProviders as getChannelProvidersCore,
  registerChannelProvider as registerChannelProviderCore,
  unregisterChannelProvider as unregisterChannelProviderCore,
} from "../core/channels.js";
import { config as centralConfig } from "../core/config.js";
import {
  getContextProvider as getCtxProvider,
  registerContextProvider as registerCtxProvider,
  unregisterContextProvider as unregisterCtxProvider,
} from "../core/context.js";
import { providerRegistry } from "../core/providers.js";
import { getSessionContext, setSessionContext } from "../core/session-context-repository.js";
import { readConversationLogAsync } from "../core/session-repository.js";
import { cancelInject as cancelSessionInject, logMessage as logMessageToSession } from "../core/sessions.js";
import { resolveIdentity, resolveUserProfile } from "../core/workspace.js";
import { logger } from "../logger.js";
import type { AdapterCapability, ProviderOption } from "../plugin-types/manifest.js";
import { getSecurityRegistry } from "../security/registry.js";
import { getStorage } from "../storage/index.js";
import type { ModelProvider } from "../types/provider.js";
import type {
  ChannelAdapter,
  ChannelProvider,
  ChannelRef,
  ConfigSchema,
  ContextProvider,
  InstalledPlugin,
  PluginInjectOptions,
  SetupContextProvider,
  UiComponentExtension,
  WebUiExtension,
  WOPRPluginContext,
} from "../types.js";
import { createPluginEventBus } from "./event-bus.js";
import {
  getPluginExtension,
  listPluginExtensions,
  registerPluginExtension,
  unregisterPluginExtension,
} from "./extensions.js";
import { createPluginHookManager } from "./hook-manager.js";
import { createPluginLogger } from "./plugin-logger.js";
import { registerA2AServerImpl } from "./schema-converter.js";
import {
  channelAdapters,
  channelKey,
  configSchemas,
  PLUGINS_DIR,
  providerPlugins,
  resolvedA2ATools,
  setupContextProviders,
  uiComponents,
  webUiExtensions,
} from "./state.js";

export function createPluginContext(
  plugin: InstalledPlugin,
  injectors: {
    inject: (session: string, message: string, options?: PluginInjectOptions) => Promise<string>;
    getSessions: () => string[] | Promise<string[]>;
  },
): WOPRPluginContext {
  const pluginName = plugin.name;

  return {
    inject: (session: string, message: string, options?: PluginInjectOptions) =>
      injectors.inject(session, message, options),
    logMessage: (
      session: string,
      message: string,
      options?: { from?: string; senderId?: string; channel?: ChannelRef },
    ) => logMessageToSession(session, message, options),
    getSessions: injectors.getSessions,
    cancelInject: (session: string) => cancelSessionInject(session),

    // Event bus - reactive primitive for plugin composition
    events: createPluginEventBus(pluginName),

    // Hooks - typed shorthand for common event patterns
    hooks: createPluginHookManager(pluginName),

    registerContextProvider(provider: ContextProvider) {
      registerCtxProvider(provider);
    },

    unregisterContextProvider(name: string) {
      unregisterCtxProvider(name);
    },

    getContextProvider(name: string): ContextProvider | undefined {
      return getCtxProvider(name);
    },

    registerChannel(adapter: ChannelAdapter) {
      channelAdapters.set(channelKey(adapter.channel), adapter);
    },

    unregisterChannel(channel: ChannelRef) {
      channelAdapters.delete(channelKey(channel));
    },

    getChannel(channel: ChannelRef) {
      return channelAdapters.get(channelKey(channel));
    },

    getChannels() {
      return Array.from(channelAdapters.values());
    },

    getChannelsForSession(session: string) {
      return Array.from(channelAdapters.values()).filter((adapter) => adapter.session === session);
    },

    registerWebUiExtension(extension: WebUiExtension) {
      webUiExtensions.set(`${pluginName}:${extension.id}`, extension);
    },

    unregisterWebUiExtension(id: string) {
      webUiExtensions.delete(`${pluginName}:${id}`);
    },

    getWebUiExtensions() {
      return Array.from(webUiExtensions.values());
    },

    registerUiComponent(extension: UiComponentExtension) {
      uiComponents.set(`${pluginName}:${extension.id}`, extension);
    },

    unregisterUiComponent(id: string) {
      uiComponents.delete(`${pluginName}:${id}`);
    },

    getUiComponents() {
      return Array.from(uiComponents.values());
    },

    getConfig<T>(): T {
      // Load from central config
      const cfg = centralConfig.get();
      return (cfg.plugins.data?.[pluginName] || {}) as T;
    },

    async saveConfig<T>(pluginConfig: T): Promise<void> {
      // Save to central config
      await centralConfig.load();
      const cfg = centralConfig.get();
      if (!cfg.plugins.data) cfg.plugins.data = {};
      cfg.plugins.data[pluginName] = pluginConfig;
      centralConfig.setValue("plugins.data", cfg.plugins.data);
      await centralConfig.save();
    },

    getMainConfig(key?: string): unknown {
      // Access main WOPR config (read-only)
      const cfg = centralConfig.get();
      if (!key) return cfg;
      return centralConfig.getValue(key);
    },

    registerLLMProvider(provider: ModelProvider) {
      logger.info(`[plugins] Provider registration: ${provider.id} (${provider.name})`);
      providerPlugins.set(provider.id, provider);
      providerRegistry.register(provider);
      logger.info(`[plugins]   Provider ${provider.id} registered in registry`);
      // Register in capability registry
      getCapabilityRegistry().registerProvider("text-gen", {
        id: provider.id,
        name: provider.name,
      });
    },

    unregisterLLMProvider(id: string) {
      providerPlugins.delete(id);
      // Note: providerRegistry doesn't have unregister, providers are removed from runtime only
      // Unregister from capability registry
      getCapabilityRegistry().unregisterProvider("text-gen", id);
    },

    getLLMProvider(id: string): ModelProvider | undefined {
      return providerPlugins.get(id) ?? providerRegistry.getProvider(id)?.provider;
    },

    async getAgentIdentity() {
      // Resolve from workspace IDENTITY.md
      return await resolveIdentity();
    },

    async getUserProfile() {
      // Resolve from workspace USER.md
      return await resolveUserProfile();
    },

    registerConfigSchema(pluginId: string, schema: ConfigSchema) {
      configSchemas.set(pluginId, schema);
    },

    unregisterConfigSchema(pluginId: string) {
      configSchemas.delete(pluginId);
    },

    getConfigSchema(pluginId: string): ConfigSchema | undefined {
      return configSchemas.get(pluginId);
    },

    // Plugin extensions - allow plugins to expose APIs to other plugins
    registerExtension(name: string, extension: unknown) {
      registerPluginExtension(pluginName, name, extension);
    },

    unregisterExtension(name: string) {
      unregisterPluginExtension(pluginName, name);
    },

    getExtension<T = unknown>(name: string): T | undefined {
      return getPluginExtension<T>(name);
    },

    listExtensions(): string[] {
      return listPluginExtensions();
    },

    // Channel providers - channel plugins register themselves for cross-plugin protocol commands
    registerChannelProvider(provider: ChannelProvider) {
      registerChannelProviderCore(provider);
    },

    unregisterChannelProvider(id: string) {
      unregisterChannelProviderCore(id);
    },

    getChannelProvider(id: string): ChannelProvider | undefined {
      return getChannelProviderCore(id);
    },

    getChannelProviders(): ChannelProvider[] {
      return getChannelProvidersCore();
    },

    // A2A tools - plugins register MCP tools for agent-to-agent communication
    registerA2AServer(config: import("../plugin-types/a2a.js").A2AServerConfig) {
      registerA2AServerImpl(pluginName, config);
    },

    getA2ATool(toolName: string) {
      const pluginToolMap = resolvedA2ATools.get(pluginName);
      if (!pluginToolMap) return undefined;
      return pluginToolMap.get(toolName);
    },

    // Cleanup A2A tools on plugin shutdown
    unregisterA2AServer(config: import("../plugin-types/a2a.js").A2AServerConfig) {
      for (const tool of config.tools) {
        const removed = unregisterA2ATool(`${pluginName}:${tool.name}`);
        if (!removed) {
          logger.warn(`unregisterA2ATool: tool not found`, { toolId: `${pluginName}:${tool.name}` });
        }
      }
    },

    log: createPluginLogger(plugin.name),

    getPluginDir(): string {
      return plugin.source === "local" ? plugin.path : join(PLUGINS_DIR, plugin.name);
    },

    // Capability registry (new)
    registerCapabilityProvider(capability: AdapterCapability, provider: ProviderOption) {
      getCapabilityRegistry().registerProvider(capability, provider);
    },

    unregisterCapabilityProvider(capability: AdapterCapability, providerId: string) {
      getCapabilityRegistry().unregisterProvider(capability, providerId);
    },

    getCapabilityProviders(capability: AdapterCapability): ProviderOption[] {
      return getCapabilityRegistry().getProviders(capability);
    },

    hasCapability(capability: AdapterCapability): boolean {
      return getCapabilityRegistry().hasProvider(capability);
    },

    resolveCapability(capability: AdapterCapability, options?: { preferredProvider?: string; healthyOnly?: boolean }) {
      return resolveCapability(capability, options);
    },

    resolveAllProviders(capability: AdapterCapability) {
      return resolveAllProviders(capability);
    },

    registerHealthProbe(capability: string, providerId: string, probe: () => Promise<boolean>): void {
      getCapabilityHealthProber().registerProbe(capability, providerId, probe);
    },

    registerSetupContextProvider(fn: SetupContextProvider): void {
      setupContextProviders.set(pluginName, fn);
    },

    unregisterSetupContextProvider(): void {
      setupContextProviders.delete(pluginName);
    },

    // Security registration
    registerPermission(name: string) {
      getSecurityRegistry().registerPermission(name, pluginName);
    },

    registerInjectionSource(name: string, trustLevel: import("../types.js").TrustLevel) {
      getSecurityRegistry().registerInjectionSource(name, trustLevel, pluginName);
    },

    registerToolPermission(toolName: string, permission: string) {
      if (toolName.includes(":")) {
        throw new Error(
          `Tool name must be a bare name (e.g., "sessions_send"), not a namespaced name (e.g., "plugin:sessions_send"). The security system enforces permissions on bare tool names.`,
        );
      }
      getSecurityRegistry().registerToolCapability(toolName, permission, pluginName);
    },

    unregisterPermission(name: string) {
      getSecurityRegistry().unregisterPermission(name, pluginName);
    },

    unregisterInjectionSource(name: string) {
      getSecurityRegistry().unregisterInjectionSource(name, pluginName);
    },

    unregisterToolPermission(toolName: string) {
      getSecurityRegistry().unregisterToolCapability(toolName, pluginName);
    },

    // Storage API - plugin-extensible database storage
    storage: getStorage(),

    // Session context and conversation log APIs
    session: {
      getContext: (sessionName: string, filename: string) => getSessionContext(sessionName, filename),
      setContext: (sessionName: string, filename: string, content: string, source: "global" | "session") =>
        setSessionContext(sessionName, filename, content, source),
      readConversationLog: (sessionName: string, limit?: number) => readConversationLogAsync(sessionName, limit),
    },
  };
}
