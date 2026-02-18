import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger to avoid winston dependency in tests
vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resetCapabilityHealthProber } from "../../src/core/capability-health.js";
import { getCapabilityRegistry, resetCapabilityRegistry } from "../../src/core/capability-registry.js";
import { resolveAllProviders, resolveCapability } from "../../src/core/capability-resolver.js";

// Suppress console noise
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCapabilityRegistry();
  resetCapabilityHealthProber();
});

describe("resolveCapability", () => {
  it("returns null when no providers are registered", () => {
    const result = resolveCapability("tts");
    expect(result).toBeNull();
  });

  it("returns the first provider when one is registered", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox" });

    const result = resolveCapability("tts");
    expect(result).not.toBeNull();
    expect(result!.provider.id).toBe("chatterbox");
    expect(result!.capability).toBe("tts");
    expect(result!.healthy).toBe(true); // optimistic default
  });

  it("returns the preferred provider when specified and available", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox" });
    registry.registerProvider("tts", { id: "elevenlabs", name: "ElevenLabs" });

    const result = resolveCapability("tts", { preferredProvider: "elevenlabs" });
    expect(result!.provider.id).toBe("elevenlabs");
  });

  it("falls back when preferred provider is not registered", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox" });

    const result = resolveCapability("tts", { preferredProvider: "nonexistent" });
    expect(result!.provider.id).toBe("chatterbox");
  });

  it("returns provider even if no health state with healthyOnly=false", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox" });

    const result = resolveCapability("tts", { healthyOnly: false });
    expect(result).not.toBeNull();
    expect(result!.provider.id).toBe("chatterbox");
  });

  it("returns null for unknown capability type", () => {
    const result = resolveCapability("video-gen");
    expect(result).toBeNull();
  });

  it("returns provider from correct capability type", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("image-gen", { id: "dall-e", name: "DALL-E" });

    const ttsResult = resolveCapability("tts");
    const imageResult = resolveCapability("image-gen");

    expect(ttsResult).toBeNull();
    expect(imageResult!.provider.id).toBe("dall-e");
  });
});

describe("resolveAllProviders", () => {
  it("returns empty array when no providers exist", () => {
    const result = resolveAllProviders("tts");
    expect(result).toEqual([]);
  });

  it("returns all providers when multiple are registered", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "a", name: "A" });
    registry.registerProvider("tts", { id: "b", name: "B" });

    const result = resolveAllProviders("tts");
    expect(result).toHaveLength(2);
    // Both healthy (optimistic default), order preserved
    expect(result[0]!.provider.id).toBe("a");
    expect(result[1]!.provider.id).toBe("b");
  });

  it("includes capability and healthy fields for each provider", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("embeddings", { id: "openai", name: "OpenAI" });

    const result = resolveAllProviders("embeddings");
    expect(result).toHaveLength(1);
    expect(result[0]!.capability).toBe("embeddings");
    expect(result[0]!.provider.id).toBe("openai");
    expect(result[0]!.healthy).toBe(true);
  });

  it("returns empty array for capability with no registered providers", () => {
    // Register for a different capability
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox" });

    const result = resolveAllProviders("image-gen");
    expect(result).toEqual([]);
  });
});
