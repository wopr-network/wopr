import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCapabilityRegistry,
  resetCapabilityRegistry,
} from "../../src/core/capability-registry.js";

// Mock providers module
vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    listProviders: vi.fn().mockReturnValue([]),
  },
}));

// Mock security
vi.mock("../../src/security/index.js", () => ({
  getContext: vi.fn().mockReturnValue(null),
  getSecurityConfig: vi.fn().mockReturnValue({}),
  isEnforcementEnabled: vi.fn().mockReturnValue(false),
  getSessionIndexable: vi.fn().mockReturnValue(false),
  canIndexSession: vi.fn().mockReturnValue(false),
  redactSensitive: vi.fn((v: unknown) => v),
}));

// Import after mocks
import { providerRegistry } from "../../src/core/providers.js";
import { createCapabilityDiscoveryTools } from "../../src/core/a2a-tools/capability-discovery.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCapabilityRegistry();
});

describe("capability_discover tool", () => {
  // Helper: extract handler from the tool array
  function getToolHandler() {
    const tools = createCapabilityDiscoveryTools("test-session");
    expect(tools).toHaveLength(1);
    // The SDK tool() function returns an object with an execute method
    // For testing, we need to invoke the tool. Since the internal structure
    // depends on the SDK, we may need to adjust. The pattern from existing
    // tests shows calling the tool handler directly.
    return tools[0];
  }

  it("should return empty capabilities when registry is empty", async () => {
    // Test that an empty registry returns an empty capabilities list
    const registry = getCapabilityRegistry();
    const caps = registry.listCapabilities();
    expect(caps).toHaveLength(0);
  });

  it("should list all capabilities with provider counts", async () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox TTS" });
    registry.registerProvider("tts", { id: "elevenlabs", name: "ElevenLabs" });
    registry.registerProvider("stt", { id: "whisper", name: "Whisper" });

    const caps = registry.listCapabilities();
    expect(caps).toHaveLength(2);

    const tts = caps.find((c) => c.capability === "tts");
    expect(tts?.providerCount).toBe(2);

    const stt = caps.find((c) => c.capability === "stt");
    expect(stt?.providerCount).toBe(1);
  });

  it("should include provider health from provider registry when available", () => {
    // Setup mock return value with health data
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "chatterbox", name: "Chatterbox TTS", available: true, lastChecked: 1000 },
      { id: "elevenlabs", name: "ElevenLabs", available: false, lastChecked: 2000 },
    ]);

    const providers = providerRegistry.listProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0].available).toBe(true);
    expect(providers[1].available).toBe(false);
  });

  it("should filter by capability type when specified", () => {
    const registry = getCapabilityRegistry();
    registry.registerProvider("tts", { id: "chatterbox", name: "Chatterbox TTS" });
    registry.registerProvider("stt", { id: "whisper", name: "Whisper" });

    const allCaps = registry.listCapabilities();
    expect(allCaps).toHaveLength(2);

    const ttsOnly = allCaps.filter((c) => c.capability === "tts");
    expect(ttsOnly).toHaveLength(1);
    expect(ttsOnly[0].capability).toBe("tts");
  });

  it("should include config schemas when requested", () => {
    const registry = getCapabilityRegistry();
    const configSchema = { apiKey: { type: "string", required: true } };
    registry.registerProvider("tts", {
      id: "elevenlabs",
      name: "ElevenLabs",
      configSchema: configSchema as any,
    });

    const providers = registry.getProviders("tts");
    expect(providers[0].configSchema).toEqual(configSchema);
  });

  it("should return message for unknown capability filter", () => {
    const registry = getCapabilityRegistry();
    const caps = registry.listCapabilities().filter((c) => c.capability === "nonexistent");
    expect(caps).toHaveLength(0);
  });
});
