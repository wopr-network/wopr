/**
 * Event and hook types for the WOPR plugin system.
 *
 * The event bus provides reactive composition between plugins.
 * Hooks provide typed lifecycle interception points.
 */

import type { ChannelRef } from "./channel.js";

// ============================================================================
// Event Types
// ============================================================================

/**
 * Base event interface — all events extend this.
 */
export interface WOPREvent {
  type: string;
  payload: unknown;
  timestamp: number;
  source?: string;
}

// Session lifecycle events
export interface SessionCreateEvent {
  session: string;
  config?: unknown;
}

export interface SessionInjectEvent {
  session: string;
  message: string;
  from: string;
  channel?: { type: string; id: string; name?: string };
}

export interface SessionResponseEvent {
  session: string;
  message: string;
  response: string;
  from: string;
}

export interface SessionResponseChunkEvent extends SessionResponseEvent {
  chunk: string;
}

export interface SessionDestroyEvent {
  session: string;
  history: unknown[];
  reason?: string;
}

// Channel events
export interface ChannelMessageEvent {
  channel: { type: string; id: string; name?: string };
  message: string;
  from: string;
  metadata?: unknown;
}

export interface ChannelSendEvent {
  channel: { type: string; id: string };
  content: string;
}

// Plugin events
export interface PluginInitEvent {
  plugin: string;
  version: string;
}

export interface PluginErrorEvent {
  plugin: string;
  error: Error;
  context?: string;
}

export interface PluginDrainingEvent {
  plugin: string;
  timeoutMs: number;
}

export interface PluginDrainedEvent {
  plugin: string;
  durationMs: number;
  timedOut: boolean;
}

export interface PluginActivatedEvent {
  plugin: string;
  version: string;
}

export interface PluginDeactivatedEvent {
  plugin: string;
  version: string;
  drained: boolean;
}

// Config events
export interface ConfigChangeEvent {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  plugin?: string;
}

// System events
export interface SystemShutdownEvent {
  reason: string;
  code?: number;
}

// Memory events
export interface MemoryFileChange {
  action: "upsert" | "delete";
  path: string;
  absPath?: string;
  source: "global" | "session" | "sessions";
  chunks?: Array<{
    id: string;
    text: string;
    hash: string;
    startLine: number;
    endLine: number;
  }>;
}

export interface MemoryFilesChangedEvent {
  changes: MemoryFileChange[];
}

export interface MemorySearchEvent {
  query: string;
  maxResults: number;
  minScore: number;
  sessionName: string;
  results: unknown[] | null;
}

// Capability registry events
export interface CapabilityProviderRegisteredEvent {
  capability: string;
  providerId: string;
  providerName: string;
}

export interface CapabilityProviderUnregisteredEvent {
  capability: string;
  providerId: string;
}

/**
 * Event map — all core events and their payloads.
 */
export interface WOPREventMap {
  "session:create": SessionCreateEvent;
  "session:beforeInject": SessionInjectEvent;
  "session:afterInject": SessionResponseEvent;
  "session:responseChunk": SessionResponseChunkEvent;
  "session:destroy": SessionDestroyEvent;
  "channel:message": ChannelMessageEvent;
  "channel:send": ChannelSendEvent;
  "plugin:beforeInit": PluginInitEvent;
  "plugin:afterInit": PluginInitEvent;
  "plugin:error": PluginErrorEvent;
  "plugin:draining": PluginDrainingEvent;
  "plugin:drained": PluginDrainedEvent;
  "plugin:activated": PluginActivatedEvent;
  "plugin:deactivated": PluginDeactivatedEvent;
  "config:change": ConfigChangeEvent;
  "system:shutdown": SystemShutdownEvent;
  "memory:search": MemorySearchEvent;
  "memory:filesChanged": MemoryFilesChangedEvent;
  "capability:providerRegistered": CapabilityProviderRegisteredEvent;
  "capability:providerUnregistered": CapabilityProviderUnregisteredEvent;
  "*": WOPREvent;
}

/**
 * Event handler type.
 */
export type EventHandler<T = unknown> = (payload: T, event: WOPREvent) => void | Promise<void>;

/**
 * Event bus interface — reactive primitive for plugins.
 */
export interface WOPREventBus {
  on<T extends keyof WOPREventMap>(event: T, handler: EventHandler<WOPREventMap[T]>): () => void;
  once<T extends keyof WOPREventMap>(event: T, handler: EventHandler<WOPREventMap[T]>): void;
  off<T extends keyof WOPREventMap>(event: T, handler: EventHandler<WOPREventMap[T]>): void;
  emit<T extends keyof WOPREventMap>(event: T, payload: WOPREventMap[T]): Promise<void>;
  emitCustom(event: string, payload: unknown): Promise<void>;
  listenerCount(event: string): number;
}

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Hook event with mutable state (for before hooks).
 */
export interface MutableHookEvent<T> {
  data: T;
  session: string;
  preventDefault(): void;
  isPrevented(): boolean;
}

/**
 * Hook options — priority ordering and identification.
 */
export interface HookOptions {
  /** Lower = runs first (default: 100) */
  priority?: number;
  /** Name for debugging and removal */
  name?: string;
  /** Run once then auto-remove */
  once?: boolean;
}

/**
 * Hook handler types.
 */
export type MessageIncomingHandler = (
  event: MutableHookEvent<{ message: string; from: string; channel?: ChannelRef }>,
) => void | Promise<void>;

export type MessageOutgoingHandler = (
  event: MutableHookEvent<{ response: string; from: string; channel?: ChannelRef }>,
) => void | Promise<void>;

export type SessionCreateHandler = (event: { session: string; config?: unknown }) => void | Promise<void>;

export type SessionDestroyHandler = (event: {
  session: string;
  history: unknown[];
  reason?: string;
}) => void | Promise<void>;

export type ChannelMessageHandler = (
  event: MutableHookEvent<{ channel: ChannelRef; message: string; from: string; metadata?: unknown }>,
) => void | Promise<void>;

/**
 * Hook manager — typed hooks for core lifecycle events.
 */
export interface WOPRHookManager {
  // Mutable hooks — can transform data or block
  on(event: "message:incoming", handler: MessageIncomingHandler, options?: HookOptions): () => void;
  on(event: "message:outgoing", handler: MessageOutgoingHandler, options?: HookOptions): () => void;
  on(event: "channel:message", handler: ChannelMessageHandler, options?: HookOptions): () => void;

  // Read-only hooks — observe lifecycle
  on(event: "session:create", handler: SessionCreateHandler, options?: HookOptions): () => void;
  on(event: "session:destroy", handler: SessionDestroyHandler, options?: HookOptions): () => void;

  // Remove by handler reference
  off(event: "message:incoming", handler: MessageIncomingHandler): void;
  off(event: "message:outgoing", handler: MessageOutgoingHandler): void;
  off(event: "channel:message", handler: ChannelMessageHandler): void;
  off(event: "session:create", handler: SessionCreateHandler): void;
  off(event: "session:destroy", handler: SessionDestroyHandler): void;

  // Remove by name
  offByName(name: string): void;

  // List registered hooks
  list(): Array<{ event: string; name?: string; priority: number }>;
}
