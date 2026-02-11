/**
 * Context provider types for WOPR plugins.
 *
 * Context providers contribute information to conversations.
 * Plugins register these to inject relevant context before
 * the AI processes a message.
 */

import type { ChannelRef } from "./channel.js";

/**
 * Information about an incoming message.
 */
export interface MessageInfo {
  content: string;
  from: string;
  channel?: ChannelRef;
  timestamp: number;
}

/**
 * A piece of context contributed by a provider.
 */
export interface ContextPart {
  content: string;
  role?: "system" | "context" | "warning" | "user";
  metadata?: {
    source: string;
    priority: number;
    trustLevel?: "trusted" | "untrusted" | "verified";
    [key: string]: unknown;
  };
}

/**
 * Composable context provider — plugins register these to contribute
 * context to conversations.
 */
export interface ContextProvider {
  name: string;
  priority: number;
  enabled?: boolean | ((session: string, message: MessageInfo) => boolean);
  getContext(session: string, message: MessageInfo): Promise<ContextPart | null>;
}
