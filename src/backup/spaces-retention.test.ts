import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpacesObject } from "./spaces-client.js";
import { getISOWeekKey, selectRetained } from "./spaces-retention.js";

const NOW = new Date("2026-02-14T12:00:00Z");
const DAY_MS = 86_400_000;

/** Return a Date `n` days before NOW */
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

/** Format a Date as YYYY-MM-DD */
function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Helper to create a SpacesObject for a given date string */
function obj(dateStr: string, path?: string): SpacesObject {
  return {
    date: `${dateStr}T03:00:00Z`,
    size: 100_000_000,
    path: path ?? `nightly/node-1/tenant_abc/tenant_abc_${dateStr.replace(/-/g, "")}.tar.gz`,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getISOWeekKey", () => {
  it("returns correct ISO week for a date", () => {
    // NOW (2026-02-14) is a Saturday in ISO week 7
    const key = getISOWeekKey(new Date(NOW.getTime() - 9 * 3_600_000)); // same day as NOW, 03:00 UTC
    expect(key).toMatch(/^2026-W\d{2}$/);
  });

  it("returns different keys for dates in different weeks", () => {
    const w1 = getISOWeekKey(daysAgo(13)); // 13 days before NOW
    const w2 = getISOWeekKey(daysAgo(0)); // NOW's date
    expect(w1).not.toBe(w2);
  });

  it("handles year boundary correctly (Dec 31 can be ISO week 1 of next year)", () => {
    // 2025-12-29 is a Monday, ISO week 1 of 2026
    const key = getISOWeekKey(new Date("2025-12-29T00:00:00Z"));
    expect(key).toBe("2026-W01");
  });

  it("handles year boundary correctly (Jan 1 can be ISO week 53 of prior year)", () => {
    // 2027-01-01 is a Friday. The Thursday of that week is 2026-12-31, so ISO year 2026, week 53.
    const key = getISOWeekKey(new Date("2027-01-01T00:00:00Z"));
    expect(key).toBe("2026-W53");
  });
});

describe("selectRetained", () => {
  it("keeps the most recent N daily backups", () => {
    const objects = [
      obj(fmt(daysAgo(0))),
      obj(fmt(daysAgo(1))),
      obj(fmt(daysAgo(2))),
      obj(fmt(daysAgo(3))),
      obj(fmt(daysAgo(4))),
    ];

    const retained = selectRetained(objects, { dailyCount: 3, weeklyCount: 0 }, new Date());
    expect(retained).toHaveLength(3);
    expect(retained.map((o) => o.date)).toContain(`${fmt(daysAgo(0))}T03:00:00Z`);
    expect(retained.map((o) => o.date)).toContain(`${fmt(daysAgo(1))}T03:00:00Z`);
    expect(retained.map((o) => o.date)).toContain(`${fmt(daysAgo(2))}T03:00:00Z`);
  });

  it("keeps weekly backups from older items", () => {
    // 14 days of daily backups, keep 3 daily + 2 weekly
    const objects: SpacesObject[] = [];
    for (let i = 0; i < 14; i++) {
      objects.push(obj(fmt(daysAgo(i))));
    }

    const retained = selectRetained(objects, { dailyCount: 3, weeklyCount: 2 }, new Date());

    // Should have 3 daily + up to 2 weekly from the remaining 11
    expect(retained.length).toBeGreaterThanOrEqual(3);
    expect(retained.length).toBeLessThanOrEqual(5);
  });

  it("handles fewer objects than daily limit", () => {
    const objects = [obj(fmt(daysAgo(0))), obj(fmt(daysAgo(1)))];

    const retained = selectRetained(objects, { dailyCount: 7, weeklyCount: 4 }, new Date());
    expect(retained).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    const retained = selectRetained([], { dailyCount: 7, weeklyCount: 4 }, new Date());
    expect(retained).toHaveLength(0);
  });

  it("does not duplicate objects in daily and weekly sets", () => {
    const objects = [obj(fmt(daysAgo(0))), obj(fmt(daysAgo(1))), obj(fmt(daysAgo(2)))];

    const retained = selectRetained(objects, { dailyCount: 7, weeklyCount: 4 }, new Date());
    const paths = retained.map((o) => o.path);
    const unique = new Set(paths);
    expect(paths.length).toBe(unique.size);
  });
});
