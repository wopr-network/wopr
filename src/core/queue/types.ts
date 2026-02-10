/**
 * Session Queue Types
 */

import type { ChannelRef, InjectionSource, StreamCallback } from "../../types.js";

/**
 * Options for an inject request
 */
export interface InjectOptions {
  silent?: boolean;
  onStream?: StreamCallback;
  from?: string;
  /** Unique identifier for the sender (e.g., Discord user ID) */
  senderId?: string;
  channel?: ChannelRef;
  images?: string[];
  source?: InjectionSource;
  contextProviders?: string[];
  /** Priority level (higher = processed first within queue) */
  priority?: number;
}

/**
 * Result from an inject operation
 */
export interface InjectResult {
  response: string;
  sessionId: string;
  cost: number;
}

/**
 * Multimodal message with optional images
 */
export interface MultimodalMessage {
  text: string;
  images?: string[];
}

/**
 * A queued inject request
 */
export interface QueuedInject {
  id: string;
  sessionKey: string;
  message: string | MultimodalMessage;
  options?: InjectOptions;
  priority: number;
  queuedAt: number;
  resolve: (result: InjectResult) => void;
  reject: (error: Error) => void;
  abortController: AbortController;
}

/**
 * State of an active inject
 */
export interface ActiveInject {
  id: string;
  sessionKey: string;
  startTime: number;
  abortController: AbortController;
}

/**
 * Queue statistics for monitoring
 */
export interface QueueStats {
  sessionKey: string;
  queueDepth: number;
  isProcessing: boolean;
  activeInjectId?: string;
  activeInjectDuration?: number;
  oldestQueuedAt?: number;
}

/**
 * Event types emitted by the queue
 */
export type QueueEventType = "enqueue" | "dequeue" | "start" | "complete" | "error" | "cancel";

export interface QueueEvent {
  type: QueueEventType;
  sessionKey: string;
  injectId: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type QueueEventHandler = (event: QueueEvent) => void;
