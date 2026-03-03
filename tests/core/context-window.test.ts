import { describe, it, expect } from "vitest";

import {
  estimateTokens,
  getModelContextLimit,
  resolveContextWindowConfig,
  type ContextWindowConfig,
  type ContextAssemblyOptions,
} from "../../src/core/context.js";

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 characters", () => {
    const text = "a".repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("rounds up for non-divisible lengths", () => {
    // 5 chars -> ceil(5/4) = 2
    expect(estimateTokens("hello")).toBe(2);
  });
});

describe("getModelContextLimit", () => {
  it("returns known limit for gpt-4o", () => {
    expect(getModelContextLimit("gpt-4o")).toBe(128_000);
  });

  it("returns default for unknown model", () => {
    expect(getModelContextLimit("some-unknown-model")).toBe(8_192);
  });

  it("handles undefined model", () => {
    expect(getModelContextLimit(undefined)).toBe(8_192);
  });

  it("returns correct limit for claude-3-5-sonnet-20241022", () => {
    expect(getModelContextLimit("claude-3-5-sonnet-20241022")).toBe(200_000);
  });

  it("returns correct limit for gemini-1.5-pro", () => {
    expect(getModelContextLimit("gemini-1.5-pro")).toBe(1_000_000);
  });

  it("returns correct limit for deepseek-chat", () => {
    expect(getModelContextLimit("deepseek-chat")).toBe(64_000);
  });
});

describe("resolveContextWindowConfig", () => {
  it("returns defaults when no model or overrides", () => {
    const cfg = resolveContextWindowConfig();
    expect(cfg.maxHistoryTokens).toBe(Math.floor(8_192 * 0.9));
    expect(cfg.maxEntries).toBe(50);
    expect(cfg.maxEntryTokens).toBe(Math.floor(Math.floor(8_192 * 0.9) * 0.25));
  });

  it("respects model-specific limit", () => {
    const cfg = resolveContextWindowConfig("gpt-4o");
    expect(cfg.maxHistoryTokens).toBe(Math.floor(128_000 * 0.9));
  });

  it("respects explicit maxHistoryTokens override", () => {
    const cfg = resolveContextWindowConfig("gpt-4o", {
      maxHistoryTokens: 5000,
      maxEntries: 10,
    });
    expect(cfg.maxHistoryTokens).toBe(5000);
    expect(cfg.maxEntries).toBe(10);
  });

  it("maxEntryTokens does not exceed maxHistoryTokens when maxHistoryTokens is overridden", () => {
    // Without the fix, maxEntryTokens would be ~28800 (25% of gpt-4o's 115200) but maxHistoryTokens is 1000
    const cfg = resolveContextWindowConfig("gpt-4o", { maxHistoryTokens: 1000 });
    expect(cfg.maxHistoryTokens).toBe(1000);
    expect(cfg.maxEntryTokens).toBeLessThanOrEqual(cfg.maxHistoryTokens);
    expect(cfg.maxEntryTokens).toBe(Math.floor(1000 * 0.25));
  });

  it("respects custom safetyMargin", () => {
    const cfg = resolveContextWindowConfig("gpt-4o", { safetyMargin: 0.5 });
    expect(cfg.maxHistoryTokens).toBe(Math.floor(128_000 * 0.5));
  });

  it("maxEntryTokens defaults to 25% of maxHistoryTokens", () => {
    const cfg = resolveContextWindowConfig("gpt-4o");
    const expectedHistory = Math.floor(128_000 * 0.9);
    expect(cfg.maxEntryTokens).toBe(Math.floor(expectedHistory * 0.25));
  });

  it("maxEntryTokens does not exceed maxHistoryTokens when maxHistoryTokens is overridden to a small value", () => {
    // Regression: maxEntryTokens was derived from effectiveLimit (e.g. 115200 for gpt-4o)
    // even when maxHistoryTokens was overridden to 500, so a single entry could exceed the budget.
    const cfg = resolveContextWindowConfig("gpt-4o", { maxHistoryTokens: 500 });
    expect(cfg.maxHistoryTokens).toBe(500);
    expect(cfg.maxEntryTokens).toBeLessThanOrEqual(cfg.maxHistoryTokens);
    expect(cfg.maxEntryTokens).toBe(Math.floor(500 * 0.25));
  });
});

describe("assembleContext model option types", () => {
  it("ContextAssemblyOptions accepts model field", () => {
    const opts = { model: "gpt-4o" } satisfies Partial<ContextAssemblyOptions>;
    expect(opts.model).toBe("gpt-4o");
  });

  it("ContextAssemblyOptions accepts contextWindow overrides", () => {
    const opts: Partial<ContextAssemblyOptions> = {
      model: "gpt-4o",
      contextWindow: { maxHistoryTokens: 5000, safetyMargin: 0.8 },
    };
    expect(opts.contextWindow?.maxHistoryTokens).toBe(5000);
  });

  it("ContextWindowConfig type has correct fields", () => {
    const cfg: ContextWindowConfig = {
      maxHistoryTokens: 1000,
      maxEntryTokens: 250,
      maxEntries: 50,
    };
    expect(cfg.maxHistoryTokens).toBe(1000);
    expect(cfg.maxEntryTokens).toBe(250);
    expect(cfg.maxEntries).toBe(50);
  });
});
