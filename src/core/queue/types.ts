/**
 * Session Queue Types
 */

import type { StreamCallback, ChannelRef, InjectionSource } from "../../types.js";

/**
 * Options for an inject request
 */
export interface InjectOptions {
  silent?: boolean;
  onStream?: StreamCallback;
  from?: string;
  channel?: ChannelRef;
  images?: string[];
  source?: InjectionSource;
  contextProviders?: string[];
  /** If true, allow V2 injection into active streams (default: true) */
  allowV2Inject?: boolean;
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
  /** For V2: the active query generator */
  queryGenerator?: AsyncGenerator<unknown>;
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
export type QueueEventType =
  | "enqueue"
  | "dequeue"
  | "start"
  | "complete"
  | "error"
  | "cancel"
  | "v2-inject";

export interface QueueEvent {
  type: QueueEventType;
  sessionKey: string;
  injectId: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type QueueEventHandler = (event: QueueEvent) => void;
