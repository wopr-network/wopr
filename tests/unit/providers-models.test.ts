/**
 * Tests for GET /providers/active and GET /providers/:id/models (WOP-268)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock plugin extensions
vi.mock("../../src/plugins/extensions.js", () => ({
  getPluginExtension: vi.fn().mockReturnValue(undefined),
}));

// Mock listConfigSchemas
vi.mock("../../src/plugins.js", () => ({
  listConfigSchemas: vi.fn().mockReturnValue([]),
}));

// Mock capability registry
vi.mock("../../src/core/capability-registry.js", () => ({
  getCapabilityRegistry: vi.fn().mockReturnValue({
    listCapabilities: vi.fn().mockReturnValue([]),
    getProviders: vi.fn().mockReturnValue([]),
  }),
}));

const mockClient = {
  listModels: vi.fn().mockResolvedValue(["model-a", "model-b"]),
  healthCheck: vi.fn().mockResolvedValue(true),
  query: vi.fn(),
};

const mockProvider = {
  id: "testprovider",
  name: "Test Provider",
  defaultModel: "model-a",
  createClient: vi.fn().mockResolvedValue(mockClient),
  getCredentialType: vi.fn().mockReturnValue("api-key"),
  validateCredentials: vi.fn().mockResolvedValue(true),
};

// Build mock provider registry
let mockProviders = new Map<string, any>();

vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    listProviders: vi.fn(() =>
      Array.from(mockProviders.values()).map((reg) => ({
        id: reg.provider.id,
        name: reg.provider.name,
        available: reg.available,
        lastChecked: reg.lastChecked,
      }))
    ),
    getProvider: vi.fn((id: string) => mockProviders.get(id)),
    getActiveProvider: vi.fn(() => {
      for (const reg of mockProviders.values()) {
        if (reg.available) {
          return {
            id: reg.provider.id,
            name: reg.provider.name,
            defaultModel: reg.provider.defaultModel,
          };
        }
      }
      const first = mockProviders.values().next().value;
      if (first) {
        return {
          id: first.provider.id,
          name: first.provider.name,
          defaultModel: first.provider.defaultModel,
        };
      }
      return null;
    }),
    getCredential: vi.fn().mockReturnValue(undefined),
    setCredential: vi.fn(),
    removeCredential: vi.fn(),
    checkHealth: vi.fn(),
  },
}));

import { providersRouter } from "../../src/daemon/routes/providers.js";
import { providerRegistry } from "../../src/core/providers.js";
import { getPluginExtension } from "../../src/plugins/extensions.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockProviders = new Map();
});

const app = new Hono().route("/", providersRouter);

async function req(path: string, method = "GET") {
  return app.request(path, { method });
}

describe("GET /providers/active", () => {
  it("returns null when no providers loaded", async () => {
    vi.mocked(providerRegistry.getActiveProvider).mockReturnValueOnce(null);

    const res = await req("/active");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ provider: null, model: null });
  });

  it("returns first available provider and its default model", async () => {
    vi.mocked(providerRegistry.getActiveProvider).mockReturnValueOnce({
      id: "anthropic",
      name: "Anthropic Claude",
      defaultModel: "claude-opus-4-6",
    });

    const res = await req("/active");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("anthropic");
    expect(body.providerName).toBe("Anthropic Claude");
    expect(body.model).toBe("claude-opus-4-6");
  });

  it("does not treat 'active' as a provider ID (route ordering)", async () => {
    vi.mocked(providerRegistry.getActiveProvider).mockReturnValueOnce(null);
    vi.mocked(providerRegistry.getProvider).mockReturnValue(undefined);

    // '/active' should hit the /active handler, not /:id/models
    const res = await req("/active");
    // /active returns 200 with { provider: null, model: null }
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("provider");
    expect(body).toHaveProperty("model");
    // Should NOT have 'error' from the /:id/models handler
    expect(body).not.toHaveProperty("error");
  });
});

describe("GET /providers/:id/models", () => {
  it("returns 404 when provider not found", async () => {
    vi.mocked(providerRegistry.getProvider).mockReturnValue(undefined);

    const res = await req("/notexist/models");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("notexist");
  });

  it("returns 401 when no credential configured for api-key provider", async () => {
    const reg = {
      provider: mockProvider,
      available: false,
      lastChecked: 0,
    };
    vi.mocked(providerRegistry.getProvider).mockReturnValue(reg);
    vi.mocked(providerRegistry.getCredential).mockReturnValue(undefined);
    vi.mocked(getPluginExtension).mockReturnValue(undefined);

    const res = await req("/testprovider/models");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("testprovider");
  });

  it("returns plain model IDs when no extension registered", async () => {
    const reg = {
      provider: mockProvider,
      available: true,
      lastChecked: Date.now(),
    };
    vi.mocked(providerRegistry.getProvider).mockReturnValue(reg);
    vi.mocked(providerRegistry.getCredential).mockReturnValue({
      providerId: "testprovider",
      type: "api-key",
      credential: "test-key",
      createdAt: Date.now(),
    });
    vi.mocked(getPluginExtension).mockReturnValue(undefined);

    const res = await req("/testprovider/models");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providerId).toBe("testprovider");
    expect(body.providerName).toBe("Test Provider");
    expect(body.defaultModel).toBe("model-a");
    expect(body.models).toEqual([
      { id: "model-a", name: "model-a" },
      { id: "model-b", name: "model-b" },
    ]);
  });

  it("returns enriched model data when extension has getModelInfo", async () => {
    const reg = {
      provider: mockProvider,
      available: true,
      lastChecked: Date.now(),
    };
    vi.mocked(providerRegistry.getProvider).mockReturnValue(reg);
    vi.mocked(providerRegistry.getCredential).mockReturnValue(undefined);

    const enriched = [
      { id: "model-a", name: "Model A", contextWindow: "200K", maxOutput: "128K", legacy: false },
    ];
    vi.mocked(getPluginExtension).mockReturnValue({
      getModelInfo: vi.fn().mockResolvedValue(enriched),
    });

    const res = await req("/testprovider/models");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual(enriched);
    expect(body.models[0]).toHaveProperty("contextWindow");
    expect(body.models[0]).toHaveProperty("maxOutput");
  });

  it("returns 500 when provider client throws", async () => {
    const failProvider = {
      ...mockProvider,
      createClient: vi.fn().mockRejectedValue(new Error("auth failed")),
    };
    const reg = { provider: failProvider, available: false, lastChecked: 0 };
    vi.mocked(providerRegistry.getProvider).mockReturnValue(reg);
    vi.mocked(providerRegistry.getCredential).mockReturnValue({
      providerId: "testprovider",
      type: "api-key",
      credential: "test-key",
      createdAt: Date.now(),
    });
    vi.mocked(getPluginExtension).mockReturnValue(undefined);

    const res = await req("/testprovider/models");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("auth failed");
  });
});
