import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTemporalFilter } from "../../src/core/a2a-tools/_base.js";

describe("parseTemporalFilter", () => {
  const FIXED_NOW = new Date("2024-03-15T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses ISO datetime with uppercase T", () => {
    const result = parseTemporalFilter("2024-01-01T10:00:00");
    expect(result).not.toBeNull();
    expect(result?.after).toBe(new Date("2024-01-01T10:00:00").getTime());
  });

  it("parses ISO datetime with lowercase t (after toLowerCase)", () => {
    // When user passes "2024-01-01t10:00:00" it should still parse
    const result = parseTemporalFilter("2024-01-01t10:00:00");
    expect(result).not.toBeNull();
    expect(result?.after).toBe(new Date("2024-01-01T10:00:00").getTime());
  });

  it("parses date range with uppercase T in times, preserving time components", () => {
    const result = parseTemporalFilter("2024-01-01T08:00 to 2024-01-31T18:00");
    expect(result).not.toBeNull();
    expect(result?.after).toBe(new Date("2024-01-01T08:00").getTime());
    expect(result?.before).toBe(new Date("2024-01-31T18:00").getTime());
  });

  it("parses date range without times using full-day defaults", () => {
    const result = parseTemporalFilter("2024-01-01 to 2024-01-31");
    expect(result).not.toBeNull();
    expect(result?.after).toBe(new Date("2024-01-01T00:00:00").getTime());
    expect(result?.before).toBe(new Date("2024-01-31T23:59:59.999").getTime());
  });

  it("parses relative expressions", () => {
    const result = parseTemporalFilter("last 7 days");
    expect(result).not.toBeNull();
    const expected7d = 7 * 24 * 60 * 60 * 1000;
    expect(result?.after).toBe(FIXED_NOW - expected7d);
  });

  it("parses single date", () => {
    const startOfDayMs = new Date(2024, 5, 15, 0, 0, 0, 0).getTime();
    const endOfDayMs = new Date(2024, 5, 15, 23, 59, 59, 999).getTime();
    const result = parseTemporalFilter("2024-06-15");
    expect(result).not.toBeNull();
    expect(result?.after).toBe(startOfDayMs);
    expect(result?.before).toBe(endOfDayMs);
  });
});
