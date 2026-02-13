/**
 * Health Monitoring for WOPR Platform
 *
 * Tracks health state of individual instances with configurable polling.
 * Health states: healthy, degraded, unhealthy, unknown.
 *
 * Inlined from src/platform/observability/health.ts as part of WOP-297.
 */

export type HealthState = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface InstanceHealth {
  instance_id: string;
  state: HealthState;
  last_check: string; // ISO timestamp
  uptime_seconds: number;
  details: Record<string, unknown>;
}

export interface PlatformHealth {
  status: HealthState;
  total_instances: number;
  healthy_count: number;
  degraded_count: number;
  unhealthy_count: number;
  unknown_count: number;
  instances: InstanceHealth[];
}

export type HealthCheckFn = (instanceId: string) => Promise<InstanceHealth> | InstanceHealth;

/**
 * Health monitor that tracks instance health states.
 */
export class HealthMonitor {
  private instances = new Map<string, InstanceHealth>();
  private checkFn: HealthCheckFn | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;

  constructor(pollIntervalMs = 30_000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Register a health check function used when polling.
   */
  setHealthCheckFn(fn: HealthCheckFn): void {
    this.checkFn = fn;
  }

  /**
   * Register an instance with initial unknown state.
   */
  registerInstance(instanceId: string): void {
    if (!this.instances.has(instanceId)) {
      this.instances.set(instanceId, {
        instance_id: instanceId,
        state: "unknown",
        last_check: new Date().toISOString(),
        uptime_seconds: 0,
        details: {},
      });
    }
  }

  /**
   * Remove an instance from monitoring.
   */
  unregisterInstance(instanceId: string): void {
    this.instances.delete(instanceId);
  }

  /**
   * Update the health state of an instance directly.
   */
  updateHealth(instanceId: string, state: HealthState, details: Record<string, unknown> = {}, uptimeSeconds = 0): void {
    this.instances.set(instanceId, {
      instance_id: instanceId,
      state,
      last_check: new Date().toISOString(),
      uptime_seconds: uptimeSeconds,
      details,
    });
  }

  /**
   * Get health for a specific instance.
   */
  getInstanceHealth(instanceId: string): InstanceHealth | null {
    return this.instances.get(instanceId) ?? null;
  }

  /**
   * Get platform-wide health summary.
   */
  getPlatformHealth(): PlatformHealth {
    const all = Array.from(this.instances.values());
    const healthy = all.filter((h) => h.state === "healthy").length;
    const degraded = all.filter((h) => h.state === "degraded").length;
    const unhealthy = all.filter((h) => h.state === "unhealthy").length;
    const unknown = all.filter((h) => h.state === "unknown").length;

    let status: HealthState;
    if (all.length === 0) {
      status = "unknown";
    } else if (unhealthy > 0) {
      status = "unhealthy";
    } else if (degraded > 0) {
      status = "degraded";
    } else if (unknown === all.length) {
      status = "unknown";
    } else {
      status = "healthy";
    }

    return {
      status,
      total_instances: all.length,
      healthy_count: healthy,
      degraded_count: degraded,
      unhealthy_count: unhealthy,
      unknown_count: unknown,
      instances: all,
    };
  }

  /**
   * Run health checks on all registered instances.
   */
  async checkAll(): Promise<void> {
    if (!this.checkFn) return;

    const ids = Array.from(this.instances.keys());
    for (const id of ids) {
      try {
        const result = await this.checkFn(id);
        this.instances.set(id, result);
      } catch {
        this.updateHealth(id, "unhealthy", { error: "Health check failed" });
      }
    }
  }

  /**
   * Start periodic health check polling.
   */
  startPolling(): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => {
      this.checkAll().catch(() => {
        // Polling errors are silently absorbed; individual instance states already updated
      });
    }, this.pollIntervalMs);
  }

  /**
   * Stop periodic health check polling.
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Get count of tracked instances.
   */
  getInstanceCount(): number {
    return this.instances.size;
  }

  /** Reset all state -- used by tests. */
  _resetForTesting(): void {
    this.stopPolling();
    this.instances.clear();
    this.checkFn = null;
  }
}

/** Singleton health monitor for the platform. */
export const healthMonitor = new HealthMonitor();
