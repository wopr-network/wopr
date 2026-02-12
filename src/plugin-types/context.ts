/**
 * Plugin context — the full API surface available to plugins at runtime.
 *
 * This is the canonical definition of WOPRPluginContext. Plugins receive
 * this object during init() and use it to interact with the WOPR daemon.
 */

import type { A2AServerConfig } from "./a2a.js";
import type { ChannelAdapter, ChannelProvider, ChannelRef } from "./channel.js";
import type { ConfigSchema } from "./config.js";
import type { ContextProvider } from "./context-provider.js";
import type { WOPREventBus, WOPRHookManager } from "./events.js";

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
   * Uses InjectionSource from security types when provided.
   */
  source?: unknown;
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
 * STT provider interface (minimal, for context typing).
 * Full definition lives in voice/types.ts.
 */
export interface STTProviderRef {
  readonly metadata: { name: string; type: "stt" };
}

/**
 * TTS provider interface (minimal, for context typing).
 * Full definition lives in voice/types.ts.
 */
export interface TTSProviderRef {
  readonly metadata: { name: string; type: "tts" };
}

/**
 * The full plugin context API.
 *
 * This is the canonical interface that all plugins receive during init().
 * It provides access to sessions, events, hooks, channels, config, UI
 * extensions, voice, A2A tools, and more.
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

  // Model providers
  registerProvider(provider: unknown): void;
  unregisterProvider(id: string): void;
  getProvider(id: string): unknown;

  // Config schemas
  registerConfigSchema(pluginId: string, schema: ConfigSchema): void;
  unregisterConfigSchema(pluginId: string): void;
  getConfigSchema(pluginId: string): ConfigSchema | undefined;

  // Plugin extensions (inter-plugin APIs)
  registerExtension(name: string, extension: unknown): void;
  unregisterExtension(name: string): void;
  getExtension<T = unknown>(name: string): T | undefined;
  listExtensions(): string[];

  // Voice providers
  registerSTTProvider(provider: unknown): void;
  registerTTSProvider(provider: unknown): void;
  getSTT(): unknown;
  getTTS(): unknown;
  hasVoice(): { stt: boolean; tts: boolean };

  // Channel providers
  registerChannelProvider(provider: ChannelProvider): void;
  unregisterChannelProvider(id: string): void;
  getChannelProvider(id: string): ChannelProvider | undefined;
  getChannelProviders(): ChannelProvider[];

  // A2A tools
  registerA2AServer?(config: A2AServerConfig): void;

  // Logging
  log: PluginLogger;

  // Plugin directory
  getPluginDir(): string;
}
