/**
 * Metrics Collection for WOPR Platform
 *
 * Records per-instance, per-channel, per-provider, and platform-wide metrics.
 * Stores time-series data in SQLite via Storage API for persistence and query.
 *
 * Migrated to Storage API as part of WOP-547.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PluginSchema, StorageApi } from "../../storage/api/plugin-storage.js";

// Zod schema for metrics table
const metricsRowSchema = z.object({
  id: z.string(), // UUID primary key
  timestamp: z.number(),
  metric_name: z.string(),
  metric_value: z.number(),
  instance_id: z.string().optional(),
  tags: z.string(), // JSON-encoded tags object
});

// Plugin schema for metrics namespace
export const metricsPluginSchema: PluginSchema = {
  namespace: "metrics",
  version: 1,
  tables: {
    rows: {
      schema: metricsRowSchema,
      primaryKey: "id",
      indexes: [{ fields: ["instance_id"] }, { fields: ["metric_name"] }, { fields: ["timestamp"] }],
    },
  },
};

export interface MetricRecord {
  id?: string;
  timestamp: number;
  metric_name: string;
  metric_value: number;
  instance_id?: string;
  tags: string; // JSON-encoded tags object
}

export interface MetricsSummary {
  total_instances: number;
  total_messages_processed: number;
  total_tokens_consumed: number;
  active_sessions: number;
  total_errors: number;
}

export interface InstanceMetricsSummary {
  instance_id: string;
  messages_processed: number;
  tokens_consumed: number;
  active_sessions: number;
  uptime_seconds: number;
  error_count: number;
}

/**
 * Metrics store backed by Storage API.
 * All operations use raw SQL for performance (metrics are high-frequency writes).
 */
export class MetricsStore {
  private storage: StorageApi;

  private constructor(storage: StorageApi) {
    this.storage = storage;
  }

  /**
   * Create and initialize a metrics store.
   */
  static async create(storage: StorageApi): Promise<MetricsStore> {
    await storage.register(metricsPluginSchema);
    return new MetricsStore(storage);
  }

  /**
   * Record a metric data point.
   */
  async record(name: string, value: number, instanceId?: string, tags: Record<string, string> = {}): Promise<void> {
    await this.storage.run(
      "INSERT INTO metrics_rows (id, timestamp, metric_name, metric_value, instance_id, tags) VALUES (?, ?, ?, ?, ?, ?)",
      [randomUUID(), Date.now(), name, value, instanceId ?? null, JSON.stringify(tags)],
    );
  }

  /**
   * Get latest value of a metric for an instance.
   */
  async getLatest(name: string, instanceId?: string): Promise<number | null> {
    const sql = instanceId
      ? "SELECT metric_value FROM metrics_rows WHERE metric_name = ? AND instance_id = ? ORDER BY timestamp DESC LIMIT 1"
      : "SELECT metric_value FROM metrics_rows WHERE metric_name = ? AND instance_id IS NULL ORDER BY timestamp DESC LIMIT 1";

    const params = instanceId ? [name, instanceId] : [name];
    const rows = await this.storage.raw(sql, params);
    const row = rows[0] as { metric_value: number } | undefined;
    return row?.metric_value ?? null;
  }

  /**
   * Get sum of a metric across all records for an instance.
   */
  async getSum(name: string, instanceId?: string, sinceMs?: number): Promise<number> {
    let sql = "SELECT COALESCE(SUM(metric_value), 0) as total FROM metrics_rows WHERE metric_name = ?";
    const params: (string | number)[] = [name];

    if (instanceId) {
      sql += " AND instance_id = ?";
      params.push(instanceId);
    }

    if (sinceMs) {
      sql += " AND timestamp >= ?";
      params.push(sinceMs);
    }

    const rows = await this.storage.raw(sql, params);
    const row = rows[0] as { total: number };
    return row.total;
  }

  /**
   * Get count of distinct instances that have recorded metrics.
   */
  async getDistinctInstanceCount(): Promise<number> {
    const rows = await this.storage.raw(
      "SELECT COUNT(DISTINCT instance_id) as count FROM metrics_rows WHERE instance_id IS NOT NULL",
      [],
    );
    const row = rows[0] as { count: number };
    return row.count;
  }

  /**
   * Get a summary of metrics for a specific instance.
   */
  async getInstanceSummary(instanceId: string): Promise<InstanceMetricsSummary> {
    const [messages_processed, tokens_consumed, active_sessions, uptime_seconds, error_count] = await Promise.all([
      this.getSum("messages_processed", instanceId),
      this.getSum("tokens_consumed", instanceId),
      this.getLatest("active_sessions", instanceId),
      this.getLatest("uptime_seconds", instanceId),
      this.getSum("error_count", instanceId),
    ]);

    return {
      instance_id: instanceId,
      messages_processed,
      tokens_consumed,
      active_sessions: active_sessions ?? 0,
      uptime_seconds: uptime_seconds ?? 0,
      error_count,
    };
  }

  /**
   * Get platform-wide metrics summary.
   */
  async getPlatformSummary(): Promise<MetricsSummary> {
    const [total_instances, total_messages_processed, total_tokens_consumed, active_sessions, total_errors] =
      await Promise.all([
        this.getDistinctInstanceCount(),
        this.getSum("messages_processed"),
        this.getSum("tokens_consumed"),
        this.getSum("active_sessions"),
        this.getSum("error_count"),
      ]);

    return {
      total_instances,
      total_messages_processed,
      total_tokens_consumed,
      active_sessions,
      total_errors,
    };
  }

  /**
   * Query metrics with time range and optional filters.
   */
  async query(options: {
    name?: string;
    instanceId?: string;
    since?: number;
    limit?: number;
  }): Promise<MetricRecord[]> {
    let sql = "SELECT id, timestamp, metric_name, metric_value, instance_id, tags FROM metrics_rows WHERE 1=1";
    const params: (string | number)[] = [];

    if (options.name) {
      sql += " AND metric_name = ?";
      params.push(options.name);
    }

    if (options.instanceId) {
      sql += " AND instance_id = ?";
      params.push(options.instanceId);
    }

    if (options.since) {
      sql += " AND timestamp >= ?";
      params.push(options.since);
    }

    sql += " ORDER BY timestamp DESC";

    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = await this.storage.raw(sql, params);
    return rows as MetricRecord[];
  }
}
