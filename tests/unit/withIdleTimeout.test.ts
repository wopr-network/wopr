import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { withIdleTimeout } from "../../src/core/sessions.js";

describe("withIdleTimeout timer cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should clear setTimeout after each successful iteration", async () => {
    async function* threeValues() {
      yield 1;
      yield 2;
      yield 3;
    }

    const results: number[] = [];
    for await (const val of withIdleTimeout(threeValues(), 60_000)) {
      results.push(val);
    }

    expect(results).toEqual([1, 2, 3]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should clear timeout on error path", async () => {
    async function* errorAfterOne() {
      yield 1;
      throw new Error("stream error");
    }

    const results: number[] = [];
    await expect(async () => {
      for await (const val of withIdleTimeout(errorAfterOne(), 60_000)) {
        results.push(val);
      }
    }).rejects.toThrow("stream error");

    expect(results).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
