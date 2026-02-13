/**
 * Structured Logger for WOPR Platform
 *
 * Provides per-instance structured JSON logging with configurable levels.
 * Uses winston for transport and formatting.
 */

import winston from "winston";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogEntry {
  timestamp: string;
  instance_id: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * In-memory log buffer per instance. Capped to prevent unbounded memory growth.
 */
const instanceLogs = new Map<string, StructuredLogEntry[]>();
const MAX_LOGS_PER_INSTANCE = 10_000;

/**
 * Create a winston logger for a specific instance.
 */
export function createInstanceLogger(instanceId: string): winston.Logger {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    defaultMeta: { instance_id: instanceId },
    transports: [new winston.transports.Console({ silent: process.env.NODE_ENV === "test" })],
  });
}

/**
 * Record a structured log entry for an instance.
 */
export function recordLog(
  instanceId: string,
  level: LogLevel,
  message: string,
  metadata?: Record<string, unknown>,
): StructuredLogEntry {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    instance_id: instanceId,
    level,
    message,
    ...(metadata ? { metadata } : {}),
  };

  let logs = instanceLogs.get(instanceId);
  if (!logs) {
    logs = [];
    instanceLogs.set(instanceId, logs);
  }

  logs.push(entry);

  // Evict oldest entries when buffer is full
  if (logs.length > MAX_LOGS_PER_INSTANCE) {
    logs.splice(0, logs.length - MAX_LOGS_PER_INSTANCE);
  }

  return entry;
}

export interface GetLogsOptions {
  level?: LogLevel;
  limit?: number;
  since?: string; // ISO timestamp
}

/**
 * Retrieve log entries for an instance with optional filters.
 */
export function getInstanceLogs(instanceId: string, options: GetLogsOptions = {}): StructuredLogEntry[] {
  const logs = instanceLogs.get(instanceId) || [];
  let filtered = logs;

  if (options.level) {
    filtered = filtered.filter((l) => l.level === options.level);
  }

  if (options.since) {
    const sinceDate = new Date(options.since).getTime();
    filtered = filtered.filter((l) => new Date(l.timestamp).getTime() >= sinceDate);
  }

  if (options.limit && options.limit > 0) {
    // Return the most recent entries
    filtered = filtered.slice(-options.limit);
  }

  return filtered;
}

/**
 * Clear logs for an instance (e.g., on instance teardown).
 */
export function clearInstanceLogs(instanceId: string): void {
  instanceLogs.delete(instanceId);
}

/**
 * Get all instance IDs that have logs.
 */
export function getLoggedInstanceIds(): string[] {
  return Array.from(instanceLogs.keys());
}

/** Reset all logs -- used by tests. */
export function _resetLogsForTesting(): void {
  instanceLogs.clear();
}
