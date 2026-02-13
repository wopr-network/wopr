/**
 * Metrics Collection for WOPR Platform
 *
 * Records per-instance, per-channel, per-provider, and platform-wide metrics.
 * Stores time-series data in SQLite for persistence and query.
 *
 * Inlined from src/platform/observability/metrics.ts as part of WOP-297.
 */

import { DatabaseSync } from "node:sqlite";

export interface MetricRecord {
  id?: number;
  timestamp: number;
  metric_name: string;
  metric_value: number;
  instance_id: string | null;
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
 * Metrics store backed by SQLite.
 */
export class MetricsStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        instance_id TEXT,
        tags TEXT DEFAULT '{}'
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_metrics_instance ON metrics(instance_id);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
    `);
  }

  /**
   * Record a metric data point.
   */
  record(name: string, value: number, instanceId: string | null = null, tags: Record<string, string> = {}): void {
    const stmt = this.db.prepare(
      "INSERT INTO metrics (timestamp, metric_name, metric_value, instance_id, tags) VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run(Date.now(), name, value, instanceId, JSON.stringify(tags));
  }

  /**
   * Get latest value of a metric for an instance.
   */
  getLatest(name: string, instanceId: string | null = null): number | null {
    const stmt = instanceId
      ? this.db.prepare(
          "SELECT metric_value FROM metrics WHERE metric_name = ? AND instance_id = ? ORDER BY timestamp DESC LIMIT 1",
        )
      : this.db.prepare(
          "SELECT metric_value FROM metrics WHERE metric_name = ? AND instance_id IS NULL ORDER BY timestamp DESC LIMIT 1",
        );

    const row = instanceId ? stmt.get(name, instanceId) : stmt.get(name);
    return row ? (row as { metric_value: number }).metric_value : null;
  }

  /**
   * Get sum of a metric across all records for an instance.
   */
  getSum(name: string, instanceId: string | null = null, sinceMs?: number): number {
    let sql = "SELECT COALESCE(SUM(metric_value), 0) as total FROM metrics WHERE metric_name = ?";
    const params: (string | number)[] = [name];

    if (instanceId) {
      sql += " AND instance_id = ?";
      params.push(instanceId);
    }

    if (sinceMs) {
      sql += " AND timestamp >= ?";
      params.push(sinceMs);
    }

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as { total: number };
    return row.total;
  }

  /**
   * Get count of distinct instances that have recorded metrics.
   */
  getDistinctInstanceCount(): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(DISTINCT instance_id) as count FROM metrics WHERE instance_id IS NOT NULL",
    );
    const row = stmt.get() as { count: number };
    return row.count;
  }

  /**
   * Get a summary of metrics for a specific instance.
   */
  getInstanceSummary(instanceId: string): InstanceMetricsSummary {
    return {
      instance_id: instanceId,
      messages_processed: this.getSum("messages_processed", instanceId),
      tokens_consumed: this.getSum("tokens_consumed", instanceId),
      active_sessions: this.getLatest("active_sessions", instanceId) ?? 0,
      uptime_seconds: this.getLatest("uptime_seconds", instanceId) ?? 0,
      error_count: this.getSum("error_count", instanceId),
    };
  }

  /**
   * Get platform-wide metrics summary.
   */
  getPlatformSummary(): MetricsSummary {
    return {
      total_instances: this.getDistinctInstanceCount(),
      total_messages_processed: this.getSum("messages_processed"),
      total_tokens_consumed: this.getSum("tokens_consumed"),
      active_sessions: this.getSum("active_sessions"),
      total_errors: this.getSum("error_count"),
    };
  }

  /**
   * Query metrics with time range and optional filters.
   */
  query(options: { name?: string; instanceId?: string; since?: number; limit?: number }): MetricRecord[] {
    let sql = "SELECT id, timestamp, metric_name, metric_value, instance_id, tags FROM metrics WHERE 1=1";
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

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as unknown as MetricRecord[];
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
