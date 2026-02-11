/**
 * Voice Registry & Provider Contract Tests (WOP-29)
 *
 * Tests WOPRVoiceRegistry, STT/TTS provider contracts,
 * VoicePluginMetadata validation, and edge cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WOPRVoiceRegistry } from "../../src/voice/registry.js";
import type {
  STTProvider,
  STTSession,
  TTSProvider,
  TTSSynthesisResult,
  VoicePluginMetadata,
} from "../../src/voice/types.js";

// =============================================================================
// Mock Helpers
// =============================================================================

function createSTTMetadata(overrides: Partial<VoicePluginMetadata> = {}): VoicePluginMetadata {
  return {
    name: "mock-stt",
    version: "1.0.0",
    type: "stt",
    description: "Mock STT provider",
    capabilities: ["batch", "streaming"],
    local: true,
    ...overrides,
  };
}

function createTTSMetadata(overrides: Partial<VoicePluginMetadata> = {}): VoicePluginMetadata {
  return {
    name: "mock-tts",
    version: "1.0.0",
    type: "tts",
    description: "Mock TTS provider",
    capabilities: ["batch", "voice-selection"],
    local: true,
    ...overrides,
  };
}

function createMockSTTSession(transcript = "hello world"): STTSession {
  let closed = false;
  const partialCallbacks: Array<(chunk: any) => void> = [];

  return {
    sendAudio: vi.fn(),
    endAudio: vi.fn(() => {
      // Notify partial listeners with a final chunk
      for (const cb of partialCallbacks) {
        cb({ text: transcript, isFinal: true, confidence: 0.95 });
      }
    }),
    onPartial: vi.fn((callback) => {
      partialCallbacks.push(callback);
    }),
    waitForTranscript: vi.fn(async () => {
      if (closed) throw new Error("Session is closed");
      return transcript;
    }),
    close: vi.fn(async () => {
      closed = true;
    }),
  };
}

function createMockSTTProvider(overrides: Partial<STTProvider> = {}): STTProvider {
  const metadata = createSTTMetadata(overrides.metadata ? overrides.metadata : undefined);
  return {
    metadata,
    validateConfig: vi.fn(),
    createSession: vi.fn(async () => createMockSTTSession()),
    transcribe: vi.fn(async () => "hello world"),
    healthCheck: vi.fn(async () => true),
    shutdown: vi.fn(async () => {}),
    ...overrides,
  };
}

function createMockTTSProvider(overrides: Partial<TTSProvider> = {}): TTSProvider {
  const metadata = createTTSMetadata(overrides.metadata ? overrides.metadata : undefined);
  const result: TTSSynthesisResult = {
    audio: Buffer.from("fake-audio-data"),
    format: "pcm_s16le",
    sampleRate: 24000,
    durationMs: 1500,
  };
  return {
    metadata,
    voices: [
      { id: "default", name: "Default Voice", language: "en-US", gender: "neutral" },
      { id: "alloy", name: "Alloy", language: "en-US", gender: "female" },
    ],
    validateConfig: vi.fn(),
    synthesize: vi.fn(async () => result),
    healthCheck: vi.fn(async () => true),
    shutdown: vi.fn(async () => {}),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("WOPRVoiceRegistry", () => {
  let registry: WOPRVoiceRegistry;

  beforeEach(() => {
    registry = new WOPRVoiceRegistry();
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  // ==========================================================================
  // STT Registration
  // ==========================================================================
  describe("registerSTT", () => {
    it("should register an STT provider", () => {
      const provider = createMockSTTProvider();
      registry.registerSTT(provider);

      expect(registry.listSTT()).toHaveLength(1);
      expect(registry.listSTT()[0]).toBe(provider);
    });

    it("should call validateConfig on registration", () => {
      const provider = createMockSTTProvider();
      registry.registerSTT(provider);

      expect(provider.validateConfig).toHaveBeenCalledOnce();
    });

    it("should set first registered STT as active by default", () => {
      const provider = createMockSTTProvider();
      registry.registerSTT(provider);

      expect(registry.getSTT()).toBe(provider);
    });

    it("should not change active STT when registering a second provider", () => {
      const first = createMockSTTProvider();
      const second = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "second-stt" }),
      });

      registry.registerSTT(first);
      registry.registerSTT(second);

      expect(registry.getSTT()).toBe(first);
    });

    it("should emit stt:registered event", () => {
      const handler = vi.fn();
      registry.on("stt:registered", handler);

      const provider = createMockSTTProvider();
      registry.registerSTT(provider);

      expect(handler).toHaveBeenCalledWith({ name: "mock-stt", provider });
    });

    it("should throw if validateConfig throws", () => {
      const provider = createMockSTTProvider({
        validateConfig: vi.fn(() => {
          throw new Error("Missing API key");
        }),
      });

      expect(() => registry.registerSTT(provider)).toThrow("Missing API key");
      expect(registry.listSTT()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // TTS Registration
  // ==========================================================================
  describe("registerTTS", () => {
    it("should register a TTS provider", () => {
      const provider = createMockTTSProvider();
      registry.registerTTS(provider);

      expect(registry.listTTS()).toHaveLength(1);
      expect(registry.listTTS()[0]).toBe(provider);
    });

    it("should call validateConfig on registration", () => {
      const provider = createMockTTSProvider();
      registry.registerTTS(provider);

      expect(provider.validateConfig).toHaveBeenCalledOnce();
    });

    it("should set first registered TTS as active by default", () => {
      const provider = createMockTTSProvider();
      registry.registerTTS(provider);

      expect(registry.getTTS()).toBe(provider);
    });

    it("should not change active TTS when registering a second provider", () => {
      const first = createMockTTSProvider();
      const second = createMockTTSProvider({
        metadata: createTTSMetadata({ name: "second-tts" }),
      });

      registry.registerTTS(first);
      registry.registerTTS(second);

      expect(registry.getTTS()).toBe(first);
    });

    it("should emit tts:registered event", () => {
      const handler = vi.fn();
      registry.on("tts:registered", handler);

      const provider = createMockTTSProvider();
      registry.registerTTS(provider);

      expect(handler).toHaveBeenCalledWith({ name: "mock-tts", provider });
    });
  });

  // ==========================================================================
  // getSTT / getTTS
  // ==========================================================================
  describe("getSTT / getTTS", () => {
    it("should return null when no STT providers are registered", () => {
      expect(registry.getSTT()).toBeNull();
    });

    it("should return null when no TTS providers are registered", () => {
      expect(registry.getTTS()).toBeNull();
    });

    it("should return the active STT provider", () => {
      const provider = createMockSTTProvider();
      registry.registerSTT(provider);

      expect(registry.getSTT()).toBe(provider);
    });

    it("should return the active TTS provider", () => {
      const provider = createMockTTSProvider();
      registry.registerTTS(provider);

      expect(registry.getTTS()).toBe(provider);
    });
  });

  // ==========================================================================
  // setActiveSTT / setActiveTTS
  // ==========================================================================
  describe("setActiveSTT / setActiveTTS", () => {
    it("should switch active STT provider", () => {
      const first = createMockSTTProvider();
      const second = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "second-stt" }),
      });

      registry.registerSTT(first);
      registry.registerSTT(second);

      expect(registry.getSTT()).toBe(first);

      const result = registry.setActiveSTT("second-stt");
      expect(result).toBe(true);
      expect(registry.getSTT()).toBe(second);
    });

    it("should switch active TTS provider", () => {
      const first = createMockTTSProvider();
      const second = createMockTTSProvider({
        metadata: createTTSMetadata({ name: "second-tts" }),
      });

      registry.registerTTS(first);
      registry.registerTTS(second);

      const result = registry.setActiveTTS("second-tts");
      expect(result).toBe(true);
      expect(registry.getTTS()).toBe(second);
    });

    it("should return false when setting active to non-existent STT provider", () => {
      expect(registry.setActiveSTT("nonexistent")).toBe(false);
    });

    it("should return false when setting active to non-existent TTS provider", () => {
      expect(registry.setActiveTTS("nonexistent")).toBe(false);
    });

    it("should emit stt:activated event", () => {
      const handler = vi.fn();
      registry.on("stt:activated", handler);

      const provider = createMockSTTProvider();
      registry.registerSTT(provider);
      registry.setActiveSTT("mock-stt");

      expect(handler).toHaveBeenCalledWith({ name: "mock-stt" });
    });

    it("should emit tts:activated event", () => {
      const handler = vi.fn();
      registry.on("tts:activated", handler);

      const provider = createMockTTSProvider();
      registry.registerTTS(provider);
      registry.setActiveTTS("mock-tts");

      expect(handler).toHaveBeenCalledWith({ name: "mock-tts" });
    });
  });

  // ==========================================================================
  // listSTT / listTTS
  // ==========================================================================
  describe("listSTT / listTTS", () => {
    it("should return empty array when no providers registered", () => {
      expect(registry.listSTT()).toEqual([]);
      expect(registry.listTTS()).toEqual([]);
    });

    it("should return all registered STT providers", () => {
      const first = createMockSTTProvider();
      const second = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "second-stt" }),
      });

      registry.registerSTT(first);
      registry.registerSTT(second);

      expect(registry.listSTT()).toHaveLength(2);
      expect(registry.listSTT()).toContain(first);
      expect(registry.listSTT()).toContain(second);
    });

    it("should return all registered TTS providers", () => {
      const first = createMockTTSProvider();
      const second = createMockTTSProvider({
        metadata: createTTSMetadata({ name: "second-tts" }),
      });

      registry.registerTTS(first);
      registry.registerTTS(second);

      expect(registry.listTTS()).toHaveLength(2);
    });
  });

  // ==========================================================================
  // getSTTByName / getTTSByName
  // ==========================================================================
  describe("getSTTByName / getTTSByName", () => {
    it("should retrieve STT provider by name", () => {
      const provider = createMockSTTProvider();
      registry.registerSTT(provider);

      expect(registry.getSTTByName("mock-stt")).toBe(provider);
    });

    it("should retrieve TTS provider by name", () => {
      const provider = createMockTTSProvider();
      registry.registerTTS(provider);

      expect(registry.getTTSByName("mock-tts")).toBe(provider);
    });

    it("should return null for unknown STT provider name", () => {
      expect(registry.getSTTByName("unknown")).toBeNull();
    });

    it("should return null for unknown TTS provider name", () => {
      expect(registry.getTTSByName("unknown")).toBeNull();
    });
  });

  // ==========================================================================
  // findByCapability
  // ==========================================================================
  describe("findSTTByCapability / findTTSByCapability", () => {
    it("should find STT providers with matching capability", () => {
      const batchOnly = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "batch-stt", capabilities: ["batch"] }),
      });
      const streamOnly = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "stream-stt", capabilities: ["streaming"] }),
      });

      registry.registerSTT(batchOnly);
      registry.registerSTT(streamOnly);

      const streamProviders = registry.findSTTByCapability("streaming");
      expect(streamProviders).toHaveLength(1);
      expect(streamProviders[0].metadata.name).toBe("stream-stt");
    });

    it("should find TTS providers with matching capability", () => {
      const basic = createMockTTSProvider({
        metadata: createTTSMetadata({ name: "basic-tts", capabilities: ["batch"] }),
      });
      const fancy = createMockTTSProvider({
        metadata: createTTSMetadata({ name: "fancy-tts", capabilities: ["batch", "voice-selection", "ssml"] }),
      });

      registry.registerTTS(basic);
      registry.registerTTS(fancy);

      const ssmlProviders = registry.findTTSByCapability("ssml");
      expect(ssmlProviders).toHaveLength(1);
      expect(ssmlProviders[0].metadata.name).toBe("fancy-tts");
    });

    it("should return empty array when no providers match capability", () => {
      const provider = createMockSTTProvider();
      registry.registerSTT(provider);

      expect(registry.findSTTByCapability("nonexistent")).toEqual([]);
    });
  });

  // ==========================================================================
  // getLocalSTT / getLocalTTS
  // ==========================================================================
  describe("getLocalSTT / getLocalTTS", () => {
    it("should return only local STT providers", () => {
      const local = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "local-stt", local: true }),
      });
      const cloud = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "cloud-stt", local: false }),
      });

      registry.registerSTT(local);
      registry.registerSTT(cloud);

      const localProviders = registry.getLocalSTT();
      expect(localProviders).toHaveLength(1);
      expect(localProviders[0].metadata.name).toBe("local-stt");
    });

    it("should return only local TTS providers", () => {
      const local = createMockTTSProvider({
        metadata: createTTSMetadata({ name: "local-tts", local: true }),
      });
      const cloud = createMockTTSProvider({
        metadata: createTTSMetadata({ name: "cloud-tts", local: false }),
      });

      registry.registerTTS(local);
      registry.registerTTS(cloud);

      const localProviders = registry.getLocalTTS();
      expect(localProviders).toHaveLength(1);
      expect(localProviders[0].metadata.name).toBe("local-tts");
    });
  });

  // ==========================================================================
  // healthCheckAll
  // ==========================================================================
  describe("healthCheckAll", () => {
    it("should return health status for all providers", async () => {
      const localSTT = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "local-stt", local: true }),
      });
      const cloudSTT = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "cloud-stt", local: false }),
        healthCheck: vi.fn(async () => true),
      });
      const cloudTTS = createMockTTSProvider({
        metadata: createTTSMetadata({ name: "cloud-tts", local: false }),
        healthCheck: vi.fn(async () => false),
      });

      registry.registerSTT(localSTT);
      registry.registerSTT(cloudSTT);
      registry.registerTTS(cloudTTS);

      const results = await registry.healthCheckAll();

      // Local providers assumed healthy
      expect(results.stt["local-stt"]).toBe(true);
      // Cloud providers call healthCheck
      expect(results.stt["cloud-stt"]).toBe(true);
      expect(results.tts["cloud-tts"]).toBe(false);
    });

    it("should catch healthCheck exceptions and return false", async () => {
      const failingProvider = createMockSTTProvider({
        metadata: createSTTMetadata({ name: "failing-stt", local: false }),
        healthCheck: vi.fn(async () => {
          throw new Error("Network error");
        }),
      });

      registry.registerSTT(failingProvider);

      const results = await registry.healthCheckAll();
      expect(results.stt["failing-stt"]).toBe(false);
    });

    it("should return empty results when no providers registered", async () => {
      const results = await registry.healthCheckAll();
      expect(results).toEqual({ stt: {}, tts: {} });
    });
  });

  // ==========================================================================
  // shutdown
  // ==========================================================================
  describe("shutdown", () => {
    it("should call shutdown on all providers", async () => {
      const stt = createMockSTTProvider();
      const tts = createMockTTSProvider();

      registry.registerSTT(stt);
      registry.registerTTS(tts);

      await registry.shutdown();

      expect(stt.shutdown).toHaveBeenCalledOnce();
      expect(tts.shutdown).toHaveBeenCalledOnce();
    });

    it("should clear all providers after shutdown", async () => {
      registry.registerSTT(createMockSTTProvider());
      registry.registerTTS(createMockTTSProvider());

      await registry.shutdown();

      expect(registry.listSTT()).toEqual([]);
      expect(registry.listTTS()).toEqual([]);
      expect(registry.getSTT()).toBeNull();
      expect(registry.getTTS()).toBeNull();
    });

    it("should handle providers without shutdown method", async () => {
      const provider = createMockSTTProvider();
      // Remove optional shutdown
      delete (provider as any).shutdown;

      registry.registerSTT(provider);

      // Should not throw
      await registry.shutdown();
      expect(registry.listSTT()).toEqual([]);
    });
  });

  // ==========================================================================
  // Edge cases: duplicate registration
  // ==========================================================================
  describe("duplicate provider registration", () => {
    it("should overwrite STT provider with same name", () => {
      const first = createMockSTTProvider();
      const second = createMockSTTProvider({
        metadata: createSTTMetadata({ description: "Updated mock STT" }),
      });

      registry.registerSTT(first);
      registry.registerSTT(second);

      // Same name → Map overwrites, only 1 entry
      expect(registry.listSTT()).toHaveLength(1);
      expect(registry.listSTT()[0].metadata.description).toBe("Updated mock STT");
    });

    it("should overwrite TTS provider with same name", () => {
      const first = createMockTTSProvider();
      const second = createMockTTSProvider({
        metadata: createTTSMetadata({ description: "Updated mock TTS" }),
      });

      registry.registerTTS(first);
      registry.registerTTS(second);

      expect(registry.listTTS()).toHaveLength(1);
      expect(registry.listTTS()[0].metadata.description).toBe("Updated mock TTS");
    });

    it("should keep active STT pointing to correct provider after overwrite", () => {
      const first = createMockSTTProvider();
      const second = createMockSTTProvider({
        metadata: createSTTMetadata({ description: "v2" }),
      });

      registry.registerSTT(first);
      expect(registry.getSTT()).toBe(first);

      registry.registerSTT(second);
      // Active name is still "mock-stt", which now points to second
      expect(registry.getSTT()).toBe(second);
    });
  });

  // ==========================================================================
  // Edge cases: missing provider graceful failure
  // ==========================================================================
  describe("missing provider graceful failure", () => {
    it("should return null from getSTT when active provider name does not exist", () => {
      // No providers registered at all
      expect(registry.getSTT()).toBeNull();
    });

    it("should return null from getTTS when active provider name does not exist", () => {
      expect(registry.getTTS()).toBeNull();
    });

    it("should return false when setting active to unregistered STT provider", () => {
      const result = registry.setActiveSTT("does-not-exist");
      expect(result).toBe(false);
      expect(registry.getSTT()).toBeNull();
    });

    it("should return false when setting active to unregistered TTS provider", () => {
      const result = registry.setActiveTTS("does-not-exist");
      expect(result).toBe(false);
      expect(registry.getTTS()).toBeNull();
    });
  });
});

// =============================================================================
// STTProvider Contract Tests
// =============================================================================

describe("STTProvider contract", () => {
  it("should transcribe an audio buffer to text", async () => {
    const provider = createMockSTTProvider({
      transcribe: vi.fn(async () => "recognized speech"),
    });

    const audio = Buffer.from("fake-audio-pcm-data");
    const result = await provider.transcribe(audio, { language: "en" });

    expect(result).toBe("recognized speech");
    expect(provider.transcribe).toHaveBeenCalledWith(audio, { language: "en" });
  });

  it("should create a streaming session", async () => {
    const session = createMockSTTSession("streaming result");
    const provider = createMockSTTProvider({
      createSession: vi.fn(async () => session),
    });

    const sttSession = await provider.createSession({ language: "en", vadEnabled: true });

    expect(sttSession).toBe(session);
    expect(provider.createSession).toHaveBeenCalledWith({ language: "en", vadEnabled: true });
  });

  describe("STTSession lifecycle", () => {
    it("should send audio, end, and wait for transcript", async () => {
      const session = createMockSTTSession("hello from stream");

      const chunk1 = Buffer.from("audio-chunk-1");
      const chunk2 = Buffer.from("audio-chunk-2");

      session.sendAudio(chunk1);
      session.sendAudio(chunk2);
      session.endAudio();

      const transcript = await session.waitForTranscript(5000);

      expect(session.sendAudio).toHaveBeenCalledTimes(2);
      expect(session.sendAudio).toHaveBeenCalledWith(chunk1);
      expect(session.sendAudio).toHaveBeenCalledWith(chunk2);
      expect(session.endAudio).toHaveBeenCalledOnce();
      expect(transcript).toBe("hello from stream");
    });

    it("should support onPartial callback for interim results", () => {
      const session = createMockSTTSession("final result");
      const partialHandler = vi.fn();

      session.onPartial!(partialHandler);
      session.endAudio();

      expect(partialHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "final result",
          isFinal: true,
          confidence: 0.95,
        }),
      );
    });

    it("should close session and clean up", async () => {
      const session = createMockSTTSession();

      await session.close();

      expect(session.close).toHaveBeenCalledOnce();
    });

    it("should error after session is closed", async () => {
      const session = createMockSTTSession();

      await session.close();

      await expect(session.waitForTranscript()).rejects.toThrow("Session is closed");
    });
  });
});

// =============================================================================
// TTSProvider Contract Tests
// =============================================================================

describe("TTSProvider contract", () => {
  it("should synthesize text to audio", async () => {
    const expectedAudio = Buffer.from("synthesized-audio");
    const provider = createMockTTSProvider({
      synthesize: vi.fn(async () => ({
        audio: expectedAudio,
        format: "pcm_s16le" as const,
        sampleRate: 24000,
        durationMs: 2000,
      })),
    });

    const result = await provider.synthesize("Hello world", { voice: "alloy", speed: 1.0 });

    expect(result.audio).toBe(expectedAudio);
    expect(result.format).toBe("pcm_s16le");
    expect(result.sampleRate).toBe(24000);
    expect(result.durationMs).toBe(2000);
    expect(provider.synthesize).toHaveBeenCalledWith("Hello world", { voice: "alloy", speed: 1.0 });
  });

  it("should expose available voices", () => {
    const provider = createMockTTSProvider();

    expect(provider.voices).toHaveLength(2);
    expect(provider.voices[0]).toEqual(
      expect.objectContaining({ id: "default", name: "Default Voice" }),
    );
    expect(provider.voices[1]).toEqual(
      expect.objectContaining({ id: "alloy", name: "Alloy" }),
    );
  });

  it("should synthesize with default options when none provided", async () => {
    const provider = createMockTTSProvider();

    const result = await provider.synthesize("test");

    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.format).toBeDefined();
    expect(result.sampleRate).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// VoicePluginMetadata Tests
// =============================================================================

describe("VoicePluginMetadata", () => {
  it("should have all required fields for STT metadata", () => {
    const metadata = createSTTMetadata();

    expect(metadata.name).toBe("mock-stt");
    expect(metadata.version).toBe("1.0.0");
    expect(metadata.type).toBe("stt");
    expect(metadata.description).toBe("Mock STT provider");
    expect(metadata.capabilities).toEqual(["batch", "streaming"]);
    expect(metadata.local).toBe(true);
  });

  it("should have all required fields for TTS metadata", () => {
    const metadata = createTTSMetadata();

    expect(metadata.name).toBe("mock-tts");
    expect(metadata.version).toBe("1.0.0");
    expect(metadata.type).toBe("tts");
    expect(metadata.description).toBe("Mock TTS provider");
    expect(metadata.capabilities).toEqual(["batch", "voice-selection"]);
    expect(metadata.local).toBe(true);
  });

  it("should support optional fields", () => {
    const metadata = createSTTMetadata({
      docker: true,
      primaryEnv: "WHISPER_API_KEY",
      emoji: "🎤",
      homepage: "https://example.com",
      requires: {
        bins: ["whisper"],
        env: ["WHISPER_API_KEY"],
        docker: ["ghcr.io/wopr/whisper:latest"],
        config: ["voice.whisper.model"],
      },
      install: [
        { kind: "docker", image: "ghcr.io/wopr/whisper", tag: "latest" },
        { kind: "pip", package: "faster-whisper" },
      ],
    });

    expect(metadata.docker).toBe(true);
    expect(metadata.primaryEnv).toBe("WHISPER_API_KEY");
    expect(metadata.requires?.bins).toContain("whisper");
    expect(metadata.requires?.env).toContain("WHISPER_API_KEY");
    expect(metadata.install).toHaveLength(2);
    expect(metadata.install![0]).toEqual(
      expect.objectContaining({ kind: "docker", image: "ghcr.io/wopr/whisper" }),
    );
  });

  it("should support empty capabilities array", () => {
    const metadata = createSTTMetadata({ capabilities: [] });
    expect(metadata.capabilities).toEqual([]);
  });
});

// =============================================================================
// Singleton helpers (getVoiceRegistry / resetVoiceRegistry)
// =============================================================================

describe("getVoiceRegistry / resetVoiceRegistry", () => {
  // Use dynamic imports to isolate the singleton state per test
  beforeEach(() => {
    vi.resetModules();
  });

  it("should return the same instance on repeated calls", async () => {
    const mod = await import("../../src/voice/registry.js");
    const a = mod.getVoiceRegistry();
    const b = mod.getVoiceRegistry();
    expect(a).toBe(b);
  });

  it("should return a fresh instance after reset", async () => {
    const mod = await import("../../src/voice/registry.js");
    const first = mod.getVoiceRegistry();
    mod.resetVoiceRegistry();
    const second = mod.getVoiceRegistry();
    expect(first).not.toBe(second);
  });
});
