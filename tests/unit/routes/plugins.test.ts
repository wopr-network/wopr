/**
 * Plugin Routes Tests (WOP-1414)
 *
 * Tests for src/daemon/routes/plugins.ts covering:
 * - GET  /                      — List installed plugins
 * - GET  /available             — Search available plugins
 * - GET  /ui                    — List UI extensions
 * - GET  /components            — List UI components
 * - GET  /search                — Search plugins by query
 * - GET  /registries            — List registries
 * - POST /                      — Install plugin (legacy)
 * - POST /install               — Install plugin
 * - POST /uninstall             — Uninstall plugin
 * - DELETE /:name               — Remove plugin (legacy)
 * - POST /:name/enable          — Enable plugin
 * - POST /:name/disable         — Disable plugin
 * - POST /:name/reload          — Reload plugin
 * - GET  /:name/state           — Plugin runtime state
 * - GET  /:name/config          — Get plugin config
 * - PUT  /:name/config          — Update plugin config
 * - GET  /:name/health          — Plugin health/status
 * - POST /registries            — Add registry
 * - DELETE /registries/:name    — Remove registry
 * - POST /discord/claim         — Claim Discord ownership
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

// plugins.js barrel — mock every import used by the route file
const mockListPlugins = vi.fn();
const mockGetAllPluginManifests = vi.fn();
const mockReadPluginManifest = vi.fn();
const mockGetLoadedPlugin = vi.fn();
const mockInstallPlugin = vi.fn();
const mockEnablePlugin = vi.fn();
const mockDisablePlugin = vi.fn();
const mockLoadPlugin = vi.fn();
const mockUnloadPlugin = vi.fn();
const mockRemovePlugin = vi.fn();
const mockGetPluginState = vi.fn();
const mockGetConfigSchemas = vi.fn();
const mockSearchPlugins = vi.fn();
const mockListRegistries = vi.fn();
const mockAddRegistry = vi.fn();
const mockRemoveRegistry = vi.fn();
const mockGetWebUiExtensions = vi.fn();
const mockGetUiComponents = vi.fn();
const mockGetPluginExtension = vi.fn();
const mockGetInstalledPlugins = vi.fn();

vi.mock("../../../src/plugins.js", () => ({
  listPlugins: mockListPlugins,
  getAllPluginManifests: mockGetAllPluginManifests,
  readPluginManifest: mockReadPluginManifest,
  getLoadedPlugin: mockGetLoadedPlugin,
  installPlugin: mockInstallPlugin,
  enablePlugin: mockEnablePlugin,
  disablePlugin: mockDisablePlugin,
  loadPlugin: mockLoadPlugin,
  unloadPlugin: mockUnloadPlugin,
  removePlugin: mockRemovePlugin,
  getPluginState: mockGetPluginState,
  getConfigSchemas: mockGetConfigSchemas,
  searchPlugins: mockSearchPlugins,
  listRegistries: mockListRegistries,
  addRegistry: mockAddRegistry,
  getInstalledPlugins: mockGetInstalledPlugins,
  removeRegistry: mockRemoveRegistry,
  getWebUiExtensions: mockGetWebUiExtensions,
  getUiComponents: mockGetUiComponents,
  getPluginExtension: mockGetPluginExtension,
}));

// core/config.js
const mockConfigLoad = vi.fn();
const mockConfigGet = vi.fn();
const mockConfigSetValue = vi.fn();
const mockConfigSave = vi.fn();

vi.mock("../../../src/core/config.js", () => ({
  config: {
    load: mockConfigLoad,
    get: mockConfigGet,
    setValue: mockConfigSetValue,
    save: mockConfigSave,
  },
}));

// core/providers.js
const mockCheckHealth = vi.fn();
vi.mock("../../../src/core/providers.js", () => ({
  providerRegistry: { checkHealth: mockCheckHealth },
}));

// core/sessions.js
const mockGetSessions = vi.fn();
const mockInject = vi.fn();
vi.mock("../../../src/core/sessions.js", () => ({
  getSessions: mockGetSessions,
  inject: mockInject,
}));

// logger.js
vi.mock("../../../src/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// hono-openapi — make describeRoute a passthrough
vi.mock("hono-openapi", () => ({
  describeRoute: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// hono-rate-limiter — make rateLimiter a passthrough
vi.mock("hono-rate-limiter", () => ({
  rateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// middleware/auth.js — make requireAdmin a passthrough by default
const mockRequireAdminHandler = vi.fn(async (_c: unknown, next: () => Promise<void>) => next());
vi.mock("../../../src/daemon/middleware/auth.js", () => ({
  requireAdmin: () => mockRequireAdminHandler,
}));

// dependency-check — real implementation is simple enough; mock for route isolation
const mockCheckPluginDependencies = vi.fn();
vi.mock("../../../src/plugins/dependency-check.js", () => ({
  checkPluginDependencies: mockCheckPluginDependencies,
}));

// Now import the router AFTER mocks are set up
const { pluginsRouter } = await import("../../../src/daemon/routes/plugins.js");

// ── Helpers ──────────────────────────────────────────────────────────────

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return pluginsRouter.request(path, init);
}

const SAMPLE_PLUGIN = {
  name: "test-plugin",
  version: "1.0.0",
  description: "A test plugin",
  source: "test-plugin",
  path: "/plugins/test-plugin",
  enabled: true,
  installedAt: Date.now(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllPluginManifests.mockReturnValue(new Map());
  mockGetConfigSchemas.mockReturnValue(new Map());
  mockGetSessions.mockResolvedValue({});
  mockInject.mockResolvedValue({ response: "" });
  mockCheckHealth.mockResolvedValue(undefined);
  mockReadPluginManifest.mockReturnValue(undefined);
  mockGetInstalledPlugins.mockResolvedValue([]);
  // Default: all dependencies satisfied
  mockCheckPluginDependencies.mockReturnValue({ ok: true, missing: [] });
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("GET / — list plugins", () => {
  it("returns empty list when no plugins installed", async () => {
    mockListPlugins.mockResolvedValue([]);
    const res = await req("GET", "/");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plugins).toEqual([]);
  });

  it("returns plugins with runtime manifest data", async () => {
    const manifests = new Map([
      [
        "test-plugin",
        {
          capabilities: ["chat"],
          category: "utility",
          tags: ["test"],
          icon: "🔌",
          author: "wopr",
          license: "MIT",
          homepage: "https://example.com",
          configSchema: { title: "Config", fields: [] },
        },
      ],
    ]);
    mockGetAllPluginManifests.mockReturnValue(manifests);
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockGetLoadedPlugin.mockReturnValue({ name: "test-plugin" });

    const res = await req("GET", "/");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plugins).toHaveLength(1);
    expect(json.plugins[0].name).toBe("test-plugin");
    expect(json.plugins[0].loaded).toBe(true);
    expect(json.plugins[0].manifest.capabilities).toEqual(["chat"]);
    expect(json.plugins[0].manifest.category).toBe("utility");
  });

  it("falls back to disk manifest when runtime manifest missing", async () => {
    mockGetAllPluginManifests.mockReturnValue(new Map());
    mockReadPluginManifest.mockReturnValue({
      capabilities: ["voice"],
      category: null,
      tags: [],
    });
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockGetLoadedPlugin.mockReturnValue(undefined);

    const res = await req("GET", "/");
    const json = await res.json();
    expect(json.plugins[0].loaded).toBe(false);
    expect(json.plugins[0].manifest.capabilities).toEqual(["voice"]);
  });

  it("returns null manifest when no manifest available", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockGetLoadedPlugin.mockReturnValue(undefined);

    const res = await req("GET", "/");
    const json = await res.json();
    expect(json.plugins[0].manifest).toBeNull();
  });
});

describe("POST / and POST /install — install plugin", () => {
  beforeEach(() => {
    mockInstallPlugin.mockResolvedValue(SAMPLE_PLUGIN);
    mockEnablePlugin.mockResolvedValue(undefined);
    mockLoadPlugin.mockResolvedValue(undefined);
  });

  for (const path of ["/", "/install"]) {
    describe(`POST ${path}`, () => {
      it("installs, enables, loads, and returns 201", async () => {
        const res = await req("POST", path, { source: "test-plugin" });
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.installed).toBe(true);
        expect(json.plugin.name).toBe("test-plugin");
        expect(json.plugin.enabled).toBe(true);
        expect(json.plugin.loaded).toBe(true);
        expect(mockInstallPlugin).toHaveBeenCalledWith("test-plugin");
        expect(mockEnablePlugin).toHaveBeenCalledWith("test-plugin");
        expect(mockLoadPlugin).toHaveBeenCalled();
        expect(mockCheckHealth).toHaveBeenCalled();
      });

      it("accepts 'package' field as alias for source", async () => {
        mockInstallPlugin.mockResolvedValue({ ...SAMPLE_PLUGIN, name: "other-plugin" });
        const res = await req("POST", path, { package: "other-plugin" });
        expect(res.status).toBe(201);
        expect(mockInstallPlugin).toHaveBeenCalledWith("other-plugin");
      });

      it("returns 400 when source is missing", async () => {
        const res = await req("POST", path, {});
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/source.*required/i);
      });

      it("returns 400 for invalid plugin name (path traversal)", async () => {
        const res = await req("POST", path, { source: "../etc/passwd" });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/Invalid plugin name/);
      });

      it("returns 400 for shell metacharacters", async () => {
        const res = await req("POST", path, { source: "plugin;rm -rf /" });
        expect(res.status).toBe(400);
      });

      it("returns 400 when installPlugin throws", async () => {
        mockInstallPlugin.mockRejectedValue(new Error("npm install failed"));
        const res = await req("POST", path, { source: "bad-plugin" });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe("Plugin installation failed");
      });
    });
  }
});

describe("POST /uninstall — uninstall plugin", () => {
  it("unloads and removes plugin", async () => {
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockRemovePlugin.mockResolvedValue(undefined);
    const res = await req("POST", "/uninstall", { name: "test-plugin" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.removed).toBe(true);
    expect(json.unloaded).toBe(true);
    expect(mockUnloadPlugin).toHaveBeenCalledWith("test-plugin");
    expect(mockRemovePlugin).toHaveBeenCalledWith("test-plugin");
  });

  it("returns 400 when name is missing", async () => {
    const res = await req("POST", "/uninstall", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/name.*required/i);
  });

  it("returns 400 for invalid name", async () => {
    const res = await req("POST", "/uninstall", { name: "../bad" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when unloadPlugin throws", async () => {
    mockUnloadPlugin.mockRejectedValue(new Error("unload failed"));
    const res = await req("POST", "/uninstall", { name: "test-plugin" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Plugin uninstall failed");
  });

  it("returns 400 when removePlugin throws after unload succeeds", async () => {
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockRemovePlugin.mockRejectedValue(new Error("remove failed"));
    const res = await req("POST", "/uninstall", { name: "test-plugin" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Plugin uninstall failed");
  });
});

describe("DELETE /:name — remove plugin (legacy)", () => {
  it("unloads and removes with default options", async () => {
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockRemovePlugin.mockResolvedValue(undefined);
    const res = await req("DELETE", "/test-plugin");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.removed).toBe(true);
    expect(json.unloaded).toBe(true);
  });

  it("passes drainTimeoutMs and force options", async () => {
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockRemovePlugin.mockResolvedValue(undefined);
    const res = await req("DELETE", "/test-plugin", {
      drainTimeoutMs: 5000,
      force: true,
    });
    expect(res.status).toBe(200);
    expect(mockUnloadPlugin).toHaveBeenCalledWith("test-plugin", {
      drainTimeoutMs: 5000,
      force: true,
    });
  });

  it("returns 400 for invalid name", async () => {
    const res = await req("DELETE", "/..bad");
    expect(res.status).toBe(400);
  });

  it("returns 400 when unloadPlugin throws", async () => {
    mockUnloadPlugin.mockRejectedValue(new Error("unload failed"));
    const res = await req("DELETE", "/test-plugin");
    expect(res.status).toBe(400);
  });

  it("returns 400 when removePlugin throws", async () => {
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockRemovePlugin.mockRejectedValue(new Error("rm failed"));
    const res = await req("DELETE", "/test-plugin");
    expect(res.status).toBe(400);
  });
});

describe("POST /:name/enable", () => {
  it("enables and hot-loads plugin", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockEnablePlugin.mockResolvedValue(undefined);
    mockLoadPlugin.mockResolvedValue(undefined);

    const res = await req("POST", "/test-plugin/enable");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enabled).toBe(true);
    expect(json.loaded).toBe(true);
    expect(mockEnablePlugin).toHaveBeenCalledWith("test-plugin");
    expect(mockLoadPlugin).toHaveBeenCalled();
    expect(mockCheckHealth).toHaveBeenCalled();
  });

  it("returns 404 when plugin not found", async () => {
    mockListPlugins.mockResolvedValue([]);
    const res = await req("POST", "/nonexistent/enable");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid name", async () => {
    const res = await req("POST", "/..bad/enable");
    expect(res.status).toBe(400);
  });

  it("returns 400 when enablePlugin throws", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockEnablePlugin.mockRejectedValue(new Error("enable failed"));
    const res = await req("POST", "/test-plugin/enable");
    expect(res.status).toBe(400);
  });
});

describe("POST /:name/disable", () => {
  it("unloads and disables plugin", async () => {
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockDisablePlugin.mockResolvedValue(undefined);

    const res = await req("POST", "/test-plugin/disable");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.disabled).toBe(true);
    expect(json.unloaded).toBe(true);
  });

  it("passes drain options from body", async () => {
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockDisablePlugin.mockResolvedValue(undefined);
    const res = await req("POST", "/test-plugin/disable", {
      drainTimeoutMs: 3000,
      force: true,
    });
    expect(res.status).toBe(200);
    expect(mockUnloadPlugin).toHaveBeenCalledWith("test-plugin", {
      drainTimeoutMs: 3000,
      force: true,
    });
  });

  it("returns 400 for invalid name", async () => {
    const res = await req("POST", "/..x/disable");
    expect(res.status).toBe(400);
  });

  it("returns 400 when disablePlugin throws", async () => {
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockDisablePlugin.mockRejectedValue(new Error("disable failed"));
    const res = await req("POST", "/test-plugin/disable");
    expect(res.status).toBe(400);
  });
});

describe("POST /:name/reload", () => {
  it("reloads an enabled plugin", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockLoadPlugin.mockResolvedValue(undefined);

    const res = await req("POST", "/test-plugin/reload");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reloaded).toBe(true);
    expect(json.plugin).toBe("test-plugin");
    expect(mockUnloadPlugin).toHaveBeenCalled();
    expect(mockLoadPlugin).toHaveBeenCalled();
    expect(mockCheckHealth).toHaveBeenCalled();
  });

  it("returns 404 when plugin not found", async () => {
    mockListPlugins.mockResolvedValue([]);
    const res = await req("POST", "/nonexistent/reload");
    expect(res.status).toBe(404);
  });

  it("returns 400 when plugin is disabled", async () => {
    mockListPlugins.mockResolvedValue([{ ...SAMPLE_PLUGIN, enabled: false }]);
    const res = await req("POST", "/test-plugin/reload");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not enabled/i);
  });

  it("passes drain options", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockUnloadPlugin.mockResolvedValue(undefined);
    mockLoadPlugin.mockResolvedValue(undefined);
    const res = await req("POST", "/test-plugin/reload", { force: true });
    expect(res.status).toBe(200);
    expect(mockUnloadPlugin).toHaveBeenCalledWith("test-plugin", {
      drainTimeoutMs: undefined,
      force: true,
    });
  });

  it("returns 400 for invalid name", async () => {
    const res = await req("POST", "/..bad/reload");
    expect(res.status).toBe(400);
  });
});

describe("GET /:name/state", () => {
  it("returns plugin state", async () => {
    mockGetPluginState.mockReturnValue("running");
    const res = await req("GET", "/test-plugin/state");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("test-plugin");
    expect(json.state).toBe("running");
  });

  it("returns 'unloaded' when plugin has no state", async () => {
    mockGetPluginState.mockReturnValue(undefined);
    const res = await req("GET", "/test-plugin/state");
    const json = await res.json();
    expect(json.state).toBe("unloaded");
  });
});

describe("GET /:name/config", () => {
  it("returns plugin config and schema", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockConfigLoad.mockResolvedValue(undefined);
    mockConfigGet.mockReturnValue({
      plugins: { data: { "test-plugin": { apiKey: "abc" } } },
    });
    const schema = {
      title: "Config",
      fields: [{ name: "apiKey", type: "string", required: true }],
    };
    mockGetConfigSchemas.mockReturnValue(new Map([["test-plugin", schema]]));

    const res = await req("GET", "/test-plugin/config");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("test-plugin");
    expect(json.config).toEqual({ apiKey: "abc" });
    expect(json.configSchema).toEqual(schema);
  });

  it("returns 404 when plugin not found", async () => {
    mockListPlugins.mockResolvedValue([]);
    const res = await req("GET", "/nonexistent/config");
    expect(res.status).toBe(404);
  });

  it("falls back to disk manifest for schema", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockConfigLoad.mockResolvedValue(undefined);
    mockConfigGet.mockReturnValue({});
    mockGetConfigSchemas.mockReturnValue(new Map());
    const diskSchema = { title: "Disk", fields: [] };
    mockReadPluginManifest.mockReturnValue({ configSchema: diskSchema });

    const res = await req("GET", "/test-plugin/config");
    const json = await res.json();
    expect(json.configSchema).toEqual(diskSchema);
  });

  it("returns empty config when no data stored", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockConfigLoad.mockResolvedValue(undefined);
    mockConfigGet.mockReturnValue({});

    const res = await req("GET", "/test-plugin/config");
    const json = await res.json();
    expect(json.config).toEqual({});
  });
});

describe("PUT /:name/config", () => {
  it("saves config and returns updated", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockConfigLoad.mockResolvedValue(undefined);
    const cfgObj: Record<string, unknown> = {};
    mockConfigGet.mockReturnValue(cfgObj);
    mockConfigSave.mockResolvedValue(undefined);

    const res = await req("PUT", "/test-plugin/config", {
      config: { apiKey: "new-key" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(true);
    expect(json.config).toEqual({ apiKey: "new-key" });
    expect(mockConfigSetValue).toHaveBeenCalled();
    expect(mockConfigSave).toHaveBeenCalled();
  });

  it("returns 404 when plugin not found", async () => {
    mockListPlugins.mockResolvedValue([]);
    const res = await req("PUT", "/nonexistent/config", { config: {} });
    expect(res.status).toBe(404);
  });

  it("returns 400 when config is missing", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    const res = await req("PUT", "/test-plugin/config", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/config.*required/i);
  });

  it("returns 400 when config is not an object", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    const res = await req("PUT", "/test-plugin/config", { config: "string" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when config is an array", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    const res = await req("PUT", "/test-plugin/config", { config: [1, 2] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when config fails schema validation", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    const schema = {
      title: "Config",
      fields: [{ name: "apiKey", type: "string", required: true }],
    };
    mockGetConfigSchemas.mockReturnValue(new Map([["test-plugin", schema]]));
    mockConfigLoad.mockResolvedValue(undefined);
    mockConfigGet.mockReturnValue({});

    const res = await req("PUT", "/test-plugin/config", { config: {} });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/validation failed/i);
    expect(json.details).toContain('Field "apiKey" is required');
  });
});

describe("GET /:name/health", () => {
  it("returns health info for installed plugin", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockGetLoadedPlugin.mockReturnValue({ name: "test-plugin" });
    const manifests = new Map([
      [
        "test-plugin",
        { capabilities: ["chat"], category: "utility", lifecycle: "stable" },
      ],
    ]);
    mockGetAllPluginManifests.mockReturnValue(manifests);

    const res = await req("GET", "/test-plugin/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.installed).toBe(true);
    expect(json.enabled).toBe(true);
    expect(json.loaded).toBe(true);
    expect(json.manifest.capabilities).toEqual(["chat"]);
  });

  it("returns 404 when plugin not found", async () => {
    mockListPlugins.mockResolvedValue([]);
    const res = await req("GET", "/nonexistent/health");
    expect(res.status).toBe(404);
  });

  it("returns loaded: false when plugin not loaded", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockGetLoadedPlugin.mockReturnValue(undefined);

    const res = await req("GET", "/test-plugin/health");
    const json = await res.json();
    expect(json.loaded).toBe(false);
  });
});

describe("GET /available", () => {
  it("returns search results with default limit", async () => {
    mockSearchPlugins.mockResolvedValue([{ name: "wopr-plugin-foo" }]);
    const res = await req("GET", "/available");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
  });

  it("passes query string to searchPlugins", async () => {
    mockSearchPlugins.mockResolvedValue([]);
    await req("GET", "/available?q=voice");
    expect(mockSearchPlugins).toHaveBeenCalledWith("voice");
  });

  it("passes empty string to searchPlugins when q is omitted", async () => {
    mockSearchPlugins.mockResolvedValue([]);
    await req("GET", "/available");
    expect(mockSearchPlugins).toHaveBeenCalledWith("");
  });

  it("respects limit query param (capped at 100)", async () => {
    const manyResults = Array.from({ length: 150 }, (_, i) => ({ name: `p${i}` }));
    mockSearchPlugins.mockResolvedValue(manyResults);
    const res = await req("GET", "/available?limit=200");
    const json = await res.json();
    expect(json.results).toHaveLength(100);
  });

  it("uses default limit of 25 when not specified", async () => {
    const manyResults = Array.from({ length: 50 }, (_, i) => ({ name: `p${i}` }));
    mockSearchPlugins.mockResolvedValue(manyResults);
    const res = await req("GET", "/available");
    const json = await res.json();
    expect(json.results).toHaveLength(25);
  });
});

describe("GET /ui", () => {
  it("returns web UI extensions", async () => {
    mockGetWebUiExtensions.mockReturnValue([{ id: "panel1" }]);
    const res = await req("GET", "/ui");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extensions).toEqual([{ id: "panel1" }]);
  });

  it("returns empty array when no extensions", async () => {
    mockGetWebUiExtensions.mockReturnValue([]);
    const res = await req("GET", "/ui");
    const json = await res.json();
    expect(json.extensions).toEqual([]);
  });
});

describe("GET /components", () => {
  it("returns UI components", async () => {
    mockGetUiComponents.mockReturnValue([{ id: "comp1" }]);
    const res = await req("GET", "/components");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.components).toEqual([{ id: "comp1" }]);
  });
});

describe("GET /search", () => {
  it("returns search results", async () => {
    mockSearchPlugins.mockResolvedValue([{ name: "wopr-plugin-voice" }]);
    const res = await req("GET", "/search?q=voice");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(mockSearchPlugins).toHaveBeenCalledWith("voice");
  });

  it("returns 400 when q param is missing", async () => {
    const res = await req("GET", "/search");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/required/i);
  });
});

describe("registries", () => {
  it("GET /registries returns list", async () => {
    mockListRegistries.mockResolvedValue([{ name: "npm", url: "https://registry.npmjs.org" }]);
    const res = await req("GET", "/registries");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.registries).toHaveLength(1);
  });

  it("POST /registries adds registry", async () => {
    mockAddRegistry.mockResolvedValue(undefined);
    const res = await req("POST", "/registries", {
      name: "custom",
      url: "https://custom.registry.com",
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.added).toBe(true);
    expect(mockAddRegistry).toHaveBeenCalledWith("https://custom.registry.com", "custom");
  });

  it("POST /registries returns 400 when name or url missing", async () => {
    const res = await req("POST", "/registries", { name: "foo" });
    expect(res.status).toBe(400);
  });

  it("POST /registries returns 400 when both are missing", async () => {
    const res = await req("POST", "/registries", {});
    expect(res.status).toBe(400);
  });

  it("DELETE /registries/:name removes registry", async () => {
    mockListRegistries.mockResolvedValue([{ name: "custom", url: "https://custom.registry.com" }]);
    mockRemoveRegistry.mockResolvedValue(undefined);
    const res = await req("DELETE", "/registries/custom");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.removed).toBe(true);
    expect(mockRemoveRegistry).toHaveBeenCalledWith("https://custom.registry.com");
  });

  it("POST /registries returns 400 when url is missing", async () => {
    const res = await req("POST", "/registries", { url: "https://example.com" });
    expect(res.status).toBe(400);
  });
});

describe("POST /discord/claim", () => {
  it("claims ownership with valid code", async () => {
    mockGetPluginExtension.mockReturnValue({
      claimOwnership: vi.fn().mockResolvedValue({
        success: true,
        userId: "123",
        username: "testuser",
      }),
    });

    const res = await req("POST", "/discord/claim", { code: "abc123" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.userId).toBe("123");
    expect(json.username).toBe("testuser");
  });

  it("returns 400 when code is missing", async () => {
    const res = await req("POST", "/discord/claim", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/code.*required/i);
  });

  it("returns 404 when discord plugin not loaded", async () => {
    mockGetPluginExtension.mockReturnValue(undefined);
    const res = await req("POST", "/discord/claim", { code: "abc" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when claimOwnership not supported", async () => {
    mockGetPluginExtension.mockReturnValue({});
    const res = await req("POST", "/discord/claim", { code: "abc" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/does not support/i);
  });

  it("returns 400 when claim fails", async () => {
    mockGetPluginExtension.mockReturnValue({
      claimOwnership: vi.fn().mockResolvedValue({
        success: false,
        error: "Invalid code",
      }),
    });
    const res = await req("POST", "/discord/claim", { code: "bad" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Invalid code");
  });
});

describe("validatePluginName — edge cases via routes", () => {
  it("rejects empty name", async () => {
    const res = await req("POST", "/uninstall", { name: "" });
    expect(res.status).toBe(400);
  });

  it("rejects name with backtick", async () => {
    const res = await req("POST", "/uninstall", { name: "plugin`evil`" });
    expect(res.status).toBe(400);
  });

  it("rejects name with newline", async () => {
    const res = await req("POST", "/uninstall", { name: "plugin\ninjection" });
    expect(res.status).toBe(400);
  });

  it("accepts scoped npm package name", async () => {
    mockInstallPlugin.mockResolvedValue({ ...SAMPLE_PLUGIN, name: "@wopr/voice" });
    mockEnablePlugin.mockResolvedValue(undefined);
    mockLoadPlugin.mockResolvedValue(undefined);
    const res = await req("POST", "/install", { source: "@wopr/voice" });
    expect(res.status).toBe(201);
  });

  it("accepts name with dots and slashes", async () => {
    mockInstallPlugin.mockResolvedValue({ ...SAMPLE_PLUGIN, name: "org/plugin.v2" });
    mockEnablePlugin.mockResolvedValue(undefined);
    mockLoadPlugin.mockResolvedValue(undefined);
    const res = await req("POST", "/install", { source: "org/plugin.v2" });
    expect(res.status).toBe(201);
  });
});

describe("POST /install — dependency check (WOP-1461)", () => {
  beforeEach(() => {
    mockInstallPlugin.mockResolvedValue(SAMPLE_PLUGIN);
    mockEnablePlugin.mockResolvedValue(undefined);
    mockLoadPlugin.mockResolvedValue(undefined);
  });

  it("returns 201 when plugin has no dependencies", async () => {
    mockReadPluginManifest.mockReturnValue({ dependencies: [] });
    mockCheckPluginDependencies.mockReturnValue({ ok: true, missing: [] });
    const res = await req("POST", "/install", { source: "test-plugin" });
    expect(res.status).toBe(201);
  });

  it("returns 422 when required dependency is not installed and removes orphaned artifact", async () => {
    mockReadPluginManifest.mockReturnValue({
      dependencies: ["@wopr-network/plugin-discord"],
    });
    mockCheckPluginDependencies.mockReturnValue({ ok: false, missing: ["discord"] });
    mockRemovePlugin.mockResolvedValue(true);
    const res = await req("POST", "/install", { source: "meeting-transcriber" });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/Missing required dependencies/);
    expect(json.missingDependencies).toEqual(["discord"]);
    // Rollback: the orphaned artifact must be removed
    expect(mockRemovePlugin).toHaveBeenCalledWith(SAMPLE_PLUGIN.name);
  });

  it("returns 201 when all dependencies are already installed", async () => {
    mockReadPluginManifest.mockReturnValue({
      dependencies: ["@wopr-network/plugin-discord"],
    });
    mockGetInstalledPlugins.mockResolvedValue([
      { ...SAMPLE_PLUGIN, name: "discord" },
    ]);
    mockCheckPluginDependencies.mockReturnValue({ ok: true, missing: [] });
    const res = await req("POST", "/install", { source: "meeting-transcriber" });
    expect(res.status).toBe(201);
  });

  it("skips dep check when manifest has no dependencies field", async () => {
    mockReadPluginManifest.mockReturnValue({ capabilities: ["chat"] });
    const res = await req("POST", "/install", { source: "test-plugin" });
    expect(res.status).toBe(201);
    expect(mockCheckPluginDependencies).not.toHaveBeenCalled();
  });
});

describe("GET /:name/check-deps (WOP-1461)", () => {
  it("returns 400 for invalid plugin name", async () => {
    const res = await req("GET", "/plugin;evil/check-deps");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid plugin name/);
  });

  it("returns 404 when plugin not found", async () => {
    mockListPlugins.mockResolvedValue([]);
    const res = await req("GET", "/unknown-plugin/check-deps");
    expect(res.status).toBe(404);
  });

  it("returns ok:true with empty missing for plugin with no deps", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockReadPluginManifest.mockReturnValue({ capabilities: ["chat"] });
    mockGetInstalledPlugins.mockResolvedValue([]);
    mockCheckPluginDependencies.mockReturnValue({ ok: true, missing: [] });
    const res = await req("GET", "/test-plugin/check-deps");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.missing).toEqual([]);
  });

  it("returns ok:false with missing deps when dependency not installed", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockReadPluginManifest.mockReturnValue({
      dependencies: ["@wopr-network/plugin-discord"],
    });
    mockGetInstalledPlugins.mockResolvedValue([]);
    mockCheckPluginDependencies.mockReturnValue({ ok: false, missing: ["discord"] });
    const res = await req("GET", "/test-plugin/check-deps");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.missing).toEqual(["discord"]);
  });

  it("returns ok:true when all deps are installed", async () => {
    mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
    mockReadPluginManifest.mockReturnValue({
      dependencies: ["@wopr-network/plugin-discord"],
    });
    mockGetInstalledPlugins.mockResolvedValue([{ ...SAMPLE_PLUGIN, name: "discord" }]);
    mockCheckPluginDependencies.mockReturnValue({ ok: true, missing: [] });
    const res = await req("GET", "/test-plugin/check-deps");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});

// ── Admin authorization tests (WOP-1710) ─────────────────────────────────
describe("admin authorization (WOP-1710)", () => {
  const mutatingRoutes = [
    { method: "POST", path: "/", body: { source: "test-plugin" } },
    { method: "POST", path: "/install", body: { source: "test-plugin" } },
    { method: "POST", path: "/uninstall", body: { name: "test-plugin" } },
    { method: "DELETE", path: "/test-plugin" },
    { method: "POST", path: "/test-plugin/enable" },
    { method: "POST", path: "/test-plugin/disable" },
    { method: "POST", path: "/test-plugin/reload" },
    { method: "PUT", path: "/test-plugin/config", body: { config: {} } },
    { method: "POST", path: "/registries", body: { name: "r", url: "http://example.com" } },
    { method: "DELETE", path: "/registries/test" },
  ];

  for (const route of mutatingRoutes) {
    it(`calls requireAdmin() for ${route.method} ${route.path}`, async () => {
      // Configure the mock to reject with 403
      mockRequireAdminHandler.mockImplementationOnce(async (c: any) => {
        return c.json({ error: "Forbidden: admin access required" }, 403);
      });

      const res = await req(route.method, route.path, route.body);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("admin");
    });
  }

  const readOnlyRoutes = [
    { method: "GET", path: "/" },
    { method: "GET", path: "/available" },
    { method: "GET", path: "/ui" },
    { method: "GET", path: "/components" },
    { method: "GET", path: "/search?q=test" },
    { method: "GET", path: "/registries" },
    { method: "GET", path: "/test-plugin/state" },
    { method: "GET", path: "/test-plugin/health" },
  ];

  for (const route of readOnlyRoutes) {
    it(`does NOT require admin for ${route.method} ${route.path}`, async () => {
      // Reset to passthrough
      mockRequireAdminHandler.mockImplementation(async (_c: unknown, next: () => Promise<void>) => next());

      // Set up minimal mocks so the routes don't error
      mockListPlugins.mockResolvedValue([SAMPLE_PLUGIN]);
      mockGetAllPluginManifests.mockReturnValue(new Map());
      mockSearchPlugins.mockResolvedValue([]);
      mockGetWebUiExtensions.mockReturnValue([]);
      mockGetUiComponents.mockReturnValue([]);
      mockListRegistries.mockResolvedValue([]);
      mockGetPluginState.mockReturnValue("loaded");
      mockGetLoadedPlugin.mockReturnValue({});
      mockReadPluginManifest.mockReturnValue(null);

      const res = await req(route.method, route.path);
      // Should NOT be 403
      expect(res.status).not.toBe(403);
    });
  }
});
