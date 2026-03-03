/**
 * Tests for A2A streaming interface (WOP-1507)
 *
 * Verifies that:
 * - isAsyncIterable correctly identifies streaming vs non-streaming results
 * - accumulateChunks collects chunks into a single A2AToolResult
 * - Non-streaming handlers are unchanged
 * - Error chunks propagate isError=true
 */

import { describe, expect, it } from "vitest";
import { accumulateChunks, isAsyncIterable } from "../../src/core/a2a-tools/_base.js";
import type { ToolResultChunk } from "../../src/plugin-types/a2a.js";

// Helper to create an async iterable from an array of chunks
async function* chunksFrom(chunks: ToolResultChunk[]): AsyncIterable<ToolResultChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("isAsyncIterable", () => {
  it("returns true for an async generator", () => {
    const gen = chunksFrom([{ text: "hello" }]);
    expect(isAsyncIterable(gen)).toBe(true);
  });

  it("returns true for an object with Symbol.asyncIterator", () => {
    const obj = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.resolve({ value: undefined, done: true as const });
          },
        };
      },
    };
    expect(isAsyncIterable(obj)).toBe(true);
  });

  it("returns false for a Promise", () => {
    const promise = Promise.resolve({ content: [{ type: "text" as const, text: "hello" }] });
    expect(isAsyncIterable(promise)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAsyncIterable(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAsyncIterable(undefined)).toBe(false);
  });

  it("returns false for a plain object without Symbol.asyncIterator", () => {
    expect(isAsyncIterable({ content: [] })).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isAsyncIterable("hello")).toBe(false);
  });
});

describe("accumulateChunks", () => {
  it("concatenates text chunks into a single result", async () => {
    const iterable = chunksFrom([{ text: "hello " }, { text: "world" }]);
    const result = await accumulateChunks(iterable);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("hello world");
  });

  it("returns empty string for no chunks", async () => {
    const iterable = chunksFrom([]);
    const result = await accumulateChunks(iterable);
    expect(result.content[0].text).toBe("");
    expect(result.isError).toBeUndefined();
  });

  it("sets isError when any chunk has isError=true", async () => {
    const iterable = chunksFrom([{ text: "partial " }, { text: "error", isError: true }]);
    const result = await accumulateChunks(iterable);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("partial error");
  });

  it("does not set isError when no chunk has isError", async () => {
    const iterable = chunksFrom([{ text: "ok" }]);
    const result = await accumulateChunks(iterable);
    expect(result.isError).toBeUndefined();
  });

  it("handles single chunk", async () => {
    const iterable = chunksFrom([{ text: "single" }]);
    const result = await accumulateChunks(iterable);
    expect(result.content[0].text).toBe("single");
  });

  it("handles many chunks", async () => {
    const chunks: ToolResultChunk[] = Array.from({ length: 10 }, (_, i) => ({ text: `chunk${i}` }));
    const iterable = chunksFrom(chunks);
    const result = await accumulateChunks(iterable);
    expect(result.content[0].text).toBe("chunk0chunk1chunk2chunk3chunk4chunk5chunk6chunk7chunk8chunk9");
  });
});

describe("A2A streaming interface — type contract", () => {
  it("non-streaming handler returns Promise<A2AToolResult> unchanged", async () => {
    const handler = async (_args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: "non-streaming result" }],
    });

    const result = handler({});
    // Must be a Promise, not an AsyncIterable
    expect(isAsyncIterable(result)).toBe(false);
    const resolved = await result;
    expect(resolved.content[0].text).toBe("non-streaming result");
  });

  it("streaming handler returns AsyncIterable<ToolResultChunk>", async () => {
    const handler = (_args: Record<string, unknown>): AsyncIterable<ToolResultChunk> => {
      return chunksFrom([{ text: "stream " }, { text: "result" }]);
    };

    const result = handler({});
    expect(isAsyncIterable(result)).toBe(true);
    const accumulated = await accumulateChunks(result as AsyncIterable<ToolResultChunk>);
    expect(accumulated.content[0].text).toBe("stream result");
  });
});
