import { describe, expect, it } from "vitest";
import { parseTemporalFilter } from "../../src/core/a2a-tools/_base.js";

describe("parseTemporalFilter", () => {
  it("parses ISO datetime with uppercase T", () => {
    const result = parseTemporalFilter("2024-01-01T10:00:00");
    expect(result).not.toBeNull();
    expect(result?.after).toBe(new Date("2024-01-01T10:00:00").getTime());
  });

  it("parses ISO datetime with lowercase t (after toLowerCase)", () => {
    // When user passes "2024-01-01t10:00:00" it should still parse
    const result = parseTemporalFilter("2024-01-01t10:00:00");
    expect(result).not.toBeNull();
  });

  it("parses date range with uppercase T in times", () => {
    const result = parseTemporalFilter("2024-01-01T08:00 to 2024-01-31T18:00");
    expect(result).not.toBeNull();
    expect(result?.after).toBeDefined();
    expect(result?.before).toBeDefined();
  });

  it("parses relative expressions", () => {
    const result = parseTemporalFilter("last 7 days");
    expect(result).not.toBeNull();
    expect(result?.after).toBeDefined();
  });

  it("parses single date", () => {
    const result = parseTemporalFilter("2024-06-15");
    expect(result).not.toBeNull();
  });
});
