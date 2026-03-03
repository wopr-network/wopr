import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/events.js", () => ({
  eventBus: { emit: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../src/core/queue/QueueManager.js", () => ({
  queueManager: { getActiveStats: vi.fn().mockReturnValue(new Map()) },
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { RestartOnIdleManager } from "../../src/daemon/restart-on-idle.js";
import { eventBus } from "../../src/core/events.js";
import { queueManager } from "../../src/core/queue/QueueManager.js";

describe("RestartOnIdleManager", () => {
  let manager: RestartOnIdleManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(queueManager.getActiveStats).mockReturnValue(new Map());
    manager = new RestartOnIdleManager();
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  describe("scheduleRestart", () => {
    it("transitions to PENDING state", async () => {
      const status = await manager.scheduleRestart();
      expect(status.state).toBe("PENDING");
      expect(status.pending).toBe(true);
      expect(status.batchedRequests).toBe(1);
    });

    it("emits system:restartScheduled event", async () => {
      await manager.scheduleRestart();
      expect(eventBus.emit).toHaveBeenCalledWith(
        "system:restartScheduled",
        expect.objectContaining({ batchedRequests: 1 }),
        "core",
      );
    });

    it("batches multiple calls while PENDING", async () => {
      await manager.scheduleRestart();
      const status2 = await manager.scheduleRestart();
      expect(status2.batchedRequests).toBe(2);
      expect(status2.state).toBe("PENDING");
      // eventBus.emit only called once (first call)
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
    });

    it("throws when restart already in progress (RESTARTING state)", async () => {
      const callback = vi.fn();
      manager.onRestart(callback);
      await manager.scheduleRestart({ idleThresholdSeconds: 1 });

      // Advance past idle threshold — system is idle (mock returns empty map)
      vi.advanceTimersByTime(2000);

      expect(callback).toHaveBeenCalled();
      // Now scheduling again should throw
      await expect(manager.scheduleRestart()).rejects.toThrow("Restart already in progress");
    });

    it("applies custom config merged with defaults", async () => {
      const status = await manager.scheduleRestart({ idleThresholdSeconds: 10 });
      expect(status.config).toEqual({
        idleThresholdSeconds: 10,
        maxWaitSeconds: 300,
        drainMode: "graceful",
      });
    });

    it("returns requestedAt timestamp", async () => {
      const before = Date.now();
      const status = await manager.scheduleRestart();
      const after = Date.now();
      expect(status.requestedAt).toBeGreaterThanOrEqual(before);
      expect(status.requestedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("idle detection and restart trigger", () => {
    it("triggers restart callback after idle threshold when no active injects", async () => {
      const callback = vi.fn();
      manager.onRestart(callback);
      await manager.scheduleRestart({ idleThresholdSeconds: 5 });

      // Advance 6 seconds (6 ticks of 1s interval, idle from the start)
      vi.advanceTimersByTime(6000);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("does not trigger restart while injects are active", async () => {
      const callback = vi.fn();
      manager.onRestart(callback);

      const activeMap = new Map([["session-1", { pending: 0, active: 1, completed: 0 }]]);
      vi.mocked(queueManager.getActiveStats).mockReturnValue(activeMap as any);

      await manager.scheduleRestart({ idleThresholdSeconds: 2 });
      vi.advanceTimersByTime(3000);

      expect(callback).not.toHaveBeenCalled();
    });

    it("resets idle timer when injects become active then idle again", async () => {
      const callback = vi.fn();
      manager.onRestart(callback);

      await manager.scheduleRestart({ idleThresholdSeconds: 3 });

      // Idle for 2 seconds (not enough)
      vi.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();

      // Injects become active — resets idle timer
      const activeMap = new Map([["s1", {}]]);
      vi.mocked(queueManager.getActiveStats).mockReturnValue(activeMap as any);
      vi.advanceTimersByTime(1000);

      // Back to idle
      vi.mocked(queueManager.getActiveStats).mockReturnValue(new Map());
      // Only 2s idle since reset, need 3s
      vi.advanceTimersByTime(2000);
      expect(callback).not.toHaveBeenCalled();

      // Now 3s of idle since reset
      vi.advanceTimersByTime(2000);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("force restarts after maxWaitSeconds even with active injects", async () => {
      const callback = vi.fn();
      manager.onRestart(callback);

      const activeMap = new Map([["s1", {}]]);
      vi.mocked(queueManager.getActiveStats).mockReturnValue(activeMap as any);

      await manager.scheduleRestart({ maxWaitSeconds: 10, idleThresholdSeconds: 5 });
      vi.advanceTimersByTime(11000);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("transitions to DRAINING state in force drain mode with active injects", async () => {
      const activeMap = new Map([["s1", {}]]);
      vi.mocked(queueManager.getActiveStats).mockReturnValue(activeMap as any);

      await manager.scheduleRestart({ drainMode: "force", idleThresholdSeconds: 5 });
      vi.advanceTimersByTime(1000);

      const status = manager.getStatus();
      expect(status.state).toBe("DRAINING");
    });
  });

  describe("cancel", () => {
    it("resets state to IDLE and clears interval", async () => {
      await manager.scheduleRestart();
      manager.cancel();

      const status = manager.getStatus();
      expect(status.state).toBe("IDLE");
      expect(status.pending).toBe(false);
      expect(status.config).toBeNull();
      expect(status.batchedRequests).toBe(0);
    });

    it("prevents restart callback after cancel", async () => {
      const callback = vi.fn();
      manager.onRestart(callback);
      await manager.scheduleRestart({ idleThresholdSeconds: 2 });

      vi.advanceTimersByTime(1000);
      manager.cancel();
      vi.advanceTimersByTime(5000);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("returns IDLE status by default", () => {
      const status = manager.getStatus();
      expect(status.state).toBe("IDLE");
      expect(status.pending).toBe(false);
      expect(status.requestedAt).toBeNull();
      expect(status.activeInjects).toBe(0);
      expect(status.batchedRequests).toBe(0);
    });

    it("includes activeInjects count from queueManager", async () => {
      const activeMap = new Map([["s1", {}], ["s2", {}]]);
      vi.mocked(queueManager.getActiveStats).mockReturnValue(activeMap as any);

      await manager.scheduleRestart();
      const status = manager.getStatus();
      expect(status.activeInjects).toBe(2);
    });
  });

  describe("shutdown", () => {
    it("clears the check interval so callback never fires", async () => {
      const callback = vi.fn();
      manager.onRestart(callback);
      await manager.scheduleRestart({ idleThresholdSeconds: 2 });
      manager.shutdown();

      vi.advanceTimersByTime(10000);
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
