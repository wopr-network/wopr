import { afterEach, describe, expect, it } from "vitest";
import { HealthMonitor } from "../../../src/platform/observability/health.js";

describe("HealthMonitor", () => {
  let monitor: HealthMonitor;

  afterEach(() => {
    monitor._resetForTesting();
  });

  it("starts with no instances", () => {
    monitor = new HealthMonitor();
    expect(monitor.getInstanceCount()).toBe(0);
  });

  it("registers an instance with unknown state", () => {
    monitor = new HealthMonitor();
    monitor.registerInstance("inst-1");

    const health = monitor.getInstanceHealth("inst-1");
    expect(health).not.toBeNull();
    expect(health!.state).toBe("unknown");
    expect(health!.instance_id).toBe("inst-1");
  });

  it("does not overwrite existing instance on re-register", () => {
    monitor = new HealthMonitor();
    monitor.registerInstance("inst-1");
    monitor.updateHealth("inst-1", "healthy");
    monitor.registerInstance("inst-1");

    const health = monitor.getInstanceHealth("inst-1");
    expect(health!.state).toBe("healthy");
  });

  it("unregisters an instance", () => {
    monitor = new HealthMonitor();
    monitor.registerInstance("inst-1");
    monitor.unregisterInstance("inst-1");

    expect(monitor.getInstanceHealth("inst-1")).toBeNull();
    expect(monitor.getInstanceCount()).toBe(0);
  });

  it("updates health state", () => {
    monitor = new HealthMonitor();
    monitor.registerInstance("inst-1");
    monitor.updateHealth("inst-1", "degraded", { cpu: 90 }, 3600);

    const health = monitor.getInstanceHealth("inst-1");
    expect(health!.state).toBe("degraded");
    expect(health!.details).toEqual({ cpu: 90 });
    expect(health!.uptime_seconds).toBe(3600);
    expect(health!.last_check).toBeTruthy();
  });

  it("returns null for unknown instance", () => {
    monitor = new HealthMonitor();
    expect(monitor.getInstanceHealth("nonexistent")).toBeNull();
  });

  describe("getPlatformHealth", () => {
    it("returns unknown status with no instances", () => {
      monitor = new HealthMonitor();
      const health = monitor.getPlatformHealth();

      expect(health.status).toBe("unknown");
      expect(health.total_instances).toBe(0);
    });

    it("returns healthy when all instances are healthy", () => {
      monitor = new HealthMonitor();
      monitor.registerInstance("inst-1");
      monitor.registerInstance("inst-2");
      monitor.updateHealth("inst-1", "healthy");
      monitor.updateHealth("inst-2", "healthy");

      const health = monitor.getPlatformHealth();
      expect(health.status).toBe("healthy");
      expect(health.healthy_count).toBe(2);
      expect(health.total_instances).toBe(2);
    });

    it("returns degraded when any instance is degraded", () => {
      monitor = new HealthMonitor();
      monitor.registerInstance("inst-1");
      monitor.registerInstance("inst-2");
      monitor.updateHealth("inst-1", "healthy");
      monitor.updateHealth("inst-2", "degraded");

      const health = monitor.getPlatformHealth();
      expect(health.status).toBe("degraded");
      expect(health.degraded_count).toBe(1);
    });

    it("returns unhealthy when any instance is unhealthy", () => {
      monitor = new HealthMonitor();
      monitor.registerInstance("inst-1");
      monitor.registerInstance("inst-2");
      monitor.updateHealth("inst-1", "healthy");
      monitor.updateHealth("inst-2", "unhealthy");

      const health = monitor.getPlatformHealth();
      expect(health.status).toBe("unhealthy");
      expect(health.unhealthy_count).toBe(1);
    });

    it("unhealthy takes precedence over degraded", () => {
      monitor = new HealthMonitor();
      monitor.registerInstance("inst-1");
      monitor.registerInstance("inst-2");
      monitor.updateHealth("inst-1", "degraded");
      monitor.updateHealth("inst-2", "unhealthy");

      const health = monitor.getPlatformHealth();
      expect(health.status).toBe("unhealthy");
    });

    it("returns unknown when all instances are unknown", () => {
      monitor = new HealthMonitor();
      monitor.registerInstance("inst-1");
      monitor.registerInstance("inst-2");

      const health = monitor.getPlatformHealth();
      expect(health.status).toBe("unknown");
      expect(health.unknown_count).toBe(2);
    });

    it("includes all instance details in response", () => {
      monitor = new HealthMonitor();
      monitor.registerInstance("inst-1");
      monitor.registerInstance("inst-2");

      const health = monitor.getPlatformHealth();
      expect(health.instances).toHaveLength(2);
    });
  });

  describe("checkAll", () => {
    it("runs health check function on all instances", async () => {
      monitor = new HealthMonitor();
      monitor.registerInstance("inst-1");
      monitor.registerInstance("inst-2");

      monitor.setHealthCheckFn((id) => ({
        instance_id: id,
        state: "healthy",
        last_check: new Date().toISOString(),
        uptime_seconds: 100,
        details: {},
      }));

      await monitor.checkAll();

      expect(monitor.getInstanceHealth("inst-1")!.state).toBe("healthy");
      expect(monitor.getInstanceHealth("inst-2")!.state).toBe("healthy");
    });

    it("marks instance unhealthy when check throws", async () => {
      monitor = new HealthMonitor();
      monitor.registerInstance("inst-1");

      monitor.setHealthCheckFn(() => {
        throw new Error("connection refused");
      });

      await monitor.checkAll();

      const health = monitor.getInstanceHealth("inst-1");
      expect(health!.state).toBe("unhealthy");
      expect(health!.details).toEqual({ error: "Health check failed" });
    });

    it("does nothing without a health check function", async () => {
      monitor = new HealthMonitor();
      monitor.registerInstance("inst-1");

      await monitor.checkAll(); // should not throw

      expect(monitor.getInstanceHealth("inst-1")!.state).toBe("unknown");
    });
  });

  describe("polling", () => {
    it("starts and stops polling without error", () => {
      monitor = new HealthMonitor(100);
      monitor.startPolling();
      monitor.stopPolling();
    });

    it("does not start duplicate polling intervals", () => {
      monitor = new HealthMonitor(100);
      monitor.startPolling();
      monitor.startPolling(); // second call should be no-op
      monitor.stopPolling();
    });
  });
});
