import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MetricsStore } from "../../../src/platform/observability/metrics.js";

describe("MetricsStore", () => {
  let store: MetricsStore;
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = join(tmpdir(), `wopr-metrics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dbDir, { recursive: true });
    dbPath = join(dbDir, "test-metrics.sqlite");
    store = new MetricsStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("records and retrieves a metric", () => {
    store.record("messages_processed", 5, "inst-1");

    const latest = store.getLatest("messages_processed", "inst-1");
    expect(latest).toBe(5);
  });

  it("returns null for non-existent metric", () => {
    const latest = store.getLatest("nonexistent", "inst-1");
    expect(latest).toBeNull();
  });

  it("gets latest value (most recent)", () => {
    store.record("active_sessions", 2, "inst-1");
    store.record("active_sessions", 5, "inst-1");
    store.record("active_sessions", 3, "inst-1");

    const latest = store.getLatest("active_sessions", "inst-1");
    expect(latest).toBe(3);
  });

  it("computes sum of a metric for an instance", () => {
    store.record("messages_processed", 10, "inst-1");
    store.record("messages_processed", 20, "inst-1");
    store.record("messages_processed", 5, "inst-2");

    const sum = store.getSum("messages_processed", "inst-1");
    expect(sum).toBe(30);
  });

  it("computes sum across all instances", () => {
    store.record("messages_processed", 10, "inst-1");
    store.record("messages_processed", 20, "inst-2");

    const sum = store.getSum("messages_processed");
    expect(sum).toBe(30);
  });

  it("returns 0 for sum of non-existent metric", () => {
    const sum = store.getSum("nonexistent");
    expect(sum).toBe(0);
  });

  it("counts distinct instances", () => {
    store.record("messages_processed", 1, "inst-1");
    store.record("messages_processed", 2, "inst-2");
    store.record("tokens_consumed", 100, "inst-1");

    expect(store.getDistinctInstanceCount()).toBe(2);
  });

  it("returns instance summary", () => {
    store.record("messages_processed", 10, "inst-1");
    store.record("tokens_consumed", 500, "inst-1");
    store.record("active_sessions", 3, "inst-1");
    store.record("uptime_seconds", 120, "inst-1");
    store.record("error_count", 2, "inst-1");

    const summary = store.getInstanceSummary("inst-1");
    expect(summary.instance_id).toBe("inst-1");
    expect(summary.messages_processed).toBe(10);
    expect(summary.tokens_consumed).toBe(500);
    expect(summary.active_sessions).toBe(3);
    expect(summary.uptime_seconds).toBe(120);
    expect(summary.error_count).toBe(2);
  });

  it("returns platform summary", () => {
    store.record("messages_processed", 10, "inst-1");
    store.record("messages_processed", 20, "inst-2");
    store.record("tokens_consumed", 100, "inst-1");
    store.record("error_count", 1, "inst-1");

    const summary = store.getPlatformSummary();
    expect(summary.total_instances).toBe(2);
    expect(summary.total_messages_processed).toBe(30);
    expect(summary.total_tokens_consumed).toBe(100);
    expect(summary.total_errors).toBe(1);
  });

  it("queries metrics with filters", () => {
    store.record("messages_processed", 10, "inst-1");
    store.record("tokens_consumed", 100, "inst-1");
    store.record("messages_processed", 20, "inst-2");

    const results = store.query({ name: "messages_processed" });
    expect(results).toHaveLength(2);

    const inst1Results = store.query({ name: "messages_processed", instanceId: "inst-1" });
    expect(inst1Results).toHaveLength(1);
    expect(inst1Results[0].metric_value).toBe(10);
  });

  it("queries metrics with limit", () => {
    for (let i = 0; i < 10; i++) {
      store.record("messages_processed", i, "inst-1");
    }

    const results = store.query({ name: "messages_processed", limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("records metric with tags", () => {
    store.record("api_calls", 1, "inst-1", { provider: "openai", model: "gpt-4" });

    const results = store.query({ name: "api_calls" });
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].tags)).toEqual({ provider: "openai", model: "gpt-4" });
  });

  it("records platform-wide metric with null instance_id", () => {
    store.record("total_active_users", 42);

    const latest = store.getLatest("total_active_users");
    expect(latest).toBe(42);
  });
});
