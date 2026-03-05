import { describe, it, expect, vi, afterEach } from "vitest";

describe("withIdleTimeout timer cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Replicate withIdleTimeout to validate the fixed pattern clears timers
  async function* withIdleTimeout<T>(
    iter: AsyncIterable<T>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): AsyncGenerator<T> {
    const iterator = iter[Symbol.asyncIterator]();
    while (true) {
      if (signal?.aborted) {
        throw new Error("Inject cancelled");
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Idle timeout: no message received for ${timeoutMs / 1000}s`)),
          timeoutMs,
        );
      });

      try {
        const result = await Promise.race([iterator.next(), timeoutPromise]);
        clearTimeout(timeoutId);
        if (result.done) break;
        yield result.value;
      } catch (e) {
        clearTimeout(timeoutId);
        iterator.return?.();
        throw e;
      }
    }
  }

  it("should clear setTimeout after each successful iteration", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

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
    // 4 calls: 3 iterations + 1 for the final done=true iteration
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(4);
  });

  it("should clear timeout on error path", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

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
    // 2 calls: 1 successful iteration + 1 in catch block
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);
  });
});
