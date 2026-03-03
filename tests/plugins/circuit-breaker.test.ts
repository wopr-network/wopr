import { beforeEach, describe, expect, it } from "vitest";
import { CircuitBreaker } from "../../src/plugins/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker(5);
  });

  it("is not tripped initially", () => {
    expect(breaker.isTripped("test-plugin")).toBe(false);
  });

  it("does not trip before threshold", () => {
    for (let i = 0; i < 4; i++) {
      breaker.recordError("test-plugin", new Error("boom"));
    }
    expect(breaker.isTripped("test-plugin")).toBe(false);
  });

  it("trips after threshold consecutive errors", () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordError("test-plugin", new Error("boom"));
    }
    expect(breaker.isTripped("test-plugin")).toBe(true);
  });

  it("resets on success", () => {
    for (let i = 0; i < 4; i++) {
      breaker.recordError("test-plugin", new Error("boom"));
    }
    breaker.recordSuccess("test-plugin");
    // 4 more errors should not trip (count reset to 0)
    for (let i = 0; i < 4; i++) {
      breaker.recordError("test-plugin", new Error("boom"));
    }
    expect(breaker.isTripped("test-plugin")).toBe(false);
  });

  it("tracks plugins independently", () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordError("bad-plugin", new Error("boom"));
    }
    expect(breaker.isTripped("bad-plugin")).toBe(true);
    expect(breaker.isTripped("good-plugin")).toBe(false);
  });

  it("clear removes tripped state", () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordError("test-plugin", new Error("boom"));
    }
    breaker.clear("test-plugin");
    expect(breaker.isTripped("test-plugin")).toBe(false);
  });
});
