import { describe, it, expect } from "vitest";
import { canIndexSession } from "../../src/security/types.js";
import type { AccessPattern } from "../../src/security/types.js";

describe("canIndexSession", () => {
  it("matches wildcard *", () => {
    expect(canIndexSession("a", "b", ["*"])).toBe(true);
  });

  it("matches self", () => {
    expect(canIndexSession("sess-1", "sess-1", ["self"])).toBe(true);
    expect(canIndexSession("sess-1", "sess-2", ["self"])).toBe(false);
  });

  it("matches exact session name", () => {
    expect(canIndexSession("me", "target", ["target"])).toBe(true);
    expect(canIndexSession("me", "other", ["target"])).toBe(false);
  });

  it("matches session: with glob * wildcard", () => {
    const patterns: AccessPattern[] = ["session:admin-*"];
    expect(canIndexSession("me", "admin-foo", patterns)).toBe(true);
    expect(canIndexSession("me", "admin-bar-baz", patterns)).toBe(true);
    expect(canIndexSession("me", "user-foo", patterns)).toBe(false);
  });

  it("matches session: with glob ? wildcard", () => {
    const patterns: AccessPattern[] = ["session:bot-?"];
    expect(canIndexSession("me", "bot-A", patterns)).toBe(true);
    expect(canIndexSession("me", "bot-AB", patterns)).toBe(false);
  });

  it("does NOT execute regex metacharacters in session: patterns", () => {
    // (a+)+$ would cause catastrophic backtracking if treated as regex
    const patterns: AccessPattern[] = ["session:(a+)+$"];
    // Should NOT match "aaaaaaaaaaaaaaaaaaaaaaaaa!" — it should treat pattern literally
    expect(canIndexSession("me", "aaaaaaaaaaaaaaaaaaaaaaaaa!", patterns)).toBe(false);
    // Should only match the literal string "(a+)+$"
    expect(canIndexSession("me", "(a+)+$", patterns)).toBe(true);
  });

  it("completes in bounded time even with adversarial pattern", () => {
    // If this were regex, it would hang for seconds/minutes
    const patterns: AccessPattern[] = ["session:(a+)+$"];
    const start = performance.now();
    canIndexSession("me", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", patterns);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10); // Must complete in <10ms
  });

  it("matches session: exact string (no wildcards)", () => {
    const patterns: AccessPattern[] = ["session:my-session"];
    expect(canIndexSession("me", "my-session", patterns)).toBe(true);
    expect(canIndexSession("me", "my-session-2", patterns)).toBe(false);
  });
});
