/**
 * HealthMonitor - Periodic health checks for WOPR daemon.
 *
 * Tracks plugin health, provider availability, session counts, and memory usage.
 * Emits events on status transitions (healthy -> degraded -> unhealthy).
 */

import { EventEmitter } from "node:events";
import { providerRegistry } from "../core/providers.js";
import { getSessions } from "../core/sessions.js";
import { logger } from "../logger.js";
import { loadedPlugins } from "../plugins/state.js";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export interface PluginHealth {
  name: string;
  status: HealthStatus;
  lastCheck: string;
  error?: string;
}

export interface ProviderHealth {
  name: string;
  available: boolean;
  reason?: string;
}

export interface SessionStats {
  active: number;
  total: number;
}

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  rss: number;
}

export interface HealthSnapshot {
  status: HealthStatus;
  uptime: number;
  version: string;
  plugins: PluginHealth[];
  providers: ProviderHealth[];
  sessions: SessionStats;
  memory: MemoryStats;
}

export interface HealthMonitorConfig {
  intervalMs?: number;
  historySize?: number;
  version?: string;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_HISTORY_SIZE = 50;

export class HealthMonitor extends EventEmitter {
  private intervalMs: number;
  private historySize: number;
  private version: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime: number;
  private history: HealthSnapshot[] = [];
  private currentStatus: HealthStatus = "healthy";

  constructor(config: HealthMonitorConfig = {}) {
    super();
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.historySize = config.historySize ?? DEFAULT_HISTORY_SIZE;
    this.version = config.version ?? "1.0.0";
    this.startTime = Date.now();
  }

  /** Start periodic health checks. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.check().catch((err) => {
        logger.error(`[health] Periodic check failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.intervalMs);
    // Run an initial check immediately
    this.check().catch((err) => {
      logger.error(`[health] Initial check failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** Stop periodic health checks. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a health check and return the snapshot. */
  async check(): Promise<HealthSnapshot> {
    const plugins = this.checkPlugins();
    const providers = this.checkProviders();
    const sessions = await this.checkSessions();
    const mem = process.memoryUsage();

    const status = this.computeStatus(plugins, providers);

    const snapshot: HealthSnapshot = {
      status,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: this.version,
      plugins,
      providers,
      sessions,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
      },
    };

    // Record history
    this.history.push(snapshot);
    if (this.history.length > this.historySize) {
      this.history.shift();
    }

    // Emit event on status change
    if (status !== this.currentStatus) {
      const previous = this.currentStatus;
      this.currentStatus = status;
      this.emit("statusChange", { previous, current: status, snapshot });
    }

    return snapshot;
  }

  /** Get the last N health snapshots. */
  getHistory(limit?: number): HealthSnapshot[] {
    if (limit && limit > 0) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /** Get the most recent status without running a new check. */
  getCurrentStatus(): HealthStatus {
    return this.currentStatus;
  }

  private checkPlugins(): PluginHealth[] {
    const results: PluginHealth[] = [];
    const now = new Date().toISOString();

    for (const [name] of loadedPlugins) {
      // Plugin is loaded and running -- mark healthy.
      // If it exposes a lifecycle healthEndpoint (via pluginManifests),
      // a future iteration could call it, but for now loaded == healthy.
      results.push({
        name,
        status: "healthy",
        lastCheck: now,
      });
    }

    return results;
  }

  private checkProviders(): ProviderHealth[] {
    const providers = providerRegistry.listProviders();
    return providers.map((p) => ({
      name: p.id,
      available: p.available,
      ...(!p.available ? { reason: "Health check failed or no credentials" } : {}),
    }));
  }

  private async checkSessions(): Promise<SessionStats> {
    const sessions = await getSessions();
    const total = Object.keys(sessions).length;
    // All persisted sessions are considered "active" since WOPR doesn't
    // distinguish idle vs active at the session-file level.
    return { active: total, total };
  }

  private computeStatus(plugins: PluginHealth[], providers: ProviderHealth[]): HealthStatus {
    const availableProviders = providers.filter((p) => p.available);
    const failedPlugins = plugins.filter((p) => p.status !== "healthy");

    // Unhealthy: no providers available or critical plugin failure
    if (providers.length > 0 && availableProviders.length === 0) {
      return "unhealthy";
    }

    // Degraded: some plugins failed or some providers unavailable
    if (failedPlugins.length > 0) {
      return "degraded";
    }
    if (providers.length > 0 && availableProviders.length < providers.length) {
      return "degraded";
    }

    return "healthy";
  }
}
