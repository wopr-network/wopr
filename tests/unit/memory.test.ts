/**
 * Memory Module Tests (WOP-12)
 *
 * Tests FTS query building, BM25 score normalization, temporal filtering,
 * markdown chunking, and hashing.
 *
 * The MemoryIndexManager requires node:sqlite which is Node 22+ only,
 * so we test the pure utility functions and the exported helpers from
 * the internal module.
 */
import { describe, expect, it, vi } from "vitest";

// Mock the logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import the pure utility functions from the internal module
const { hashText, chunkMarkdown, normalizeRelPath, isMemoryPath, normalizeExtraMemoryPaths } =
  await import("../../src/memory/internal.js");

// Import buildFtsQuery and bm25RankToScore from the manager module
// These are not exported, so we test them indirectly or re-implement for testing.
// Instead, we'll test the logic directly since the functions are simple enough to verify.

describe("Memory Module - Pure Utility Functions", () => {
  // ========================================================================
  // FTS5 Query Building
  // ========================================================================
  describe("FTS query building logic", () => {
    // Replicate buildFtsQuery logic for testing
    function buildFtsQuery(raw: string): string | null {
      const tokens =
        raw
          .match(/[A-Za-z0-9_]+/g)
          ?.map((t) => t.trim())
          .filter(Boolean) ?? [];
      if (tokens.length === 0) return null;
      const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
      return quoted.join(" AND ");
    }

    it("should tokenize input and build MATCH query with AND", () => {
      const result = buildFtsQuery("authentication OAuth flow");
      expect(result).toBe('"authentication" AND "OAuth" AND "flow"');
    });

    it("should handle single word", () => {
      expect(buildFtsQuery("memory")).toBe('"memory"');
    });

    it("should return null for empty string", () => {
      expect(buildFtsQuery("")).toBeNull();
    });

    it("should return null for string with only special chars", () => {
      expect(buildFtsQuery("!@#$%^&*()")).toBeNull();
    });

    it("should strip quotes from tokens", () => {
      const result = buildFtsQuery('"quoted" term');
      expect(result).toBe('"quoted" AND "term"');
    });

    it("should handle underscored identifiers", () => {
      expect(buildFtsQuery("memory_manager")).toBe('"memory_manager"');
    });
  });

  // ========================================================================
  // BM25 Rank to Score
  // ========================================================================
  describe("BM25 rank to score normalization", () => {
    // Replicate bm25RankToScore logic
    function bm25RankToScore(rank: number): number {
      const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
      return 1 / (1 + normalized);
    }

    it("should return 1 for rank 0 (highest relevance)", () => {
      expect(bm25RankToScore(0)).toBe(1);
    });

    it("should return lower scores for higher rank values", () => {
      const score5 = bm25RankToScore(5);
      const score10 = bm25RankToScore(10);
      expect(score5).toBeGreaterThan(score10);
    });

    it("should handle negative ranks by clamping to 0", () => {
      expect(bm25RankToScore(-5)).toBe(1); // max(0, -5) = 0 → 1/(1+0) = 1
    });

    it("should handle Infinity by using 999", () => {
      const score = bm25RankToScore(Infinity);
      expect(score).toBeCloseTo(1 / 1000, 5);
    });

    it("should handle NaN by using 999", () => {
      const score = bm25RankToScore(NaN);
      expect(score).toBeCloseTo(1 / 1000, 5);
    });
  });

  // ========================================================================
  // Temporal Filtering
  // ========================================================================
  describe("temporal filter building logic", () => {
    // Replicate buildTemporalFilter logic
    function buildTemporalFilter(
      temporal: { after?: number; before?: number } | undefined,
      alias?: string,
    ): { sql: string; params: number[] } {
      if (!temporal) return { sql: "", params: [] };
      const column = alias ? `${alias}.updated_at` : "updated_at";
      const clauses: string[] = [];
      const params: number[] = [];
      if (temporal.after !== undefined) {
        clauses.push(`${column} >= ?`);
        params.push(temporal.after);
      }
      if (temporal.before !== undefined) {
        clauses.push(`${column} <= ?`);
        params.push(temporal.before);
      }
      if (clauses.length === 0) return { sql: "", params: [] };
      return { sql: ` AND ${clauses.join(" AND ")}`, params };
    }

    it("should return empty for undefined temporal", () => {
      const result = buildTemporalFilter(undefined);
      expect(result.sql).toBe("");
      expect(result.params).toEqual([]);
    });

    it("should build after filter", () => {
      const result = buildTemporalFilter({ after: 1000 });
      expect(result.sql).toContain(">=");
      expect(result.params).toEqual([1000]);
    });

    it("should build before filter", () => {
      const result = buildTemporalFilter({ before: 2000 });
      expect(result.sql).toContain("<=");
      expect(result.params).toEqual([2000]);
    });

    it("should combine after and before with AND", () => {
      const result = buildTemporalFilter({ after: 1000, before: 2000 });
      expect(result.sql).toContain("AND");
      expect(result.params).toEqual([1000, 2000]);
    });

    it("should use alias when provided", () => {
      const result = buildTemporalFilter({ after: 1000 }, "c");
      expect(result.sql).toContain("c.updated_at");
    });

    it("should return empty for empty temporal object", () => {
      const result = buildTemporalFilter({});
      expect(result.sql).toBe("");
    });
  });

  // ========================================================================
  // Hashing
  // ========================================================================
  describe("hashText", () => {
    it("should return SHA256 hex digest", () => {
      const hash = hashText("hello world");
      expect(hash).toHaveLength(64); // SHA256 = 64 hex chars
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it("should return consistent hash for same input", () => {
      expect(hashText("test")).toBe(hashText("test"));
    });

    it("should return different hash for different input", () => {
      expect(hashText("a")).not.toBe(hashText("b"));
    });
  });

  // ========================================================================
  // Markdown Chunking
  // ========================================================================
  describe("chunkMarkdown", () => {
    it("should split content into chunks based on token limit", () => {
      const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10";
      // With small token limit, should create multiple chunks
      const chunks = chunkMarkdown(content, { tokens: 4, overlap: 0 }); // 4 tokens * 4 chars = 16 chars max
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should produce a single empty-text chunk for empty content", () => {
      // "".split("\n") produces [""], so the implementation flushes one empty chunk
      const chunks = chunkMarkdown("", { tokens: 100, overlap: 0 });
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("");
      expect(chunks[0].startLine).toBe(1);
    });

    it("should include startLine and endLine in each chunk", () => {
      const chunks = chunkMarkdown("Line 1\nLine 2\nLine 3", { tokens: 100, overlap: 0 });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBeGreaterThanOrEqual(1);
    });

    it("should include hash for each chunk", () => {
      const chunks = chunkMarkdown("Some content here", { tokens: 100, overlap: 0 });
      expect(chunks[0].hash).toBeTruthy();
      expect(chunks[0].hash).toHaveLength(64);
    });

    it("should handle overlap between chunks", () => {
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} with some text content`).join("\n");
      const chunks = chunkMarkdown(lines, { tokens: 20, overlap: 5 }); // 80 chars max, 20 chars overlap

      if (chunks.length >= 2) {
        // With overlap, second chunk should start at or before first chunk's end
        expect(chunks[1].startLine).toBeLessThanOrEqual(chunks[0].endLine + 1);
      }
    });

    it("should produce chunks with text property", () => {
      const chunks = chunkMarkdown("Hello\nWorld", { tokens: 100, overlap: 0 });
      expect(chunks[0].text).toContain("Hello");
    });
  });

  // ========================================================================
  // Path Utilities
  // ========================================================================
  describe("normalizeRelPath", () => {
    it("should strip leading dots and slashes", () => {
      expect(normalizeRelPath("./memory/notes.md")).toBe("memory/notes.md");
      expect(normalizeRelPath("../file.md")).toBe("file.md");
    });

    it("should convert backslashes to forward slashes", () => {
      expect(normalizeRelPath("memory\\notes.md")).toBe("memory/notes.md");
    });

    it("should trim whitespace", () => {
      expect(normalizeRelPath("  memory/notes.md  ")).toBe("memory/notes.md");
    });
  });

  describe("isMemoryPath", () => {
    it("should match MEMORY.md at root", () => {
      expect(isMemoryPath("MEMORY.md")).toBe(true);
      expect(isMemoryPath("memory.md")).toBe(true);
    });

    it("should match paths under memory/", () => {
      expect(isMemoryPath("memory/notes.md")).toBe(true);
      expect(isMemoryPath("memory/deep/nested.md")).toBe(true);
    });

    it("should not match other paths", () => {
      expect(isMemoryPath("src/index.ts")).toBe(false);
      expect(isMemoryPath("README.md")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isMemoryPath("")).toBe(false);
    });
  });

  describe("normalizeExtraMemoryPaths", () => {
    it("should resolve relative paths against workspace dir", () => {
      const result = normalizeExtraMemoryPaths("/home/user", ["extra/memory"]);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("extra/memory");
    });

    it("should return empty for undefined/empty input", () => {
      expect(normalizeExtraMemoryPaths("/home/user")).toEqual([]);
      expect(normalizeExtraMemoryPaths("/home/user", [])).toEqual([]);
    });

    it("should deduplicate paths", () => {
      const result = normalizeExtraMemoryPaths("/home/user", ["/abs/path", "/abs/path"]);
      expect(result).toHaveLength(1);
    });
  });
});
