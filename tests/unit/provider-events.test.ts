import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let eventBus: any;

beforeEach(async () => {
  vi.resetModules();
  const eventsModule = await import("../../src/core/events.js");
  eventBus = eventsModule.eventBus;
});

afterEach(() => {
  eventBus?.removeAllListeners();
  vi.restoreAllMocks();
});

describe("Provider Events — event types", () => {
  it("should accept provider:added event type", async () => {
    const handler = vi.fn();
    eventBus.on("provider:added", handler);

    await eventBus.emit("provider:added", { providerId: "test-provider", providerName: "Test Provider" }, "core");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      { providerId: "test-provider", providerName: "Test Provider" },
      expect.objectContaining({ type: "provider:added", source: "core" }),
    );
  });

  it("should accept provider:removed event type", async () => {
    const handler = vi.fn();
    eventBus.on("provider:removed", handler);

    await eventBus.emit("provider:removed", { providerId: "test-provider", providerName: "Test Provider" }, "core");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      { providerId: "test-provider", providerName: "Test Provider" },
      expect.objectContaining({ type: "provider:removed", source: "core" }),
    );
  });

  it("should accept provider:status event type", async () => {
    const handler = vi.fn();
    eventBus.on("provider:status", handler);

    await eventBus.emit(
      "provider:status",
      { providerId: "test-provider", providerName: "Test Provider", previousAvailable: false, currentAvailable: true },
      "core",
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "test-provider", previousAvailable: false, currentAvailable: true }),
      expect.objectContaining({ type: "provider:status" }),
    );
  });
});

describe("ProviderRegistry emits events", () => {
  let ProviderRegistry: any;

  beforeEach(async () => {
    const providersModule = await import("../../src/core/providers.js");
    ProviderRegistry = providersModule.ProviderRegistry;
    const eventsModule = await import("../../src/core/events.js");
    eventBus = eventsModule.eventBus;
  });

  function makeTestProvider(id: string, name: string) {
    return {
      id,
      name,
      description: "Test",
      defaultModel: "test-model",
      supportedModels: ["test-model"],
      validateCredentials: vi.fn().mockResolvedValue(true),
      createClient: vi.fn().mockResolvedValue({
        query: vi.fn(),
        listModels: vi.fn().mockResolvedValue([]),
        healthCheck: vi.fn().mockResolvedValue(true),
      }),
      getCredentialType: vi.fn().mockReturnValue("api-key"),
    };
  }

  it("should emit provider:added when register() is called", async () => {
    const handler = vi.fn();
    eventBus.on("provider:added", handler);

    const registry = new ProviderRegistry();
    registry.register(makeTestProvider("openai", "OpenAI"));

    await new Promise((r) => setTimeout(r, 10));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      { providerId: "openai", providerName: "OpenAI" },
      expect.objectContaining({ type: "provider:added" }),
    );
  });

  it("should emit provider:removed when unregister() is called", async () => {
    const registry = new ProviderRegistry();
    registry.register(makeTestProvider("openai", "OpenAI"));
    await new Promise((r) => setTimeout(r, 10));

    const removedHandler = vi.fn();
    eventBus.on("provider:removed", removedHandler);

    registry.unregister("openai");
    await new Promise((r) => setTimeout(r, 10));

    expect(removedHandler).toHaveBeenCalledOnce();
    expect(removedHandler).toHaveBeenCalledWith(
      { providerId: "openai", providerName: "OpenAI" },
      expect.objectContaining({ type: "provider:removed" }),
    );
  });

  it("should NOT emit provider:removed for unknown provider", async () => {
    const handler = vi.fn();
    eventBus.on("provider:removed", handler);

    const registry = new ProviderRegistry();
    registry.unregister("nonexistent");
    await new Promise((r) => setTimeout(r, 10));

    expect(handler).not.toHaveBeenCalled();
  });

  it("should emit provider:status when checkHealth() changes availability", async () => {
    const handler = vi.fn();
    eventBus.on("provider:status", handler);

    const registry = new ProviderRegistry();
    const provider = makeTestProvider("openai", "OpenAI");
    registry.register(provider);

    registry["credentials"].set("openai", {
      providerId: "openai",
      type: "api-key",
      credential: "test-key",
      createdAt: Date.now(),
    });

    await registry.checkHealth();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai",
        providerName: "OpenAI",
        previousAvailable: false,
        currentAvailable: true,
      }),
      expect.objectContaining({ type: "provider:status" }),
    );
  });

  it("should NOT emit provider:status when availability unchanged", async () => {
    const handler = vi.fn();
    eventBus.on("provider:status", handler);

    const registry = new ProviderRegistry();
    const provider = makeTestProvider("openai", "OpenAI");
    provider.createClient.mockResolvedValue({
      query: vi.fn(),
      listModels: vi.fn().mockResolvedValue([]),
      healthCheck: vi.fn().mockResolvedValue(false),
    });
    registry.register(provider);

    registry["credentials"].set("openai", {
      providerId: "openai",
      type: "api-key",
      credential: "test-key",
      createdAt: Date.now(),
    });

    await registry.checkHealth();

    expect(handler).not.toHaveBeenCalled();
  });
});
