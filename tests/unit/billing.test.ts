/**
 * Tests for generic capability billing system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { withMargin } from "../../src/core/billing.js";
import { eventBus } from "../../src/core/events.js";
import { config } from "../../src/core/config.js";

describe("withMargin", () => {
  // Store original config.get to restore later
  const originalGet = config.get.bind(config);
  let emittedEvents: Array<{ event: string; payload: unknown }> = [];

  beforeEach(() => {
    // Mock event emission to capture meter events
    emittedEvents = [];
    vi.spyOn(eventBus, "emit").mockImplementation(async (event: string, payload: unknown) => {
      emittedEvents.push({ event, payload });
    });
  });

  afterEach(() => {
    // Restore config.get
    config.get = originalGet;
    vi.restoreAllMocks();
  });

  it("applies default multiplier (1.3) to hosted provider cost", async () => {
    const response = { result: "audio-buffer", cost: 0.0043 };
    const ctx = {
      tenant: "org_123",
      capability: "stt",
      provider: "deepgram",
      source: "hosted" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toBe("audio-buffer");
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].event).toBe("meter:usage");

    const payload = emittedEvents[0].payload as {
      tenant: string;
      capability: string;
      provider: string;
      cost: number;
      timestamp: number;
      metadata: { upstreamCost: number; multiplier: number };
    };

    expect(payload.tenant).toBe("org_123");
    expect(payload.capability).toBe("stt");
    expect(payload.provider).toBe("deepgram");
    expect(payload.cost).toBeCloseTo(0.0043 * 1.3, 5); // charge = cost * 1.3
    expect(payload.metadata.upstreamCost).toBe(0.0043);
    expect(payload.metadata.multiplier).toBe(1.3);
    expect(payload.timestamp).toBeGreaterThan(0);
  });

  it("skips metering for BYOK providers", async () => {
    const response = { result: "audio-buffer", cost: 0.0043 };
    const ctx = {
      tenant: "org_123",
      capability: "stt",
      provider: "whisper-local",
      source: "byok" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toBe("audio-buffer");
    expect(emittedEvents).toHaveLength(0); // No meter event
  });

  it("skips metering when cost is 0", async () => {
    const response = { result: "audio-buffer", cost: 0 };
    const ctx = {
      tenant: "org_123",
      capability: "stt",
      provider: "local-whisper",
      source: "hosted" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toBe("audio-buffer");
    expect(emittedEvents).toHaveLength(0);
  });

  it("skips metering when cost is undefined", async () => {
    const response = { result: "audio-buffer" };
    const ctx = {
      tenant: "org_123",
      capability: "stt",
      provider: "local-whisper",
      source: "hosted" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toBe("audio-buffer");
    expect(emittedEvents).toHaveLength(0);
  });

  it("uses configured multiplier from config", async () => {
    // Mock config.get to return custom multiplier
    config.get = vi.fn(() => ({
      billing: { multiplier: 2.0 },
    })) as any;

    const response = { result: "generated-text", cost: 1.0 };
    const ctx = {
      tenant: "org_456",
      capability: "text-gen",
      provider: "anthropic",
      source: "hosted" as const,
    };

    await withMargin(response, ctx);

    expect(emittedEvents).toHaveLength(1);
    const payload = emittedEvents[0].payload as { cost: number; metadata: { multiplier: number } };
    expect(payload.cost).toBe(2.0); // 1.0 * 2.0
    expect(payload.metadata.multiplier).toBe(2.0);
  });

  it("falls back to default multiplier when not configured", async () => {
    // Mock config.get to return empty config
    config.get = vi.fn(() => ({})) as any;

    const response = { result: "generated-text", cost: 1.0 };
    const ctx = {
      tenant: "org_456",
      capability: "text-gen",
      provider: "anthropic",
      source: "hosted" as const,
    };

    await withMargin(response, ctx);

    expect(emittedEvents).toHaveLength(1);
    const payload = emittedEvents[0].payload as { cost: number; metadata: { multiplier: number } };
    expect(payload.cost).toBe(1.3); // 1.0 * 1.3 (default)
    expect(payload.metadata.multiplier).toBe(1.3);
  });

  it("falls back to default when configured multiplier is invalid", async () => {
    // Mock config.get to return invalid values
    config.get = vi.fn(() => ({
      billing: { multiplier: "invalid" },
    })) as any;

    const response = { result: "generated-text", cost: 1.0 };
    const ctx = {
      tenant: "org_456",
      capability: "text-gen",
      provider: "anthropic",
      source: "hosted" as const,
    };

    await withMargin(response, ctx);

    expect(emittedEvents).toHaveLength(1);
    const payload = emittedEvents[0].payload as { metadata: { multiplier: number } };
    expect(payload.metadata.multiplier).toBe(1.3); // Falls back to default
  });

  it("works for TTS capability", async () => {
    const response = { result: "audio-bytes", cost: 0.0025 };
    const ctx = {
      tenant: "user_789",
      capability: "tts",
      provider: "elevenlabs",
      source: "hosted" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toBe("audio-bytes");
    expect(emittedEvents).toHaveLength(1);

    const payload = emittedEvents[0].payload as { capability: string; cost: number };
    expect(payload.capability).toBe("tts");
    expect(payload.cost).toBeCloseTo(0.0025 * 1.3, 5);
  });

  it("works for STT capability", async () => {
    const response = { result: "transcribed text", cost: 0.0043 };
    const ctx = {
      tenant: "user_789",
      capability: "stt",
      provider: "deepgram",
      source: "hosted" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toBe("transcribed text");
    expect(emittedEvents).toHaveLength(1);

    const payload = emittedEvents[0].payload as { capability: string; cost: number };
    expect(payload.capability).toBe("stt");
    expect(payload.cost).toBeCloseTo(0.0043 * 1.3, 5);
  });

  it("works for text-gen capability", async () => {
    const response = { result: "generated response", cost: 0.15 };
    const ctx = {
      tenant: "user_789",
      capability: "text-gen",
      provider: "anthropic",
      source: "hosted" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toBe("generated response");
    expect(emittedEvents).toHaveLength(1);

    const payload = emittedEvents[0].payload as { capability: string; cost: number };
    expect(payload.capability).toBe("text-gen");
    expect(payload.cost).toBeCloseTo(0.15 * 1.3, 5);
  });

  it("works for image-gen capability", async () => {
    const response = { result: "image-url", cost: 0.04 };
    const ctx = {
      tenant: "user_789",
      capability: "image-gen",
      provider: "replicate",
      source: "hosted" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toBe("image-url");
    expect(emittedEvents).toHaveLength(1);

    const payload = emittedEvents[0].payload as { capability: string; cost: number };
    expect(payload.capability).toBe("image-gen");
    expect(payload.cost).toBeCloseTo(0.04 * 1.3, 5);
  });

  it("works for embeddings capability", async () => {
    const response = { result: [0.1, 0.2, 0.3], cost: 0.0001 };
    const ctx = {
      tenant: "user_789",
      capability: "embeddings",
      provider: "openai",
      source: "hosted" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(emittedEvents).toHaveLength(1);

    const payload = emittedEvents[0].payload as { capability: string; cost: number };
    expect(payload.capability).toBe("embeddings");
    expect(payload.cost).toBeCloseTo(0.0001 * 1.3, 5);
  });

  it("works for any arbitrary capability string", async () => {
    const response = { result: "hologram-data", cost: 5.0 };
    const ctx = {
      tenant: "user_future",
      capability: "hologram-gen", // Future capability
      provider: "future-tech",
      source: "hosted" as const,
    };

    const result = await withMargin(response, ctx);

    expect(result).toBe("hologram-data");
    expect(emittedEvents).toHaveLength(1);

    const payload = emittedEvents[0].payload as { capability: string; cost: number };
    expect(payload.capability).toBe("hologram-gen");
    expect(payload.cost).toBeCloseTo(5.0 * 1.3, 5);
  });

  it("includes upstream cost in metadata", async () => {
    const response = { result: "result", cost: 0.5 };
    const ctx = {
      tenant: "org_123",
      capability: "text-gen",
      provider: "anthropic",
      source: "hosted" as const,
    };

    await withMargin(response, ctx);

    expect(emittedEvents).toHaveLength(1);
    const payload = emittedEvents[0].payload as {
      cost: number;
      metadata: { upstreamCost: number; multiplier: number };
    };

    expect(payload.cost).toBeCloseTo(0.5 * 1.3, 5); // Charge
    expect(payload.metadata.upstreamCost).toBe(0.5); // Original cost
    expect(payload.metadata.multiplier).toBe(1.3);
  });

  it("merges additional metadata from context", async () => {
    const response = { result: "result", cost: 0.1 };
    const ctx = {
      tenant: "org_123",
      capability: "text-gen",
      provider: "anthropic",
      source: "hosted" as const,
      metadata: {
        model: "claude-opus-4",
        inputTokens: 100,
        outputTokens: 200,
        sessionId: "sess_123",
      },
    };

    await withMargin(response, ctx);

    expect(emittedEvents).toHaveLength(1);
    const payload = emittedEvents[0].payload as {
      metadata: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        sessionId: string;
        upstreamCost: number;
        multiplier: number;
      };
    };

    expect(payload.metadata.model).toBe("claude-opus-4");
    expect(payload.metadata.inputTokens).toBe(100);
    expect(payload.metadata.outputTokens).toBe(200);
    expect(payload.metadata.sessionId).toBe("sess_123");
    expect(payload.metadata.upstreamCost).toBe(0.1);
    expect(payload.metadata.multiplier).toBe(1.3);
  });

  it("handles zero multiplier by using default", async () => {
    config.get = vi.fn(() => ({
      billing: { multiplier: 0 }, // Invalid
    })) as any;

    const response = { result: "result", cost: 1.0 };
    const ctx = {
      tenant: "org_123",
      capability: "text-gen",
      provider: "anthropic",
      source: "hosted" as const,
    };

    await withMargin(response, ctx);

    expect(emittedEvents).toHaveLength(1);
    const payload = emittedEvents[0].payload as { metadata: { multiplier: number } };
    expect(payload.metadata.multiplier).toBe(1.3); // Falls back to default
  });

  it("handles negative multiplier by using default", async () => {
    config.get = vi.fn(() => ({
      billing: { multiplier: -1.5 }, // Invalid
    })) as any;

    const response = { result: "result", cost: 1.0 };
    const ctx = {
      tenant: "org_123",
      capability: "text-gen",
      provider: "anthropic",
      source: "hosted" as const,
    };

    await withMargin(response, ctx);

    expect(emittedEvents).toHaveLength(1);
    const payload = emittedEvents[0].payload as { metadata: { multiplier: number } };
    expect(payload.metadata.multiplier).toBe(1.3); // Falls back to default
  });
});
