/**
 * Plugin Loading, Registry, and Requirements Tests (WOP-102)
 *
 * Tests for:
 * - plugins/requirements.ts: binary/env/docker/config checks, OS/Node validation
 * - plugins/registry.ts: registry CRUD, plugin search/discovery
 * - plugins/loading.ts: manifest reading, plugin load/unload lifecycle
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ============================================================================
// Shared test directory
// ============================================================================

const TEST_DIR = join(tmpdir(), "wopr-plugins-test");

// ============================================================================
// Mock state module to use temp directory
// ============================================================================

vi.mock("../../src/plugins/state.js", () => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const dir = join(tmpdir(), "wopr-plugins-test");
  return {
    WOPR_HOME: dir,
    PLUGINS_DIR: join(dir, "plugins"),
    PLUGINS_FILE: join(dir, "plugins.json"),
    REGISTRIES_FILE: join(dir, "plugin-registries.json"),
    loadedPlugins: new Map(),
    contextProviders: new Map(),
    channelAdapters: new Map(),
    webUiExtensions: new Map(),
    uiComponents: new Map(),
    providerPlugins: new Map(),
    configSchemas: new Map(),
    pluginManifests: new Map(),
    pluginExtensions: new Map(),
    channelKey: (ch: { type: string; id: string }) => `${ch.type}:${ch.id}`,
  };
});

// Mock logger to suppress output
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock node:sqlite (used by some transitive imports)
vi.mock("node:sqlite", () => ({
  DatabaseSync: vi.fn(),
}));

// ============================================================================
// requirements.ts tests
// ============================================================================

describe("plugins/requirements.ts", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // Import after mocks
  let requirements: typeof import("../../src/plugins/requirements.js");

  beforeEach(async () => {
    requirements = await import("../../src/plugins/requirements.js");
  });

  // --------------------------------------------------------------------------
  // hasBinary
  // --------------------------------------------------------------------------
  describe("hasBinary", () => {
    it("should find node binary in PATH", () => {
      expect(requirements.hasBinary("node")).toBe(true);
    });

    it("should return false for non-existent binary", () => {
      expect(requirements.hasBinary("nonexistent-binary-xyz-123")).toBe(false);
    });

    it("should return false when PATH is empty", () => {
      const origPath = process.env.PATH;
      process.env.PATH = "";
      expect(requirements.hasBinary("node")).toBe(false);
      process.env.PATH = origPath;
    });
  });

  // --------------------------------------------------------------------------
  // whichBinary
  // --------------------------------------------------------------------------
  describe("whichBinary", () => {
    it("should return path for existing binary", () => {
      const result = requirements.whichBinary("node");
      expect(result).not.toBeNull();
      expect(result).toContain("node");
    });

    it("should return null for non-existent binary", () => {
      expect(requirements.whichBinary("nonexistent-binary-xyz-123")).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // hasEnv
  // --------------------------------------------------------------------------
  describe("hasEnv", () => {
    it("should return true for set environment variable", () => {
      process.env.WOPR_TEST_VAR = "hello";
      expect(requirements.hasEnv("WOPR_TEST_VAR")).toBe(true);
      delete process.env.WOPR_TEST_VAR;
    });

    it("should return false for unset environment variable", () => {
      delete process.env.WOPR_TEST_UNSET_VAR;
      expect(requirements.hasEnv("WOPR_TEST_UNSET_VAR")).toBe(false);
    });

    it("should return false for empty environment variable", () => {
      process.env.WOPR_TEST_EMPTY = "   ";
      expect(requirements.hasEnv("WOPR_TEST_EMPTY")).toBe(false);
      delete process.env.WOPR_TEST_EMPTY;
    });
  });

  // --------------------------------------------------------------------------
  // checkOsRequirement
  // --------------------------------------------------------------------------
  describe("checkOsRequirement", () => {
    it("should return true when no OS requirement specified", () => {
      expect(requirements.checkOsRequirement(undefined)).toBe(true);
    });

    it("should return true for empty array", () => {
      expect(requirements.checkOsRequirement([])).toBe(true);
    });

    it("should return true when current platform is in list", () => {
      expect(requirements.checkOsRequirement([process.platform as "linux" | "darwin" | "win32"])).toBe(true);
    });

    it("should return false when current platform is not in list", () => {
      // Use platforms that are definitely not the current one
      const otherPlatforms = (["linux", "darwin", "win32"] as const).filter((p) => p !== process.platform);
      expect(requirements.checkOsRequirement([otherPlatforms[0]])).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // checkNodeRequirement
  // --------------------------------------------------------------------------
  describe("checkNodeRequirement", () => {
    it("should return true when no requirement specified", () => {
      expect(requirements.checkNodeRequirement(undefined)).toBe(true);
    });

    it("should return true for a very low version requirement", () => {
      expect(requirements.checkNodeRequirement(">=1.0.0")).toBe(true);
    });

    it("should return false for a very high version requirement", () => {
      expect(requirements.checkNodeRequirement(">=999.0.0")).toBe(false);
    });

    it("should return true for unparseable range", () => {
      expect(requirements.checkNodeRequirement("^18.0.0")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // resolveConfigPath / isConfigPathTruthy
  // --------------------------------------------------------------------------
  describe("resolveConfigPath", () => {
    it("should resolve top-level config key", () => {
      expect(requirements.resolveConfigPath({ foo: "bar" }, "foo")).toBe("bar");
    });

    it("should resolve nested dot-notation path", () => {
      expect(requirements.resolveConfigPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
    });

    it("should return undefined for missing path", () => {
      expect(requirements.resolveConfigPath({ a: 1 }, "b")).toBeUndefined();
    });

    it("should return undefined for undefined config", () => {
      expect(requirements.resolveConfigPath(undefined, "anything")).toBeUndefined();
    });

    it("should return undefined when intermediate is not object", () => {
      expect(requirements.resolveConfigPath({ a: "string" }, "a.b")).toBeUndefined();
    });
  });

  describe("isConfigPathTruthy", () => {
    it("should return true for truthy string", () => {
      expect(requirements.isConfigPathTruthy({ key: "value" }, "key")).toBe(true);
    });

    it("should return false for empty string", () => {
      expect(requirements.isConfigPathTruthy({ key: "" }, "key")).toBe(false);
    });

    it("should return false for zero", () => {
      expect(requirements.isConfigPathTruthy({ key: 0 }, "key")).toBe(false);
    });

    it("should return true for non-zero number", () => {
      expect(requirements.isConfigPathTruthy({ key: 42 }, "key")).toBe(true);
    });

    it("should return true for boolean true", () => {
      expect(requirements.isConfigPathTruthy({ key: true }, "key")).toBe(true);
    });

    it("should return false for boolean false", () => {
      expect(requirements.isConfigPathTruthy({ key: false }, "key")).toBe(false);
    });

    it("should return false for null", () => {
      expect(requirements.isConfigPathTruthy({ key: null }, "key")).toBe(false);
    });

    it("should return true for object (truthy)", () => {
      expect(requirements.isConfigPathTruthy({ key: {} }, "key")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // checkRequirements
  // --------------------------------------------------------------------------
  describe("checkRequirements", () => {
    it("should return satisfied when no requirements given", async () => {
      const result = await requirements.checkRequirements(undefined);
      expect(result.satisfied).toBe(true);
      expect(result.missing.bins).toEqual([]);
    });

    it("should detect available binary", async () => {
      const result = await requirements.checkRequirements({ bins: ["node"] });
      expect(result.satisfied).toBe(true);
      expect(result.available.bins).toContain("node");
    });

    it("should detect missing binary", async () => {
      const result = await requirements.checkRequirements({ bins: ["nonexistent-xyz"] });
      expect(result.satisfied).toBe(false);
      expect(result.missing.bins).toContain("nonexistent-xyz");
    });

    it("should detect available env var", async () => {
      process.env.WOPR_TEST_CHECK = "yes";
      const result = await requirements.checkRequirements({ env: ["WOPR_TEST_CHECK"] });
      expect(result.satisfied).toBe(true);
      expect(result.available.env).toContain("WOPR_TEST_CHECK");
      delete process.env.WOPR_TEST_CHECK;
    });

    it("should detect missing env var", async () => {
      delete process.env.WOPR_MISSING_VAR;
      const result = await requirements.checkRequirements({ env: ["WOPR_MISSING_VAR"] });
      expect(result.satisfied).toBe(false);
      expect(result.missing.env).toContain("WOPR_MISSING_VAR");
    });

    it("should check config paths", async () => {
      const config = { provider: { apiKey: "sk-123" } };
      const result = await requirements.checkRequirements({ config: ["provider.apiKey"] }, config);
      expect(result.satisfied).toBe(true);
      expect(result.available.config).toContain("provider.apiKey");
    });

    it("should detect missing config path", async () => {
      const result = await requirements.checkRequirements({ config: ["missing.key"] }, {});
      expect(result.satisfied).toBe(false);
      expect(result.missing.config).toContain("missing.key");
    });
  });

  // --------------------------------------------------------------------------
  // formatMissingRequirements
  // --------------------------------------------------------------------------
  describe("formatMissingRequirements", () => {
    it("should format missing bins", () => {
      const check = {
        satisfied: false,
        missing: { bins: ["ffmpeg", "sox"], env: [], docker: [], config: [] },
        available: { bins: [], env: [], docker: [], config: [] },
      };
      const msg = requirements.formatMissingRequirements(check);
      expect(msg).toContain("ffmpeg");
      expect(msg).toContain("sox");
      expect(msg).toContain("Binaries");
    });

    it("should return all-satisfied message when nothing missing", () => {
      const check = {
        satisfied: true,
        missing: { bins: [], env: [], docker: [], config: [] },
        available: { bins: ["node"], env: [], docker: [], config: [] },
      };
      const msg = requirements.formatMissingRequirements(check);
      expect(msg).toContain("All requirements satisfied");
    });

    it("should format multiple categories", () => {
      const check = {
        satisfied: false,
        missing: { bins: ["docker"], env: ["API_KEY"], docker: ["myimage:latest"], config: ["x.y"] },
        available: { bins: [], env: [], docker: [], config: [] },
      };
      const msg = requirements.formatMissingRequirements(check);
      expect(msg).toContain("Binaries");
      expect(msg).toContain("Environment");
      expect(msg).toContain("Docker images");
      expect(msg).toContain("Config");
    });
  });
});

// ============================================================================
// registry.ts tests
// ============================================================================

describe("plugins/registry.ts", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "plugins"), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  let registry: typeof import("../../src/plugins/registry.js");

  beforeEach(async () => {
    registry = await import("../../src/plugins/registry.js");
  });

  // --------------------------------------------------------------------------
  // Registry CRUD
  // --------------------------------------------------------------------------
  describe("getPluginRegistries", () => {
    it("should return empty array when no registries file exists", () => {
      const result = registry.getPluginRegistries();
      expect(result).toEqual([]);
    });

    it("should read registries from file", () => {
      const entries = [
        { url: "https://registry.example.com", name: "example", enabled: true, lastSync: 0 },
      ];
      writeFileSync(join(TEST_DIR, "plugin-registries.json"), JSON.stringify(entries));

      const result = registry.getPluginRegistries();
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://registry.example.com");
      expect(result[0].name).toBe("example");
    });
  });

  describe("addRegistry", () => {
    it("should add a new registry entry", () => {
      // Ensure file exists (addRegistry reads then writes)
      writeFileSync(join(TEST_DIR, "plugin-registries.json"), "[]");

      const entry = registry.addRegistry("https://plugins.wopr.dev", "wopr-official");
      expect(entry.url).toBe("https://plugins.wopr.dev");
      expect(entry.name).toBe("wopr-official");
      expect(entry.enabled).toBe(true);

      // Verify persisted
      const all = registry.getPluginRegistries();
      expect(all).toHaveLength(1);
    });

    it("should auto-generate name from URL hostname", () => {
      writeFileSync(join(TEST_DIR, "plugin-registries.json"), "[]");

      const entry = registry.addRegistry("https://registry.example.com/plugins");
      expect(entry.name).toBe("registry.example.com");
    });
  });

  describe("removeRegistry", () => {
    it("should remove a registry by URL", () => {
      const entries = [
        { url: "https://a.com", name: "a", enabled: true, lastSync: 0 },
        { url: "https://b.com", name: "b", enabled: true, lastSync: 0 },
      ];
      writeFileSync(join(TEST_DIR, "plugin-registries.json"), JSON.stringify(entries));

      const removed = registry.removeRegistry("https://a.com");
      expect(removed).toBe(true);

      const remaining = registry.getPluginRegistries();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].url).toBe("https://b.com");
    });

    it("should return false when URL not found", () => {
      writeFileSync(join(TEST_DIR, "plugin-registries.json"), "[]");

      const removed = registry.removeRegistry("https://nonexistent.com");
      expect(removed).toBe(false);
    });
  });

  describe("listRegistries", () => {
    it("should be an alias for getPluginRegistries", () => {
      const entries = [{ url: "https://x.com", name: "x", enabled: true, lastSync: 0 }];
      writeFileSync(join(TEST_DIR, "plugin-registries.json"), JSON.stringify(entries));

      const result = registry.listRegistries();
      expect(result).toEqual(registry.getPluginRegistries());
    });
  });

  // --------------------------------------------------------------------------
  // searchPlugins — tests installed plugins path (gh/npm are external)
  // --------------------------------------------------------------------------
  describe("searchPlugins", () => {
    it("should find installed plugins matching query", async () => {
      const plugins = [
        { name: "wopr-plugin-discord", version: "1.0.0", source: "bundled", path: "/app/plugins/discord", enabled: true, installedAt: 0 },
        { name: "wopr-plugin-slack", version: "1.0.0", source: "bundled", path: "/app/plugins/slack", enabled: true, installedAt: 0 },
      ];
      writeFileSync(join(TEST_DIR, "plugins.json"), JSON.stringify(plugins));

      const results = await registry.searchPlugins("discord");
      expect(results.some((r) => r.name === "wopr-plugin-discord")).toBe(true);
      expect(results.find((r) => r.name === "wopr-plugin-discord")?.installed).toBe(true);
    });

    it("should return all installed plugins with empty query", async () => {
      const plugins = [
        { name: "wopr-plugin-a", version: "1.0.0", source: "local", path: "/a", enabled: true, installedAt: 0 },
        { name: "wopr-plugin-b", version: "2.0.0", source: "local", path: "/b", enabled: true, installedAt: 0 },
      ];
      writeFileSync(join(TEST_DIR, "plugins.json"), JSON.stringify(plugins));

      const results = await registry.searchPlugins("");
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ============================================================================
// loading.ts tests
// ============================================================================

describe("plugins/loading.ts", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "plugins"), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  let loading: typeof import("../../src/plugins/loading.js");
  let stateModule: typeof import("../../src/plugins/state.js");

  beforeEach(async () => {
    loading = await import("../../src/plugins/loading.js");
    stateModule = await import("../../src/plugins/state.js");
    // Clear shared state between tests
    stateModule.loadedPlugins.clear();
    stateModule.pluginManifests.clear();
    stateModule.configSchemas.clear();
  });

  // --------------------------------------------------------------------------
  // readPluginManifest
  // --------------------------------------------------------------------------
  describe("readPluginManifest", () => {
    it("should read manifest from package.json wopr field", () => {
      const pkg = {
        wopr: {
          name: "test-plugin",
          version: "1.0.0",
          capabilities: ["provider"],
          description: "A test plugin",
        },
      };
      const result = loading.readPluginManifest("/fake/path", pkg);
      expect(result).toBeDefined();
      expect(result?.name).toBe("test-plugin");
      expect(result?.capabilities).toContain("provider");
    });

    it("should return undefined when package.json has no wopr field", () => {
      const result = loading.readPluginManifest("/nonexistent/path", { name: "some-package" });
      expect(result).toBeUndefined();
    });

    it("should return undefined when wopr field lacks name or capabilities", () => {
      const pkg = { wopr: { plugin: { description: "no manifest fields" } } };
      const result = loading.readPluginManifest("/fake/path", pkg);
      expect(result).toBeUndefined();
    });

    it("should read manifest from wopr-plugin.json file", () => {
      const pluginDir = join(TEST_DIR, "test-plugin");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "wopr-plugin.json"),
        JSON.stringify({
          name: "file-manifest-plugin",
          version: "2.0.0",
          capabilities: ["channel"],
        }),
      );

      const result = loading.readPluginManifest(pluginDir, {});
      expect(result).toBeDefined();
      expect(result?.name).toBe("file-manifest-plugin");
    });

    it("should prefer package.json wopr field over wopr-plugin.json", () => {
      const pluginDir = join(TEST_DIR, "dual-manifest");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "wopr-plugin.json"),
        JSON.stringify({ name: "from-file", capabilities: ["channel"] }),
      );

      const pkg = { wopr: { name: "from-pkg", capabilities: ["provider"], version: "1.0.0" } };
      const result = loading.readPluginManifest(pluginDir, pkg);
      expect(result?.name).toBe("from-pkg");
    });

    it("should handle malformed wopr-plugin.json gracefully", () => {
      const pluginDir = join(TEST_DIR, "bad-manifest");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "wopr-plugin.json"), "not valid json{{{");

      const result = loading.readPluginManifest(pluginDir, {});
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getPluginManifest / getAllPluginManifests
  // --------------------------------------------------------------------------
  describe("getPluginManifest", () => {
    it("should return undefined for non-existent plugin", () => {
      expect(loading.getPluginManifest("nonexistent")).toBeUndefined();
    });

    it("should return manifest after it has been stored", () => {
      const manifest = { name: "test", version: "1.0.0", capabilities: ["provider"] as any };
      stateModule.pluginManifests.set("test", manifest);

      expect(loading.getPluginManifest("test")).toBe(manifest);
    });
  });

  describe("getAllPluginManifests", () => {
    it("should return the manifests map", () => {
      const result = loading.getAllPluginManifests();
      expect(result).toBeInstanceOf(Map);
    });
  });

  // --------------------------------------------------------------------------
  // unloadPlugin
  // --------------------------------------------------------------------------
  describe("unloadPlugin", () => {
    it("should do nothing for non-loaded plugin", async () => {
      await expect(loading.unloadPlugin("nonexistent")).resolves.toBeUndefined();
    });

    it("should call shutdown and remove from maps", async () => {
      const shutdownFn = vi.fn();
      const fakePlugin = { name: "test", version: "1.0.0", shutdown: shutdownFn };
      const fakeContext = {} as any;

      stateModule.loadedPlugins.set("test", { plugin: fakePlugin, context: fakeContext });
      stateModule.pluginManifests.set("test", { name: "test", version: "1.0.0", capabilities: [] } as any);
      stateModule.configSchemas.set("test", { title: "Test", description: "", fields: [] });

      await loading.unloadPlugin("test");

      expect(shutdownFn).toHaveBeenCalledOnce();
      expect(stateModule.loadedPlugins.has("test")).toBe(false);
      expect(stateModule.pluginManifests.has("test")).toBe(false);
      expect(stateModule.configSchemas.has("test")).toBe(false);
    });

    it("should handle plugins without shutdown method", async () => {
      const fakePlugin = { name: "no-shutdown", version: "1.0.0" };
      stateModule.loadedPlugins.set("no-shutdown", { plugin: fakePlugin, context: {} as any });

      await expect(loading.unloadPlugin("no-shutdown")).resolves.toBeUndefined();
      expect(stateModule.loadedPlugins.has("no-shutdown")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getLoadedPlugin
  // --------------------------------------------------------------------------
  describe("getLoadedPlugin", () => {
    it("should return undefined for non-loaded plugin", () => {
      expect(loading.getLoadedPlugin("nope")).toBeUndefined();
    });

    it("should return plugin and context for loaded plugin", () => {
      const entry = { plugin: { name: "x", version: "1.0.0" }, context: {} as any };
      stateModule.loadedPlugins.set("x", entry);

      const result = loading.getLoadedPlugin("x");
      expect(result).toBe(entry);
    });
  });

  // --------------------------------------------------------------------------
  // loadAllPlugins — with mocked getInstalledPlugins
  // --------------------------------------------------------------------------
  describe("loadAllPlugins", () => {
    it("should skip disabled plugins", async () => {
      const plugins = [
        { name: "disabled-plugin", version: "1.0.0", source: "local", path: "/fake", enabled: false, installedAt: 0 },
      ];
      writeFileSync(join(TEST_DIR, "plugins.json"), JSON.stringify(plugins));

      const injectors = { inject: vi.fn(), getSessions: vi.fn().mockReturnValue([]) };
      await loading.loadAllPlugins(injectors, { skipRequirementsCheck: true });

      expect(stateModule.loadedPlugins.size).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // shutdownAllPlugins
  // --------------------------------------------------------------------------
  describe("shutdownAllPlugins", () => {
    it("should shutdown and clear all loaded plugins", async () => {
      const shutdown1 = vi.fn();
      const shutdown2 = vi.fn();

      stateModule.loadedPlugins.set("p1", {
        plugin: { name: "p1", version: "1.0.0", shutdown: shutdown1 },
        context: {} as any,
      });
      stateModule.loadedPlugins.set("p2", {
        plugin: { name: "p2", version: "1.0.0", shutdown: shutdown2 },
        context: {} as any,
      });

      await loading.shutdownAllPlugins();

      expect(shutdown1).toHaveBeenCalledOnce();
      expect(shutdown2).toHaveBeenCalledOnce();
      expect(stateModule.loadedPlugins.size).toBe(0);
    });

    it("should handle shutdown errors gracefully", async () => {
      stateModule.loadedPlugins.set("bad", {
        plugin: {
          name: "bad",
          version: "1.0.0",
          shutdown: vi.fn().mockRejectedValue(new Error("shutdown failed")),
        },
        context: {} as any,
      });

      // Should not throw
      await expect(loading.shutdownAllPlugins()).resolves.toBeUndefined();
    });
  });
});
