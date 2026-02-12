/**
 * @wopr-network/plugin-types — canonical type definitions for WOPR plugins.
 *
 * This is the single source of truth for all plugin-facing types.
 * Plugins should import from here instead of defining their own copies.
 *
 * Usage (once published as @wopr-network/plugin-types):
 *   import type { WOPRPlugin, WOPRPluginContext, ConfigSchema } from "@wopr-network/plugin-types";
 *
 * Usage (from within the wopr monorepo):
 *   import type { WOPRPlugin, WOPRPluginContext, ConfigSchema } from "../plugin-types/index.js";
 */

// A2A types
export type { A2AServerConfig, A2AToolDefinition, A2AToolResult } from "./a2a.js";
// Channel types
export type {
  ChannelAdapter,
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
  ChannelRef,
} from "./channel.js";
// Config types
export type { ConfigField, ConfigSchema, SetupFlowType } from "./config.js";

// Context (the runtime API plugins receive)
export type {
  AgentIdentity,
  MultimodalMessage,
  PluginInjectOptions,
  PluginLogger,
  PluginUiComponentProps,
  StreamCallback,
  StreamMessage,
  UiComponentExtension,
  UserProfile,
  WebUiExtension,
  WOPRPluginContext,
} from "./context.js";
// Context provider types
export type { ContextPart, ContextProvider, MessageInfo } from "./context-provider.js";

// Event and hook types
export type {
  ChannelMessageEvent,
  ChannelMessageHandler,
  ChannelSendEvent,
  ConfigChangeEvent,
  EventHandler,
  HookOptions,
  MemoryFileChange,
  MemoryFilesChangedEvent,
  MemorySearchEvent,
  MessageIncomingHandler,
  MessageOutgoingHandler,
  MutableHookEvent,
  PluginErrorEvent,
  PluginInitEvent,
  SessionCreateEvent,
  SessionCreateHandler,
  SessionDestroyEvent,
  SessionDestroyHandler,
  SessionInjectEvent,
  SessionResponseChunkEvent,
  SessionResponseEvent,
  SystemShutdownEvent,
  WOPREvent,
  WOPREventBus,
  WOPREventMap,
  WOPRHookManager,
} from "./events.js";
// Manifest types
export type {
  InstallMethod,
  NetworkRequirements,
  PluginCapability,
  PluginCategory,
  PluginLifecycle,
  PluginManifest,
  PluginRequirements,
  SetupStep,
  StorageRequirements,
} from "./manifest.js";
// Core plugin types
export type { InstalledPlugin, PluginCommand, PluginRegistryEntry, WOPRPlugin } from "./plugin.js";
