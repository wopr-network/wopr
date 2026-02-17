import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CapabilityRegistry,
  getCapabilityRegistry,
  resetCapabilityRegistry,
} from "../../src/core/capability-registry.js";

// Suppress console noise
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  resetCapabilityRegistry();
});

describe("CapabilityRegistry", () => {
  it("should register a provider for a capability", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", {
      id: "chatterbox",
      name: "Chatterbox TTS",
    });

    const providers = registry.getProviders("tts");
    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe("chatterbox");
    expect(providers[0]?.name).toBe("Chatterbox TTS");
    expect(registry.hasProvider("tts")).toBe(true);
  });

  it("should create capability entry if it doesn't exist", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("image-gen", {
      id: "dalle",
      name: "DALL-E",
    });

    const capabilities = registry.listCapabilities();
    const imageGen = capabilities.find((c) => c.capability === "image-gen");
    expect(imageGen).toBeDefined();
    expect(imageGen?.providerCount).toBe(1);
  });

  it("should allow multiple providers for same capability", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox TTS" });
    registry.registerProvider("tts", { id: "elevenlabs", name: "ElevenLabs" });

    const providers = registry.getProviders("tts");
    expect(providers).toHaveLength(2);
    expect(providers.map((p) => p.id)).toContain("chatterbox");
    expect(providers.map((p) => p.id)).toContain("elevenlabs");
  });

  it("should emit capability:providerRegistered event", () => {
    const registry = getCapabilityRegistry();
    const handler = vi.fn();
    registry.on("capability:providerRegistered", handler);

    registry.registerProvider("tts", {
      id: "chatterbox",
      name: "Chatterbox TTS",
    });

    expect(handler).toHaveBeenCalledWith({
      capability: "tts",
      providerId: "chatterbox",
      providerName: "Chatterbox TTS",
    });
  });

  it("should remove a provider with unregisterProvider", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox TTS" });
    registry.unregisterProvider("tts", "chatterbox");

    const providers = registry.getProviders("tts");
    expect(providers).toHaveLength(0);
    expect(registry.hasProvider("tts")).toBe(false);
  });

  it("should emit capability:providerUnregistered event", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox TTS" });

    const handler = vi.fn();
    registry.on("capability:providerUnregistered", handler);

    registry.unregisterProvider("tts", "chatterbox");

    expect(handler).toHaveBeenCalledWith({
      capability: "tts",
      providerId: "chatterbox",
    });
  });

  it("should be a no-op for unregisterProvider on unknown capability", () => {
    const registry = getCapabilityRegistry();
    expect(() => {
      registry.unregisterProvider("nonexistent", "foo");
    }).not.toThrow();
  });

  it("should return specific provider by capability + id with getProvider", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox TTS" });
    registry.registerProvider("tts", { id: "elevenlabs", name: "ElevenLabs" });

    const provider = registry.getProvider("tts", "chatterbox");
    expect(provider).toBeDefined();
    expect(provider?.id).toBe("chatterbox");

    const missing = registry.getProvider("tts", "nonexistent");
    expect(missing).toBeUndefined();
  });

  it("should return all providers with getProvidersForCapability (convenience alias)", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox TTS" });
    registry.registerProvider("tts", { id: "elevenlabs", name: "ElevenLabs" });

    const providers = registry.getProvidersForCapability("tts");
    expect(providers).toHaveLength(2);
    expect(providers.map((p) => p.id)).toContain("chatterbox");
    expect(providers.map((p) => p.id)).toContain("elevenlabs");
  });

  it("should report satisfied when providers exist in checkRequirements", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox TTS" });

    const result = registry.checkRequirements([{ capability: "tts" }]);
    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.optional).toHaveLength(0);
  });

  it("should report missing when no provider in checkRequirements", () => {
    const registry = getCapabilityRegistry();
    const result = registry.checkRequirements([{ capability: "tts" }]);
    expect(result.satisfied).toBe(false);
    expect(result.missing).toContain("tts");
    expect(result.optional).toHaveLength(0);
  });

  it("should handle optional capabilities in checkRequirements", () => {
    const registry = getCapabilityRegistry();
    const result = registry.checkRequirements([{ capability: "tts", optional: true }]);
    expect(result.satisfied).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.optional).toContain("tts");
  });

  it("should return same instance for getCapabilityRegistry (singleton)", () => {
    const first = getCapabilityRegistry();
    const second = getCapabilityRegistry();
    expect(first).toBe(second);
  });

  it("should return fresh instance after resetCapabilityRegistry", () => {
    const first = getCapabilityRegistry();
    resetCapabilityRegistry();
    const second = getCapabilityRegistry();
    expect(first).not.toBe(second);
  });
});
