import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimitTracker } from "../../../src/core/rate-limit-tracker.js";

describe("RateLimitTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("markRateLimited + isRateLimited", () => {
    it("should mark a provider as rate-limited after a 429", () => {
      const tracker = new RateLimitTracker(1000, 60_000);
      expect(tracker.isRateLimited("openai")).toBe(false);

      tracker.markRateLimited("openai");
      expect(tracker.isRateLimited("openai")).toBe(true);
    });

    it("should not be rate-limited after backoff expires", () => {
      const tracker = new RateLimitTracker(1000, 60_000);
      tracker.markRateLimited("openai");
      expect(tracker.isRateLimited("openai")).toBe(true);

      // First hit: backoff = 1000 * 2^0 + 0 jitter = 1000ms
      vi.advanceTimersByTime(1000);
      expect(tracker.isRateLimited("openai")).toBe(false);
    });

    it("should use exponential backoff for consecutive 429s", () => {
      const tracker = new RateLimitTracker(1000, 60_000);

      // Hit 1: backoff = 1000 * 2^0 = 1000ms
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(1000);

      // Hit 2 (while still limited): backoff = 1000 * 2^1 = 2000ms
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(2000);

      // Hit 3: backoff = 1000 * 2^2 = 4000ms
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(4000);
    });

    it("should cap backoff at maxDelayMs", () => {
      const tracker = new RateLimitTracker(1000, 5000);

      // Hit 1: 1000ms, Hit 2: 2000ms, Hit 3: 4000ms, Hit 4: min(8000, 5000) = 5000ms
      tracker.markRateLimited("openai");
      tracker.markRateLimited("openai");
      tracker.markRateLimited("openai");
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(5000);
    });
  });

  describe("Retry-After header", () => {
    it("should use retryAfterSeconds when provided", () => {
      const tracker = new RateLimitTracker(1000, 60_000);
      tracker.markRateLimited("openai", 10); // 10 seconds = 10000ms
      expect(tracker.getRetryAfterMs("openai")).toBe(10_000);
    });

    it("should cap retryAfterSeconds to maxDelayMs", () => {
      const tracker = new RateLimitTracker(1000, 5000);
      tracker.markRateLimited("openai", 120); // 120s = 120000ms, capped to 5000ms
      expect(tracker.getRetryAfterMs("openai")).toBe(5000);
    });

    it("should ignore retryAfterSeconds when zero or negative", () => {
      const tracker = new RateLimitTracker(1000, 60_000);
      tracker.markRateLimited("openai", 0);
      // Falls back to exponential: 1000 * 2^0 = 1000ms
      expect(tracker.getRetryAfterMs("openai")).toBe(1000);

      const tracker2 = new RateLimitTracker(1000, 60_000);
      tracker2.markRateLimited("anthropic", -5);
      expect(tracker2.getRetryAfterMs("anthropic")).toBe(1000);
    });
  });

  describe("consecutive hit counter reset", () => {
    it("should reset consecutive hits when previous backoff has expired", () => {
      const tracker = new RateLimitTracker(1000, 60_000);

      // Hit 1: backoff = 1000ms
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(1000);

      // Hit 2 (still limited): backoff = 2000ms (consecutive)
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(2000);

      // Wait for backoff to expire
      vi.advanceTimersByTime(2000);
      expect(tracker.isRateLimited("openai")).toBe(false);

      // Hit 3 (after expiry): resets to hit 1 — backoff = 1000ms
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(1000);
    });
  });

  describe("key isolation", () => {
    it("should track providers independently", () => {
      const tracker = new RateLimitTracker(1000, 60_000);

      tracker.markRateLimited("openai");
      tracker.markRateLimited("anthropic");

      expect(tracker.isRateLimited("openai")).toBe(true);
      expect(tracker.isRateLimited("anthropic")).toBe(true);
      expect(tracker.isRateLimited("google")).toBe(false);
    });

    it("should not share consecutive hit counts between providers", () => {
      const tracker = new RateLimitTracker(1000, 60_000);

      // Escalate openai to hit 3
      tracker.markRateLimited("openai");
      tracker.markRateLimited("openai");
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(4000);

      // anthropic starts fresh at hit 1
      tracker.markRateLimited("anthropic");
      expect(tracker.getRetryAfterMs("anthropic")).toBe(1000);
    });
  });

  describe("clearProvider", () => {
    it("should remove rate limit state for a specific provider", () => {
      const tracker = new RateLimitTracker(1000, 60_000);
      tracker.markRateLimited("openai");
      tracker.markRateLimited("anthropic");

      tracker.clearProvider("openai");

      expect(tracker.isRateLimited("openai")).toBe(false);
      expect(tracker.getRetryAfterMs("openai")).toBe(0);
      expect(tracker.isRateLimited("anthropic")).toBe(true);
    });

    it("should reset consecutive hits after clear (fresh start)", () => {
      const tracker = new RateLimitTracker(1000, 60_000);

      // Escalate to hit 3
      tracker.markRateLimited("openai");
      tracker.markRateLimited("openai");
      tracker.markRateLimited("openai");

      tracker.clearProvider("openai");

      // Next hit starts fresh at hit 1
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(1000);
    });
  });

  describe("clearAll", () => {
    it("should remove all tracked state", () => {
      const tracker = new RateLimitTracker(1000, 60_000);
      tracker.markRateLimited("openai");
      tracker.markRateLimited("anthropic");
      tracker.markRateLimited("google");

      tracker.clearAll();

      expect(tracker.isRateLimited("openai")).toBe(false);
      expect(tracker.isRateLimited("anthropic")).toBe(false);
      expect(tracker.isRateLimited("google")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should cap exponent at 30 to prevent Infinity", () => {
      const tracker = new RateLimitTracker(1, 1_000_000_000);

      // Simulate 35 consecutive hits
      for (let i = 0; i < 35; i++) {
        tracker.markRateLimited("openai");
      }

      // Should not be Infinity — capped at 2^30 = 1073741824
      const ms = tracker.getRetryAfterMs("openai");
      expect(ms).toBeLessThanOrEqual(1_000_000_000);
      expect(Number.isFinite(ms)).toBe(true);
    });

    it("getRetryAfterMs should return 0 for unknown provider", () => {
      const tracker = new RateLimitTracker();
      expect(tracker.getRetryAfterMs("unknown")).toBe(0);
    });

    it("getRetryAfterMs should return 0 after backoff expires", () => {
      const tracker = new RateLimitTracker(1000, 60_000);
      tracker.markRateLimited("openai");

      vi.advanceTimersByTime(1000);
      expect(tracker.getRetryAfterMs("openai")).toBe(0);
    });

    it("getRetryAfterMs should return remaining time during backoff", () => {
      const tracker = new RateLimitTracker(1000, 60_000);
      tracker.markRateLimited("openai");

      vi.advanceTimersByTime(400);
      expect(tracker.getRetryAfterMs("openai")).toBe(600);
    });

    it("isRateLimited should set retryAfter to 0 when expired (side effect)", () => {
      const tracker = new RateLimitTracker(1000, 60_000);
      tracker.markRateLimited("openai");

      vi.advanceTimersByTime(1000);

      // First call: returns false and sets retryAfter = 0
      expect(tracker.isRateLimited("openai")).toBe(false);
      // getRetryAfterMs also returns 0
      expect(tracker.getRetryAfterMs("openai")).toBe(0);
    });

    it("should use default constructor values (1000ms base, 60000ms max)", () => {
      const tracker = new RateLimitTracker();
      tracker.markRateLimited("openai");
      expect(tracker.getRetryAfterMs("openai")).toBe(1000);
    });

    it("clearProvider on unknown provider should not throw", () => {
      const tracker = new RateLimitTracker();
      expect(() => tracker.clearProvider("nonexistent")).not.toThrow();
    });
  });
});
