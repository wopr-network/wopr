import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MetricsStore } from "../../../src/daemon/observability/metrics.js";
import { getStorage, resetStorage } from "../../../src/storage/index.js";

describe("MetricsStore", () => {
  let store: MetricsStore;
  let dbDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dbDir = join(tmpdir(), `wopr-metrics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dbDir, { recursive: true });
    dbPath = join(dbDir, "test-metrics.sqlite");
    const storage = getStorage(dbPath);
    store = await MetricsStore.create(storage);
  });

  afterEach(() => {
    resetStorage();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("records and retrieves a metric", async () => {
    await store.record("messages_processed", 5, "inst-1");

    const latest = await store.getLatest("messages_processed", "inst-1");
    expect(latest).toBe(5);
  });

  it("returns null for non-existent metric", async () => {
    const latest = await store.getLatest("nonexistent", "inst-1");
    expect(latest).toBeNull();
  });

  it("gets latest value (most recent)", async () => {
    await store.record("active_sessions", 2, "inst-1");
    await new Promise(resolve => setTimeout(resolve, 2)); // Ensure distinct timestamps
    await store.record("active_sessions", 5, "inst-1");
    await new Promise(resolve => setTimeout(resolve, 2)); // Ensure distinct timestamps
    await store.record("active_sessions", 3, "inst-1");

    const latest = await store.getLatest("active_sessions", "inst-1");
    expect(latest).toBe(3);
  });

  it("computes sum of a metric for an instance", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("messages_processed", 20, "inst-1");
    await store.record("messages_processed", 5, "inst-2");

    const sum = await store.getSum("messages_processed", "inst-1");
    expect(sum).toBe(30);
  });

  it("computes sum across all instances", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("messages_processed", 20, "inst-2");

    const sum = await store.getSum("messages_processed");
    expect(sum).toBe(30);
  });

  it("returns 0 for sum of non-existent metric", async () => {
    const sum = await store.getSum("nonexistent");
    expect(sum).toBe(0);
  });

  it("counts distinct instances", async () => {
    await store.record("messages_processed", 1, "inst-1");
    await store.record("messages_processed", 2, "inst-2");
    await store.record("tokens_consumed", 100, "inst-1");

    expect(await store.getDistinctInstanceCount()).toBe(2);
  });

  it("returns instance summary", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("tokens_consumed", 500, "inst-1");
    await store.record("active_sessions", 3, "inst-1");
    await store.record("uptime_seconds", 120, "inst-1");
    await store.record("error_count", 2, "inst-1");

    const summary = await store.getInstanceSummary("inst-1");
    expect(summary.instance_id).toBe("inst-1");
    expect(summary.messages_processed).toBe(10);
    expect(summary.tokens_consumed).toBe(500);
    expect(summary.active_sessions).toBe(3);
    expect(summary.uptime_seconds).toBe(120);
    expect(summary.error_count).toBe(2);
  });

  it("returns platform summary", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("messages_processed", 20, "inst-2");
    await store.record("tokens_consumed", 100, "inst-1");
    await store.record("error_count", 1, "inst-1");

    const summary = await store.getPlatformSummary();
    expect(summary.total_instances).toBe(2);
    expect(summary.total_messages_processed).toBe(30);
    expect(summary.total_tokens_consumed).toBe(100);
    expect(summary.total_errors).toBe(1);
  });

  it("queries metrics with filters", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("tokens_consumed", 100, "inst-1");
    await store.record("messages_processed", 20, "inst-2");

    const results = await store.query({ name: "messages_processed" });
    expect(results).toHaveLength(2);

    const inst1Results = await store.query({ name: "messages_processed", instanceId: "inst-1" });
    expect(inst1Results).toHaveLength(1);
    expect(inst1Results[0].metric_value).toBe(10);
  });

  it("queries metrics with limit", async () => {
    for (let i = 0; i < 10; i++) {
      await store.record("messages_processed", i, "inst-1");
    }

    const results = await store.query({ name: "messages_processed", limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("records metric with tags", async () => {
    await store.record("api_calls", 1, "inst-1", { provider: "openai", model: "gpt-4" });

    const results = await store.query({ name: "api_calls" });
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].tags)).toEqual({ provider: "openai", model: "gpt-4" });
  });

  it("records platform-wide metric with null instance_id", async () => {
    await store.record("total_active_users", 42);

    const latest = await store.getLatest("total_active_users");
    expect(latest).toBe(42);
  });
});
