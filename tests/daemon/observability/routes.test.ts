import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Mock paths and fs to control metrics store location
const testDir = join(tmpdir(), `wopr-routes-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: testDir,
}));

describe("observability API routes", () => {
  let app: Hono;

  beforeEach(async () => {
    vi.resetModules(); // Force fresh module loading to reset metricsStore
    mkdirSync(testDir, { recursive: true });

    // Initialize storage before creating the app
    const { getStorage } = await import("../../../src/storage/index.js");
    const storage = getStorage(join(testDir, "wopr.sqlite"));

    // Register metrics schema
    const { metricsPluginSchema } = await import("../../../src/daemon/observability/metrics.js");
    await storage.register(metricsPluginSchema);

    // Import router AFTER storage is initialized
    const { observabilityRouter } = await import("../../../src/daemon/routes/observability.js");
    const { _resetLogsForTesting, healthMonitor, recordLog: recordLogFunc } = await import("../../../src/daemon/observability/index.js");

    app = new Hono();
    app.route("/observability", observabilityRouter);

    // Make these available to tests
    (globalThis as any)._testHealthMonitor = healthMonitor;
    (globalThis as any)._testRecordLog = recordLogFunc;
    (globalThis as any)._testResetLogs = _resetLogsForTesting;
  });

  afterEach(async () => {
    const { resetStorage } = await import("../../../src/storage/index.js");
    await resetStorage();
    (globalThis as any)._testHealthMonitor?._resetForTesting();
    (globalThis as any)._testResetLogs?.();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("GET /observability/metrics", () => {
    it("returns platform metrics summary", async () => {
      const res = await app.request("/observability/metrics");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty("total_instances");
      expect(body).toHaveProperty("total_messages_processed");
      expect(body).toHaveProperty("total_tokens_consumed");
    });
  });

  describe("POST /observability/metrics", () => {
    it("records a metric data point", async () => {
      const res = await app.request("/observability/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "messages_processed", value: 10, instance_id: "inst-1" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.recorded).toBe(true);
    });

    it("rejects missing name", async () => {
      const res = await app.request("/observability/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 10 }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects missing value", async () => {
      const res = await app.request("/observability/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /observability/instances/:id/metrics", () => {
    it("returns instance metrics summary", async () => {
      const res = await app.request("/observability/instances/fresh-inst/metrics");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.instance_id).toBe("fresh-inst");
      expect(body).toHaveProperty("messages_processed");
      expect(body).toHaveProperty("tokens_consumed");
      expect(body).toHaveProperty("active_sessions");
      expect(body).toHaveProperty("uptime_seconds");
      expect(body).toHaveProperty("error_count");
    });
  });

  describe("GET /observability/instances/:id/logs", () => {
    it("returns instance logs", async () => {
      (globalThis as any)._testRecordLog("inst-1", "info", "test message");

      const res = await app.request("/observability/instances/inst-1/logs");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.instance_id).toBe("inst-1");
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].message).toBe("test message");
    });

    it("supports level filter", async () => {
      (globalThis as any)._testRecordLog("inst-1", "info", "info msg");
      (globalThis as any)._testRecordLog("inst-1", "error", "error msg");

      const res = await app.request("/observability/instances/inst-1/logs?level=error");
      const body = await res.json();
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].level).toBe("error");
    });

    it("supports limit filter", async () => {
      for (let i = 0; i < 5; i++) {
        (globalThis as any)._testRecordLog("inst-1", "info", `msg ${i}`);
      }

      const res = await app.request("/observability/instances/inst-1/logs?limit=2");
      const body = await res.json();
      expect(body.logs).toHaveLength(2);
    });
  });

  describe("GET /observability/health", () => {
    it("returns platform health", async () => {
      // Register a healthy instance so we get 200 (no instances = unknown = 503)
      (globalThis as any)._testHealthMonitor.registerInstance("inst-health");
      (globalThis as any)._testHealthMonitor.updateHealth("inst-health", "healthy");

      const res = await app.request("/observability/health");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("total_instances");
    });

    it("returns 503 when unhealthy", async () => {
      (globalThis as any)._testHealthMonitor.registerInstance("inst-1");
      (globalThis as any)._testHealthMonitor.updateHealth("inst-1", "unhealthy");

      const res = await app.request("/observability/health");
      expect(res.status).toBe(503);
    });
  });

  describe("GET /observability/instances/:id/health", () => {
    it("returns instance health", async () => {
      (globalThis as any)._testHealthMonitor.registerInstance("inst-1");
      (globalThis as any)._testHealthMonitor.updateHealth("inst-1", "healthy", { version: "1.0" }, 3600);

      const res = await app.request("/observability/instances/inst-1/health");
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
