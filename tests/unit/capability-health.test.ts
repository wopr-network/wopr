import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock capability-registry
vi.mock("../../src/core/capability-registry.js", () => {
  const registry = {
    listCapabilities: vi.fn(() => []),
    getProviders: vi.fn(() => []),
  };
  return {
    getCapabilityRegistry: () => registry,
    resetCapabilityRegistry: vi.fn(),
  };
});

// Mock eventBus
vi.mock("../../src/core/events.js", () => ({
  eventBus: {
    emitCustom: vi.fn(() => Promise.resolve()),
  },
}));

import { getCapabilityRegistry } from "../../src/core/capability-registry.js";
import {
  CapabilityHealthProber,
  getCapabilityHealthProber,
  resetCapabilityHealthProber,
} from "../../src/core/capability-health.js";
import { eventBus } from "../../src/core/events.js";

describe("CapabilityHealthProber", () => {
  let prober: CapabilityHealthProber;
  const registry = getCapabilityRegistry();

  beforeEach(() => {
    vi.mocked(registry.listCapabilities).mockReturnValue([]);
    vi.mocked(registry.getProviders).mockReturnValue([]);
    vi.mocked(eventBus.emitCustom).mockClear();
    prober = new CapabilityHealthProber({ intervalMs: 60_000, probeTimeoutMs: 1000 });
  });

  afterEach(() => {
    prober.stop();
  });

  it("returns healthy snapshot when no capabilities registered", async () => {
    const snapshot = await prober.check();
    expect(snapshot.overallHealthy).toBe(true);
    expect(snapshot.capabilities).toEqual([]);
    expect(snapshot.timestamp).toBeDefined();
  });

  it("marks providers healthy when no probe is registered (optimistic default)", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const snapshot = await prober.check();

    expect(snapshot.overallHealthy).toBe(true);
    expect(snapshot.capabilities).toHaveLength(1);
    expect(snapshot.capabilities[0].capability).toBe("tts");
    expect(snapshot.capabilities[0].healthy).toBe(true);
    expect(snapshot.capabilities[0].providers).toHaveLength(1);
    expect(snapshot.capabilities[0].providers[0].healthy).toBe(true);
    expect(snapshot.capabilities[0].providers[0].providerId).toBe("chatterbox");
  });

  it("runs registered probe and reports healthy", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(async () => true);
    prober.registerProbe("tts", "chatterbox", mockProbe);

    const snapshot = await prober.check();

    expect(mockProbe).toHaveBeenCalled();
    expect(snapshot.capabilities[0].providers[0].healthy).toBe(true);
    expect(snapshot.capabilities[0].providers[0].responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("runs registered probe and reports unhealthy on failure", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(async () => false);
    prober.registerProbe("tts", "chatterbox", mockProbe);

    const snapshot = await prober.check();

    expect(snapshot.capabilities[0].providers[0].healthy).toBe(false);
    expect(snapshot.capabilities[0].healthy).toBe(false);
    expect(snapshot.overallHealthy).toBe(false);
  });

  it("handles probe that throws an error", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(async () => {
      throw new Error("Connection failed");
    });
    prober.registerProbe("tts", "chatterbox", mockProbe);

    const snapshot = await prober.check();

    expect(snapshot.capabilities[0].providers[0].healthy).toBe(false);
    expect(snapshot.capabilities[0].providers[0].error).toBe("Connection failed");
  });

  it("handles probe timeout", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(true), 2000)), // Longer than timeout
    );
    prober.registerProbe("tts", "chatterbox", mockProbe);

    const snapshot = await prober.check();

    expect(snapshot.capabilities[0].providers[0].healthy).toBe(false);
    expect(snapshot.capabilities[0].providers[0].error).toBe("Probe timed out");
  });

  it("tracks consecutiveFailures", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(async () => false);
    prober.registerProbe("tts", "chatterbox", mockProbe);

    // First failure
    let snapshot = await prober.check();
    expect(snapshot.capabilities[0].providers[0].consecutiveFailures).toBe(1);

    // Second failure
    snapshot = await prober.check();
    expect(snapshot.capabilities[0].providers[0].consecutiveFailures).toBe(2);

    // Success - resets to 0
    mockProbe.mockResolvedValueOnce(true);
    snapshot = await prober.check();
    expect(snapshot.capabilities[0].providers[0].consecutiveFailures).toBe(0);
  });

  it("emits providerStatusChange on healthy->unhealthy transition", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(async () => true);
    prober.registerProbe("tts", "chatterbox", mockProbe);

    const eventListener = vi.fn();
    prober.on("providerStatusChange", eventListener);

    // First check - healthy (no event on first check)
    await prober.check();
    expect(eventListener).not.toHaveBeenCalled();

    // Second check - unhealthy (transition event)
    mockProbe.mockResolvedValueOnce(false);
    await prober.check();

    expect(eventListener).toHaveBeenCalledWith({
      capability: "tts",
      providerId: "chatterbox",
      providerName: "Chatterbox TTS",
      previousHealthy: true,
      currentHealthy: false,
      error: undefined,
    });
  });

  it("emits providerStatusChange on unhealthy->healthy recovery", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(async () => false);
    prober.registerProbe("tts", "chatterbox", mockProbe);

    const eventListener = vi.fn();
    prober.on("providerStatusChange", eventListener);

    // First check - unhealthy (no event)
    await prober.check();
    expect(eventListener).not.toHaveBeenCalled();

    // Second check - healthy (recovery event)
    mockProbe.mockResolvedValueOnce(true);
    await prober.check();

    expect(eventListener).toHaveBeenCalledWith({
      capability: "tts",
      providerId: "chatterbox",
      providerName: "Chatterbox TTS",
      previousHealthy: false,
      currentHealthy: true,
      error: undefined,
    });
  });

  it("does not emit event when status unchanged", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(async () => true);
    prober.registerProbe("tts", "chatterbox", mockProbe);

    const eventListener = vi.fn();
    prober.on("providerStatusChange", eventListener);

    await prober.check(); // healthy
    await prober.check(); // still healthy

    expect(eventListener).not.toHaveBeenCalled();
  });

  it("overallHealthy is false when a capability has zero healthy providers", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(async () => false);
    prober.registerProbe("tts", "chatterbox", mockProbe);

    const snapshot = await prober.check();

    expect(snapshot.capabilities[0].healthy).toBe(false);
    expect(snapshot.overallHealthy).toBe(false);
  });

  it("overallHealthy is true when at least one provider per capability is healthy", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 2 }]);
    vi.mocked(registry.getProviders).mockReturnValue([
      { id: "chatterbox", name: "Chatterbox TTS" },
      { id: "elevenlabs", name: "ElevenLabs" },
    ]);

    const failingProbe = vi.fn(async () => false);
    const successProbe = vi.fn(async () => true);
    prober.registerProbe("tts", "chatterbox", failingProbe);
    prober.registerProbe("tts", "elevenlabs", successProbe);

    const snapshot = await prober.check();

    expect(snapshot.capabilities[0].healthyCount).toBe(1);
    expect(snapshot.capabilities[0].healthy).toBe(true);
    expect(snapshot.overallHealthy).toBe(true);
  });

  it("unregisterProbe removes the probe", async () => {
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);

    const mockProbe = vi.fn(async () => false);
    prober.registerProbe("tts", "chatterbox", mockProbe);

    let snapshot = await prober.check();
    expect(snapshot.capabilities[0].providers[0].healthy).toBe(false);

    // Unregister - should fall back to optimistic healthy
    prober.unregisterProbe("tts", "chatterbox");
    snapshot = await prober.check();
    expect(snapshot.capabilities[0].providers[0].healthy).toBe(true);
  });

  it("start and stop control the interval timer", async () => {
    vi.useFakeTimers();

    const mockProbe = vi.fn(async () => true);
    vi.mocked(registry.listCapabilities).mockReturnValue([{ capability: "tts", providerCount: 1 }]);
    vi.mocked(registry.getProviders).mockReturnValue([{ id: "chatterbox", name: "Chatterbox TTS" }]);
    prober.registerProbe("tts", "chatterbox", mockProbe);

    prober.start();

    // Verify timer was created by advancing time and checking calls
    await vi.runOnlyPendingTimersAsync(); // Initial check
    mockProbe.mockClear();

    // Advance to next interval
    vi.advanceTimersByTime(60_000);
    await vi.runOnlyPendingTimersAsync();
    expect(mockProbe).toHaveBeenCalled();

    // Stop and verify no more calls
    prober.stop();
    mockProbe.mockClear();
    vi.advanceTimersByTime(60_000);
    await vi.runOnlyPendingTimersAsync();
    expect(mockProbe).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("getCapabilityHealth returns null for unknown capability", () => {
    const health = prober.getCapabilityHealth("unknown");
    expect(health).toBeNull();
  });

  it("getProviderHealth returns null for unknown provider", () => {
    const health = prober.getProviderHealth("tts", "unknown");
    expect(health).toBeNull();
  });

  it("singleton getCapabilityHealthProber returns same instance", () => {
    const instance1 = getCapabilityHealthProber();
    const instance2 = getCapabilityHealthProber();
    expect(instance1).toBe(instance2);
  });

  it("resetCapabilityHealthProber creates fresh instance", () => {
    const instance1 = getCapabilityHealthProber();
    resetCapabilityHealthProber();
    const instance2 = getCapabilityHealthProber();
    expect(instance1).not.toBe(instance2);
  });
});
