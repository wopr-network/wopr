/**
 * Tests for src/plugins/bootstrap.ts (WOP-1327)
 *
 * Covers:
 * - parsePluginEnvVars: parsing, deduplication, trimming, empty values
 * - bootstrapEnvPlugins: install/skip/fail logic, idempotency
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger before importing
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock plugin-storage (no real DB)
vi.mock("../../src/plugins/plugin-storage.js", () => ({
  ensurePluginSchema: vi.fn(),
  getPluginRepo: vi.fn(() => ({
    findMany: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    insert: vi.fn(),
    update: vi.fn(),
  })),
  getRegistryRepo: vi.fn(),
}));

// Mock state.js
vi.mock("../../src/plugins/state.js", () => ({
  WOPR_HOME: "/tmp/wopr-test",
  PLUGINS_DIR: "/tmp/wopr-test/plugins",
  PLUGINS_FILE: "/tmp/wopr-test/plugins.json",
  REGISTRIES_FILE: "/tmp/wopr-test/plugin-registries.json",
  loadedPlugins: new Map(),
  pluginManifests: new Map(),
  configSchemas: new Map(),
  pluginStates: new Map(),
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => Buffer.from("")),
  spawnSync: vi.fn(),
}));

// Mock installation module for bootstrapEnvPlugins tests
vi.mock("../../src/plugins/installation.js", () => ({
  installPlugin: vi.fn(async (name: string) => ({
    name,
    version: "1.0.0",
    path: `/tmp/plugins/${name}`,
    enabled: false,
    installedAt: Date.now(),
    source: "npm",
  })),
  enablePlugin: vi.fn(async () => true),
  listPlugins: vi.fn(async () => []),
  getInstalledPlugins: vi.fn(async () => []),
  addInstalledPlugin: vi.fn(),
}));

import { bootstrapEnvPlugins, parsePluginEnvVars } from "../../src/plugins/bootstrap.js";
import { enablePlugin, installPlugin, listPlugins } from "../../src/plugins/installation.js";

describe("parsePluginEnvVars", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WOPR_PLUGINS_CHANNELS;
    delete process.env.WOPR_PLUGINS_PROVIDERS;
    delete process.env.WOPR_PLUGINS_VOICE;
    delete process.env.WOPR_PLUGINS_OTHER;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return empty array when no env vars set", () => {
    expect(parsePluginEnvVars()).toEqual([]);
  });

  it("should parse comma-separated plugin names from all four env vars", () => {
    process.env.WOPR_PLUGINS_CHANNELS = "discord,telegram";
    process.env.WOPR_PLUGINS_PROVIDERS = "openrouter";
    process.env.WOPR_PLUGINS_VOICE = "elevenlabs";
    process.env.WOPR_PLUGINS_OTHER = "";
    const result = parsePluginEnvVars();
    expect(result).toEqual(["discord", "telegram", "openrouter", "elevenlabs"]);
  });

  it("should deduplicate plugin names across env vars", () => {
    process.env.WOPR_PLUGINS_CHANNELS = "discord";
    process.env.WOPR_PLUGINS_OTHER = "discord";
    const result = parsePluginEnvVars();
    expect(result).toEqual(["discord"]);
  });

  it("should trim whitespace from plugin names", () => {
    process.env.WOPR_PLUGINS_CHANNELS = " discord , telegram ";
    const result = parsePluginEnvVars();
    expect(result).toEqual(["discord", "telegram"]);
  });

  it("should skip empty strings from trailing commas", () => {
    process.env.WOPR_PLUGINS_CHANNELS = "discord,,telegram,";
    const result = parsePluginEnvVars();
    expect(result).toEqual(["discord", "telegram"]);
  });
});

describe("bootstrapEnvPlugins", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WOPR_PLUGINS_CHANNELS;
    delete process.env.WOPR_PLUGINS_PROVIDERS;
    delete process.env.WOPR_PLUGINS_VOICE;
    delete process.env.WOPR_PLUGINS_OTHER;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return empty result when no env vars set", async () => {
    const result = await bootstrapEnvPlugins();
    expect(result).toEqual({ installed: [], skipped: [], failed: [] });
    expect(installPlugin).not.toHaveBeenCalled();
  });

  it("should install and enable plugins not already present", async () => {
    process.env.WOPR_PLUGINS_CHANNELS = "discord";
    vi.mocked(listPlugins).mockResolvedValue([]);

    const result = await bootstrapEnvPlugins();

    expect(installPlugin).toHaveBeenCalledWith("discord");
    expect(enablePlugin).toHaveBeenCalledWith("discord");
    expect(result.installed).toEqual(["discord"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("should skip already-installed and enabled plugins", async () => {
    process.env.WOPR_PLUGINS_CHANNELS = "discord";
    vi.mocked(listPlugins).mockResolvedValue([
      { name: "discord", version: "1.0.0", path: "/p", enabled: true, installedAt: 0, source: "npm" },
    ]);

    const result = await bootstrapEnvPlugins();

    expect(installPlugin).not.toHaveBeenCalled();
    expect(result.skipped).toEqual(["discord"]);
    expect(result.installed).toEqual([]);
  });

  it("should enable already-installed but disabled plugins", async () => {
    process.env.WOPR_PLUGINS_CHANNELS = "discord";
    vi.mocked(listPlugins).mockResolvedValue([
      { name: "discord", version: "1.0.0", path: "/p", enabled: false, installedAt: 0, source: "npm" },
    ]);

    const result = await bootstrapEnvPlugins();

    expect(installPlugin).not.toHaveBeenCalled();
    expect(enablePlugin).toHaveBeenCalledWith("discord");
    expect(result.skipped).toEqual(["discord"]);
  });

  it("should warn and skip on install failure without crashing", async () => {
    process.env.WOPR_PLUGINS_CHANNELS = "discord,telegram";
    vi.mocked(listPlugins).mockResolvedValue([]);
    vi.mocked(installPlugin)
      .mockRejectedValueOnce(new Error("npm registry unreachable"))
      .mockResolvedValueOnce({
        name: "telegram",
        version: "1.0.0",
        path: "/p",
        enabled: false,
        installedAt: 0,
        source: "npm",
      });

    const result = await bootstrapEnvPlugins();

    expect(result.failed).toEqual([{ name: "discord", error: "npm registry unreachable" }]);
    expect(result.installed).toEqual(["telegram"]);
  });

  it("should handle multiple plugins across all env vars", async () => {
    process.env.WOPR_PLUGINS_CHANNELS = "discord,telegram";
    process.env.WOPR_PLUGINS_PROVIDERS = "openrouter";
    process.env.WOPR_PLUGINS_VOICE = "elevenlabs";
    vi.mocked(listPlugins).mockResolvedValue([]);

    const result = await bootstrapEnvPlugins();

    expect(result.installed).toEqual(["discord", "telegram", "openrouter", "elevenlabs"]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});
