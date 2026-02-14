/**
 * Provider base URL override tests (WOP-465)
 *
 * Tests that baseUrl on ProviderConfig flows through resolveProvider()
 * into the options passed to createClient(), enabling hosted-mode
 * gateway routing.
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

describe("ProviderConfig.baseUrl", () => {
  describe("type definition", () => {
    it("should allow baseUrl to be omitted (BYOK mode)", () => {
      const config: import("../../src/types/provider.js").ProviderConfig = {
        name: "anthropic",
      };
      expect(config.baseUrl).toBeUndefined();
    });

    it("should allow baseUrl to be set (hosted mode)", () => {
      const config: import("../../src/types/provider.js").ProviderConfig = {
        name: "anthropic",
        source: "hosted",
        baseUrl: "https://api.wopr.bot/v1",
      };
      expect(config.baseUrl).toBe("https://api.wopr.bot/v1");
    });

    it("should allow baseUrl with source byok (user override)", () => {
      const config: import("../../src/types/provider.js").ProviderConfig = {
        name: "openai",
        source: "byok",
        baseUrl: "https://my-proxy.example.com/v1",
      };
      expect(config.baseUrl).toBe("https://my-proxy.example.com/v1");
      expect(config.source).toBe("byok");
    });
  });

  describe("resolveProvider baseUrl threading", () => {
    let ProviderRegistry: typeof import("../../src/core/providers.js").ProviderRegistry;
    let createClientSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.resetModules();
      const mod = await import("../../src/core/providers.js");
      ProviderRegistry = mod.ProviderRegistry;
      createClientSpy = vi.fn().mockResolvedValue({
        query: vi.fn(),
        listModels: vi.fn().mockResolvedValue([]),
        healthCheck: vi.fn().mockResolvedValue(true),
      });
    });

    function makeRegistry(spy: ReturnType<typeof vi.fn>) {
      // Use a fresh instance, not the singleton
      const registry = new ProviderRegistry();
      registry.register({
        id: "test-provider",
        name: "Test Provider",
        description: "Mock provider for testing",
        defaultModel: "test-model",
        supportedModels: ["test-model"],
        validateCredentials: vi.fn().mockResolvedValue(true),
        createClient: spy,
        getCredentialType: () => "api-key",
      });
      return registry;
    }

    it("should pass baseUrl in options to createClient when baseUrl is set", async () => {
      const registry = makeRegistry(createClientSpy);

      // Set a credential so resolution doesn't skip the provider
      await registry.setCredential("test-provider", "test-key-123");

      await registry.resolveProvider({
        name: "test-provider",
        baseUrl: "https://api.wopr.bot/v1",
      });

      expect(createClientSpy).toHaveBeenCalledWith(
        "test-key-123",
        expect.objectContaining({ baseUrl: "https://api.wopr.bot/v1" }),
      );
    });

    it("should NOT inject baseUrl into options when baseUrl is omitted", async () => {
      const registry = makeRegistry(createClientSpy);
      await registry.setCredential("test-provider", "test-key-123");

      await registry.resolveProvider({
        name: "test-provider",
      });

      // options should be undefined (no baseUrl, no options on config)
      expect(createClientSpy).toHaveBeenCalledWith("test-key-123", undefined);
    });

    it("should merge baseUrl with existing options", async () => {
      const registry = makeRegistry(createClientSpy);
      await registry.setCredential("test-provider", "test-key-123");

      await registry.resolveProvider({
        name: "test-provider",
        options: { temperature: 0.7 },
        baseUrl: "https://api.wopr.bot/v1",
      });

      expect(createClientSpy).toHaveBeenCalledWith(
        "test-key-123",
        expect.objectContaining({
          temperature: 0.7,
          baseUrl: "https://api.wopr.bot/v1",
        }),
      );
    });

    it("should preserve existing options when baseUrl is not set", async () => {
      const registry = makeRegistry(createClientSpy);
      await registry.setCredential("test-provider", "test-key-123");

      await registry.resolveProvider({
        name: "test-provider",
        options: { temperature: 0.7 },
      });

      expect(createClientSpy).toHaveBeenCalledWith(
        "test-key-123",
        { temperature: 0.7 },
      );
    });

    it("should work with hosted source + baseUrl (full hosted-mode config)", async () => {
      const registry = makeRegistry(createClientSpy);
      await registry.setCredential("test-provider", "tenant-token-abc");

      const resolved = await registry.resolveProvider({
        name: "test-provider",
        source: "hosted",
        baseUrl: "https://api.wopr.bot/v1",
        model: "claude-sonnet-4-20250514",
      });

      expect(createClientSpy).toHaveBeenCalledWith(
        "tenant-token-abc",
        expect.objectContaining({ baseUrl: "https://api.wopr.bot/v1" }),
      );
      expect(resolved.name).toBe("test-provider");
      expect(resolved.credential).toBe("tenant-token-abc");
    });
  });

  describe("session provider config persistence", () => {
    it("should round-trip baseUrl through JSON serialization", () => {
      const config: import("../../src/types/provider.js").ProviderConfig = {
        name: "anthropic",
        source: "hosted",
        baseUrl: "https://api.wopr.bot/v1",
        model: "claude-sonnet-4-20250514",
      };

      const serialized = JSON.stringify(config);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.baseUrl).toBe("https://api.wopr.bot/v1");
      expect(deserialized.source).toBe("hosted");
      expect(deserialized.name).toBe("anthropic");
    });
  });
});
