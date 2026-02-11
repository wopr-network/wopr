/**
 * Query Module Tests (WOP-89)
 *
 * Tests for src/core/query.ts covering:
 * - getProviderStatus: returns lastChecked from registry (not Date.now())
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config
vi.mock("../../src/core/config.js", () => ({
  config: {
    getProviderDefaults: vi.fn(() => undefined),
  },
}));

// Mock providers module
const mockListProviders = vi.fn();
vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    listProviders: mockListProviders,
    resolveProvider: vi.fn(),
  },
}));

let query: typeof import("../../src/core/query.js");

beforeEach(async () => {
  vi.resetModules();
  mockListProviders.mockReset();
  query = await import("../../src/core/query.js");
});

describe("getProviderStatus", () => {
  it("should return lastChecked from the provider registry", () => {
    const checkedAt = 1700000000000;
    mockListProviders.mockReturnValue([
      { id: "anthropic", name: "Anthropic", available: true, lastChecked: checkedAt },
    ]);

    const result = query.getProviderStatus();
    expect(result).toHaveLength(1);
    expect(result[0].lastChecked).toBe(checkedAt);
    expect(result[0].id).toBe("anthropic");
    expect(result[0].available).toBe(true);
  });

  it("should return 0 for providers that have never been checked", () => {
    mockListProviders.mockReturnValue([
      { id: "openai", name: "OpenAI", available: false, lastChecked: 0 },
    ]);

    const result = query.getProviderStatus();
    expect(result[0].lastChecked).toBe(0);
  });

  it("should return multiple providers with their individual lastChecked", () => {
    mockListProviders.mockReturnValue([
      { id: "anthropic", name: "Anthropic", available: true, lastChecked: 1700000000000 },
      { id: "openai", name: "OpenAI", available: false, lastChecked: 1700000001000 },
    ]);

    const result = query.getProviderStatus();
    expect(result).toHaveLength(2);
    expect(result[0].lastChecked).toBe(1700000000000);
    expect(result[1].lastChecked).toBe(1700000001000);
  });

  it("should return empty array when no providers are registered", () => {
    mockListProviders.mockReturnValue([]);

    const result = query.getProviderStatus();
    expect(result).toEqual([]);
  });
});
