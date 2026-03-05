/**
 * Plugin context — the full API surface available to plugins at runtime.
 *
 * This is the canonical definition of WOPRPluginContext. Plugins receive
 * this object during init() and use it to interact with the WOPR daemon.
 */

import type { InjectionSource } from "../security/types.js";
import type { StorageApi } from "../storage/api/plugin-storage.js";
import type { ConversationEntry } from "../types.js";
import type { A2AServerConfig, A2AToolResult } from "./a2a.js";
import type { ChannelAdapter, ChannelProvider, ChannelRef } from "./channel.js";
import type { ConfigSchema } from "./config.js";
import type { ContextProvider } from "./context-provider.js";
import type { WOPREventBus, WOPRHookManager } from "./events.js";
import type { AdapterCapability, ProviderOption } from "./manifest.js";
import type { ModelProvider } from "./provider.js";

/** Trust level for injection sources - defined here to avoid core dependency */
export type TrustLevel = "owner" | "trusted" | "semi-trusted" | "untrusted";

/**
 * Input provided to a setup context provider so it can generate
 * context-aware setup instructions.
 */
export interface SetupContextInput {
  pluginId: string;
  configSchema: ConfigSchema;
  partialConfig: Record<string, unknown>;
}

/**
 * A function that returns setup instructions to prepend to the
 * system prompt during plugin configuration.
 */
export type SetupContextProvider = (input: SetupContextInput) => string;

/**
 * Multimodal message with optional images.
 */
export interface MultimodalMessage {
  text: string;
  images?: string[]; // URLs of images
}

/**
 * Streaming message from the AI provider.
 */
export interface StreamMessage {
  type: "text" | "tool_use" | "complete" | "error" | "system";
  content: string;
  toolName?: string;
  subtype?: string;
  metadata?: Record<string, unknown>;
}

export type StreamCallback = (msg: StreamMessage) => void;

/**
 * Options for plugin inject calls.
 */
export interface PluginInjectOptions {
  silent?: boolean;
  onStream?: StreamCallback;
  from?: string;
  channel?: ChannelRef;
  images?: string[];
  /**
   * Security source for this injection.
   * Describes who is initiating the injection and their trust level.
   */
  source?: InjectionSource;
  /** Control which context providers to use. */
  contextProviders?: string[];
  /** Priority level (higher = processed first within queue) */
  priority?: number;
}

/**
 * Agent persona identity (from IDENTITY.md workspace file).
 */
export interface AgentIdentity {
  name?: string;
  creature?: string;
  vibe?: string;
  emoji?: string;
}

/**
 * User profile (from USER.md workspace file).
 */
export interface UserProfile {
  name?: string;
  preferredAddress?: string;
  pronouns?: string;
  timezone?: string;
  notes?: string;
}

/**
 * Web UI navigation extension — plugins register links in the dashboard.
 */
export interface WebUiExtension {
  id: string;
  title: string;
  url: string;
  description?: string;
  category?: string;
}

/**
 * UI component extension — plugins export SolidJS components that render inline.
 */
export interface UiComponentExtension {
  id: string;
  title: string;
  moduleUrl: string;
  slot: "sidebar" | "settings" | "statusbar" | "chat-header" | "chat-footer";
  description?: string;
}

/**
 * Props passed to plugin UI components.
 */
export interface PluginUiComponentProps {
  api: {
    getSessions: () => Promise<{ sessions: unknown[] }>;
    inject: (session: string, message: string) => Promise<unknown>;
    getConfig: () => Promise<unknown>;
    setConfigValue: (key: string, value: unknown) => Promise<void>;
  };
  currentSession?: string;
  pluginConfig: unknown;
  saveConfig: (config: unknown) => Promise<void>;
}

/**
 * Plugin logger interface.
 */
export interface PluginLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * The full plugin context API.
 *
 * This is the canonical interface that all plugins receive during init().
 * It provides access to sessions, events, hooks, channels, config, UI
 * extensions, A2A tools, and more.
 */
export interface WOPRPluginContext {
  // Inject into local session, get response (with optional streaming)
  inject(session: string, message: string | MultimodalMessage, options?: PluginInjectOptions): Promise<string>;

  // Log a message without triggering a response
  logMessage(
    session: string,
    message: string,
    options?: { from?: string; senderId?: string; channel?: ChannelRef },
  ): void;

  // Agent persona identity
  getAgentIdentity(): AgentIdentity | Promise<AgentIdentity>;

  // User profile
  getUserProfile(): UserProfile | Promise<UserProfile>;

  // Sessions
  getSessions(): string[];

  // Cancel in-progress injection
  cancelInject(session: string): boolean;

  // Event bus
  events: WOPREventBus;

  // Hook manager
  hooks: WOPRHookManager;

  // Context providers
  registerContextProvider(provider: ContextProvider): void;
  unregisterContextProvider(name: string): void;
  getContextProvider(name: string): ContextProvider | undefined;

  // Channels
  registerChannel(adapter: ChannelAdapter): void;
  unregisterChannel(channel: ChannelRef): void;
  getChannel(channel: ChannelRef): ChannelAdapter | undefined;
  getChannels(): ChannelAdapter[];
  getChannelsForSession(session: string): ChannelAdapter[];

  // Web UI extensions
  registerWebUiExtension(extension: WebUiExtension): void;
  unregisterWebUiExtension(id: string): void;
  getWebUiExtensions(): WebUiExtension[];

  // UI Component extensions
  registerUiComponent(extension: UiComponentExtension): void;
  unregisterUiComponent(id: string): void;
  getUiComponents(): UiComponentExtension[];

  // Plugin config
  getConfig<T = unknown>(): T;
  saveConfig<T = unknown>(config: T): Promise<void>;

  // Main WOPR config (read-only)
  getMainConfig(key?: string): unknown;

  // LLM providers (credential management + dispatch)
  registerLLMProvider(provider: ModelProvider): void;
  unregisterLLMProvider(id: string): void;
  getLLMProvider(id: string): ModelProvider | undefined;

  // Config schemas
  registerConfigSchema(pluginId: string, schema: ConfigSchema): void;
  unregisterConfigSchema(pluginId: string): void;
  getConfigSchema(pluginId: string): ConfigSchema | undefined;

  // Plugin extensions (inter-plugin APIs)
  registerExtension(name: string, extension: unknown): void;
  unregisterExtension(name: string): void;
  getExtension<T = unknown>(name: string): T | undefined;
  listExtensions(): string[];

  // Channel providers
  registerChannelProvider(provider: ChannelProvider): void;
  unregisterChannelProvider(id: string): void;
  getChannelProvider(id: string): ChannelProvider | undefined;
  getChannelProviders(): ChannelProvider[];

  // A2A tools
  registerA2AServer(config: A2AServerConfig): void;
  unregisterA2AServer(config: A2AServerConfig): void;
  /** Get a resolved A2A tool declared in toolDependencies. Returns undefined if optional and not found. */
  getA2ATool(toolName: string): ((args: Record<string, unknown>) => Promise<A2AToolResult>) | undefined;

  // Logging
  log: PluginLogger;

  // Plugin directory
  getPluginDir(): string;

  // Capability registry (new)
  registerCapabilityProvider(capability: AdapterCapability, provider: ProviderOption): void;
  unregisterCapabilityProvider(capability: AdapterCapability, providerId: string): void;
  getCapabilityProviders(capability: AdapterCapability): ProviderOption[];
  hasCapability(capability: AdapterCapability): boolean;

  /**
   * Resolve the best provider for a given capability.
   * Returns null if no providers are registered (or none are healthy).
   */
  resolveCapability(
    capability: AdapterCapability,
    options?: { preferredProvider?: string; healthyOnly?: boolean },
  ): { capability: AdapterCapability; provider: ProviderOption; healthy: boolean } | null;

  /**
   * Resolve all providers for a capability, sorted by health status.
   */
  resolveAllProviders(capability: AdapterCapability): Array<{
    capability: AdapterCapability;
    provider: ProviderOption;
    healthy: boolean;
  }>;

  /** Register a health probe for a capability provider this plugin provides */
  registerHealthProbe?(capability: string, providerId: string, probe: () => Promise<boolean>): void;

  // Setup context providers - plugins provide AI instructions for their own setup flow
  registerSetupContextProvider(fn: SetupContextProvider): void;
  unregisterSetupContextProvider(): void;

  // Security registration — plugins register their permissions, sources, and tool mappings
  registerPermission(name: string): void;
  registerInjectionSource(name: string, trustLevel: TrustLevel): void;
  registerToolPermission(toolName: string, permission: string): void;
  unregisterPermission(name: string): void;
  unregisterInjectionSource(name: string): void;
  unregisterToolPermission(toolName: string): void;

  // Storage API - plugin-extensible database storage
  storage: StorageApi;

  // Session context and conversation log APIs
  session: SessionApi;
}

/**
 * SQL-backed session APIs exposed to plugins via ctx.session.*
 */
export interface SessionApi {
  /** Get a session context file by name and filename. Returns null if not found. */
  getContext(sessionName: string, filename: string): Promise<string | null>;
  /** Upsert a session context file. */
  setContext(sessionName: string, filename: string, content: string, source: "global" | "session"): Promise<void>;
  /** Read conversation log entries for a session, optionally limited to the last N entries. */
  readConversationLog(sessionName: string, limit?: number): Promise<ConversationEntry[]>;
}
