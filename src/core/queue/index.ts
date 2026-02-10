/**
 * Session Queue Module
 *
 * Provides FIFO queuing for inject operations with:
 * - Per-session promise chain queuing (no timeout-cancel!)
 * - Priority support
 * - Cancellation support
 * - Event monitoring
 */

export { QueueManager, queueManager } from "./QueueManager.js";
export { SessionQueue } from "./SessionQueue.js";
export type {
  ActiveInject,
  InjectOptions,
  InjectResult,
  MultimodalMessage,
  QueuedInject,
  QueueEvent,
  QueueEventHandler,
  QueueEventType,
  QueueStats,
} from "./types.js";
