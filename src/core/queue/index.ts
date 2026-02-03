/**
 * Session Queue Module
 *
 * Provides FIFO queuing for inject operations with:
 * - Per-session promise chain queuing (no timeout-cancel!)
 * - Priority support
 * - V2 active session injection
 * - Cancellation support
 * - Event monitoring
 */

export { SessionQueue } from "./SessionQueue.js";
export { QueueManager, queueManager } from "./QueueManager.js";
export type {
  InjectOptions,
  InjectResult,
  MultimodalMessage,
  QueuedInject,
  ActiveInject,
  QueueStats,
  QueueEvent,
  QueueEventType,
  QueueEventHandler,
} from "./types.js";
