import { afterEach, describe, expect, it } from "vitest";
import {
  _resetLogsForTesting,
  clearInstanceLogs,
  getInstanceLogs,
  getLoggedInstanceIds,
  recordLog,
} from "../../../src/platform/observability/logger.js";

describe("structured logger", () => {
  afterEach(() => {
    _resetLogsForTesting();
  });

  it("records a log entry with correct structure", () => {
    const entry = recordLog("inst-1", "info", "test message");

    expect(entry.instance_id).toBe("inst-1");
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("test message");
    expect(entry.timestamp).toBeTruthy();
    // timestamp should be valid ISO string
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it("records log entry with metadata", () => {
    const entry = recordLog("inst-1", "error", "something broke", { code: 500, path: "/api" });

    expect(entry.metadata).toEqual({ code: 500, path: "/api" });
  });

  it("omits metadata field when not provided", () => {
    const entry = recordLog("inst-1", "info", "plain message");

    expect(entry).not.toHaveProperty("metadata");
  });

  it("retrieves logs for a specific instance", () => {
    recordLog("inst-1", "info", "msg 1");
    recordLog("inst-2", "info", "msg 2");
    recordLog("inst-1", "warn", "msg 3");

    const logs = getInstanceLogs("inst-1");
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("msg 1");
    expect(logs[1].message).toBe("msg 3");
  });

  it("returns empty array for unknown instance", () => {
    const logs = getInstanceLogs("nonexistent");
    expect(logs).toEqual([]);
  });

  it("filters logs by level", () => {
    recordLog("inst-1", "info", "info msg");
    recordLog("inst-1", "error", "error msg");
    recordLog("inst-1", "info", "another info");

    const logs = getInstanceLogs("inst-1", { level: "error" });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("error msg");
  });

  it("filters logs by since timestamp", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    recordLog("inst-1", "info", "old msg");

    // Simulate a log entry from the past by directly checking filter
    const future = new Date(Date.now() + 60_000).toISOString();
    const logs = getInstanceLogs("inst-1", { since: future });
    expect(logs).toHaveLength(0);

    const allLogs = getInstanceLogs("inst-1", { since: past });
    expect(allLogs).toHaveLength(1);
  });

  it("limits returned logs to most recent", () => {
    for (let i = 0; i < 10; i++) {
      recordLog("inst-1", "info", `msg ${i}`);
    }

    const logs = getInstanceLogs("inst-1", { limit: 3 });
    expect(logs).toHaveLength(3);
    expect(logs[0].message).toBe("msg 7");
    expect(logs[2].message).toBe("msg 9");
  });

  it("clears logs for a specific instance", () => {
    recordLog("inst-1", "info", "msg");
    recordLog("inst-2", "info", "msg");

    clearInstanceLogs("inst-1");

    expect(getInstanceLogs("inst-1")).toHaveLength(0);
    expect(getInstanceLogs("inst-2")).toHaveLength(1);
  });

  it("returns logged instance IDs", () => {
    recordLog("inst-a", "info", "msg");
    recordLog("inst-b", "info", "msg");

    const ids = getLoggedInstanceIds();
    expect(ids).toContain("inst-a");
    expect(ids).toContain("inst-b");
    expect(ids).toHaveLength(2);
  });

  it("evicts oldest entries when buffer is full", () => {
    // Record more than MAX_LOGS_PER_INSTANCE (10000)
    for (let i = 0; i < 10_005; i++) {
      recordLog("inst-1", "info", `msg ${i}`);
    }

    const logs = getInstanceLogs("inst-1");
    expect(logs).toHaveLength(10_000);
    // First entry should be msg 5 (oldest 5 evicted)
    expect(logs[0].message).toBe("msg 5");
  });
});
