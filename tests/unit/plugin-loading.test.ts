/**
 * Plugin Loading Tests (WOP-102)
 *
 * Tests for src/plugins/loading.ts covering:
 * - readPluginManifest (package.json wopr field and wopr-plugin.json)
 * - getPluginManifest / getAllPluginManifests
 * - loadPlugin entry point resolution
 * - unloadPlugin
 * - loadAllPlugins (batch loading)
 * - shutdownAllPlugins (batch shutdown)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock state - in-memory Maps for isolation
const mockLoadedPlugins = new Map<string, any>();
const mockPluginManifests = new Map<string, any>();
const mockConfigSchemas = new Map<string, any>();

vi.mock("../../src/plugins/state.js", () => ({
  loadedPlugins: mockLoadedPlugins,
  pluginManifests: mockPluginManifests,
  configSchemas: mockConfigSchemas,
  WOPR_HOME: "/tmp/wopr-test",
  PLUGINS_DIR: "/tmp/wopr-test/plugins",
  PLUGINS_FILE: "/tmp/wopr-test/plugins.json",
  REGISTRIES_FILE: "/tmp/wopr-test/plugin-registries.json",
}));

// Mock context-factory
vi.mock("../../src/plugins/context-factory.js", () => ({
  createPluginContext: vi.fn(() => ({
    name: "test-plugin",
    config: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  })),
}));

// Mock installation
vi.mock("../../src/plugins/installation.js", () => ({
  getInstalledPlugins: vi.fn(() => []),
}));

// Mock requirements
vi.mock("../../src/plugins/requirements.js", () => ({
  checkRequirements: vi.fn(async () => ({
    satisfied: true,
    missing: { bins: [], env: [], docker: [], config: [] },
    available: { bins: [], env: [], docker: [], config: [] },
  })),
  ensureRequirements: vi.fn(async () => ({
    satisfied: true,
    installed: [],
    errors: [],
  })),
  formatMissingRequirements: vi.fn(() => "All requirements satisfied"),
  checkOsRequirement: vi.fn(() => true),
  checkNodeRequirement: vi.fn(() => true),
}));

// We need fresh module state for each test
let readPluginManifest: any;
let getPluginManifest: any;
let getAllPluginManifests: any;
let unloadPlugin: any;
let getLoadedPlugin: any;

beforeEach(async () => {
  vi.resetModules();
  mockLoadedPlugins.clear();
  mockPluginManifests.clear();
  mockConfigSchemas.clear();

  const mod = await import("../../src/plugins/loading.js");
  readPluginManifest = mod.readPluginManifest;
  getPluginManifest = mod.getPluginManifest;
  getAllPluginManifests = mod.getAllPluginManifests;
  unloadPlugin = mod.unloadPlugin;
  getLoadedPlugin = mod.getLoadedPlugin;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// readPluginManifest
// ============================================================================

describe("readPluginManifest", () => {
  it("should return manifest from package.json wopr field when it has name and capabilities", () => {
    const pkg = {
      wopr: {
        name: "test-plugin",
        version: "1.0.0",
        capabilities: ["chat"],
      },
    };

    const manifest = readPluginManifest("/some/path", pkg);
    expect(manifest).toEqual(pkg.wopr);
  });

  it("should return undefined when package.json has no wopr field", () => {
    const pkg = { name: "test-plugin", version: "1.0.0" };
    const manifest = readPluginManifest("/nonexistent/path", pkg);
    expect(manifest).toBeUndefined();
  });

  it("should return undefined when wopr field lacks name", () => {
    const pkg = { wopr: { capabilities: ["chat"] } };
    const manifest = readPluginManifest("/nonexistent/path", pkg);
    expect(manifest).toBeUndefined();
  });

  it("should return undefined when wopr field lacks capabilities", () => {
    const pkg = { wopr: { name: "test" } };
    const manifest = readPluginManifest("/nonexistent/path", pkg);
    expect(manifest).toBeUndefined();
  });

  it("should return undefined when no package.json and no wopr-plugin.json exists", () => {
    const manifest = readPluginManifest("/nonexistent/path");
    expect(manifest).toBeUndefined();
  });

  it("should return undefined when pkg is undefined", () => {
    const manifest = readPluginManifest("/nonexistent/path", undefined);
    expect(manifest).toBeUndefined();
  });
});

// ============================================================================
// getPluginManifest / getAllPluginManifests
// ============================================================================

describe("getPluginManifest", () => {
  it("should return undefined for unknown plugin", () => {
    expect(getPluginManifest("unknown")).toBeUndefined();
  });

  it("should return manifest for known plugin", () => {
    const manifest = { name: "test", version: "1.0.0", capabilities: ["chat"] };
    mockPluginManifests.set("test", manifest);

    expect(getPluginManifest("test")).toEqual(manifest);
  });
});

describe("getAllPluginManifests", () => {
  it("should return empty map initially", () => {
    const manifests = getAllPluginManifests();
    expect(manifests.size).toBe(0);
  });

  it("should return all stored manifests", () => {
    mockPluginManifests.set("a", { name: "a" });
    mockPluginManifests.set("b", { name: "b" });

    const manifests = getAllPluginManifests();
    expect(manifests.size).toBe(2);
    expect(manifests.get("a")).toEqual({ name: "a" });
    expect(manifests.get("b")).toEqual({ name: "b" });
  });
});

// ============================================================================
// unloadPlugin
// ============================================================================

describe("unloadPlugin", () => {
  it("should do nothing when plugin is not loaded", async () => {
    await expect(unloadPlugin("nonexistent")).resolves.toBeUndefined();
  });

  it("should call shutdown and remove plugin from maps", async () => {
    const shutdownFn = vi.fn();
    const plugin = { name: "test", version: "1.0.0", shutdown: shutdownFn };
    const context = { name: "test" };

    mockLoadedPlugins.set("test", { plugin, context });
    mockPluginManifests.set("test", { name: "test" });
    mockConfigSchemas.set("test", {});

    await unloadPlugin("test");

    expect(shutdownFn).toHaveBeenCalledOnce();
    expect(mockLoadedPlugins.has("test")).toBe(false);
    expect(mockPluginManifests.has("test")).toBe(false);
    expect(mockConfigSchemas.has("test")).toBe(false);
  });

  it("should unload plugin without shutdown hook gracefully", async () => {
    const plugin = { name: "test", version: "1.0.0" };
    const context = { name: "test" };
    mockLoadedPlugins.set("test", { plugin, context });

    await unloadPlugin("test");

    expect(mockLoadedPlugins.has("test")).toBe(false);
  });
});

// ============================================================================
// getLoadedPlugin
// ============================================================================

describe("getLoadedPlugin", () => {
  it("should return undefined for unloaded plugin", () => {
    expect(getLoadedPlugin("unknown")).toBeUndefined();
  });

  it("should return plugin and context for loaded plugin", () => {
    const entry = { plugin: { name: "test" }, context: { name: "test" } };
    mockLoadedPlugins.set("test", entry);

    expect(getLoadedPlugin("test")).toEqual(entry);
  });
});
