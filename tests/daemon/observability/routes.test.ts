import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Mock paths to control storage location
const testDir = join(tmpdir(), `wopr-routes-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: testDir,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGlobal = Record<string, any>;

describe("observability API routes", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(testDir, { recursive: true });

    const { observabilityRouter } = await import("../../../src/daemon/routes/observability.js");
    const { _resetLogsForTesting, healthMonitor, recordLog: recordLogFunc } = await import("../../../src/daemon/observability/index.js");

    app = new Hono();
    app.route("/observability", observabilityRouter);

    (globalThis as AnyGlobal)._testHealthMonitor = healthMonitor;
    (globalThis as AnyGlobal)._testRecordLog = recordLogFunc;
    (globalThis as AnyGlobal)._testResetLogs = _resetLogsForTesting;
  });

  afterEach(() => {
    (globalThis as AnyGlobal)._testHealthMonitor?._resetForTesting();
    (globalThis as AnyGlobal)._testResetLogs?.();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("GET /observability/instances/:id/logs", () => {
    it("returns instance logs", async () => {
      (globalThis as AnyGlobal)._testRecordLog("inst-1", "info", "test message");

      const res = await app.request("/observability/instances/inst-1/logs");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.instance_id).toBe("inst-1");
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].message).toBe("test message");
    });

    it("supports level filter", async () => {
      (globalThis as AnyGlobal)._testRecordLog("inst-2", "info", "info msg");
      (globalThis as AnyGlobal)._testRecordLog("inst-2", "error", "error msg");

      const res = await app.request("/observability/instances/inst-2/logs?level=error");
      const body = await res.json();
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].level).toBe("error");
    });

    it("supports limit filter", async () => {
      for (let i = 0; i < 5; i++) {
        (globalThis as AnyGlobal)._testRecordLog("inst-3", "info", `msg ${i}`);
      }

      const res = await app.request("/observability/instances/inst-3/logs?limit=2");
      const body = await res.json();
      expect(body.logs).toHaveLength(2);
    });
  });

  describe("GET /observability/health", () => {
    it("returns platform health", async () => {
      (globalThis as AnyGlobal)._testHealthMonitor.registerInstance("inst-health");
      (globalThis as AnyGlobal)._testHealthMonitor.updateHealth("inst-health", "healthy");

      const res = await app.request("/observability/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("total_instances");
    });

    it("returns 503 when unhealthy", async () => {
      (globalThis as AnyGlobal)._testHealthMonitor.registerInstance("inst-bad");
      (globalThis as AnyGlobal)._testHealthMonitor.updateHealth("inst-bad", "unhealthy");

      const res = await app.request("/observability/health");
      expect(res.status).toBe(503);
    });
  });

  describe("GET /observability/instances/:id/health", () => {
    it("returns instance health", async () => {
      (globalThis as AnyGlobal)._testHealthMonitor.registerInstance("inst-h1");
      (globalThis as AnyGlobal)._testHealthMonitor.updateHealth("inst-h1", "healthy", { version: "1.0" }, 3600);

      const res = await app.request("/observability/instances/inst-h1/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.state).toBe("healthy");
      expect(body.uptime_seconds).toBe(3600);
    });

    it("returns 404 for unknown instance", async () => {
      const res = await app.request("/observability/instances/nonexistent/health");
      expect(res.status).toBe(404);
    });
  });
});
