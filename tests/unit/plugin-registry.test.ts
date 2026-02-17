/**
 * Plugin Registry Tests (WOP-102)
 *
 * Tests for src/plugins/registry.ts covering:
 * - getPluginRegistries (read from registries file)
 * - addRegistry (add new registry entry)
 * - removeRegistry (remove registry by URL)
 * - listRegistries (alias for getPluginRegistries)
 * - searchPlugins (multi-source search)
 * - discoverVoicePlugins (categorized voice plugin discovery)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// vi.mock is hoisted above variable declarations, so we must use
// inline values that don't reference local constants.
const TEST_DIR = join(tmpdir(), "wopr-registry-test-" + process.pid);

vi.mock("../../src/plugins/state.js", async () => {
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = join(tmpdir(), "wopr-registry-test-" + process.pid);
  return {
    WOPR_HOME: dir,
    PLUGINS_DIR: join(dir, "plugins"),
    PLUGINS_FILE: join(dir, "plugins.json"),
    REGISTRIES_FILE: join(dir, "plugin-registries.json"),
    loadedPlugins: new Map(),
    pluginManifests: new Map(),
    configSchemas: new Map(),
  };
});

// Mock installation (async in WOP-547)
const mockGetInstalledPlugins = vi.fn(async () => []);
vi.mock("../../src/plugins/installation.js", () => ({
  getInstalledPlugins: (...args: any[]) => mockGetInstalledPlugins(...args),
}));

// Mock child_process for GitHub/npm search
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => "[]"),
  spawnSync: vi.fn(() => ({
    error: null,
    status: 0,
    stdout: "[]",
    stderr: "",
  })),
  spawn: vi.fn(),
}));

import {
  getPluginRegistries,
  addRegistry,
  removeRegistry,
  listRegistries,
  searchPlugins,
  discoverVoicePlugins,
} from "../../src/plugins/registry.js";

beforeEach(async () => {
  mkdirSync(TEST_DIR, { recursive: true });

  // Initialize storage for plugin schema (WOP-547)
  const { getStorage } = await import("../../src/storage/index.js");
  getStorage(join(TEST_DIR, "wopr.sqlite"));

  const { ensurePluginSchema } = await import("../../src/plugins/plugin-storage.js");
  await ensurePluginSchema();

  mockGetInstalledPlugins.mockResolvedValue([]);
});

afterEach(async () => {
  const { resetStorage } = await import("../../src/storage/index.js");
  const { resetPluginSchemaState } = await import("../../src/plugins/plugin-storage.js");
  await resetStorage();
  resetPluginSchemaState();
  rmSync(TEST_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ============================================================================
// getPluginRegistries
// ============================================================================

describe("getPluginRegistries", () => {
  it("should return empty array when registries file does not exist", async () => {
    const registries = await getPluginRegistries();
    expect(registries).toEqual([]);
  });

  it("should return parsed registries from file", async () => {
    // Use addRegistry to set up data instead of writing to file
    await addRegistry("https://registry.example.com", "example");

    const registries = await getPluginRegistries();
    expect(registries).toHaveLength(1);
    expect(registries[0].url).toBe("https://registry.example.com");
    expect(registries[0].name).toBe("example");
    expect(registries[0].enabled).toBe(true);
  });
});

// ============================================================================
// addRegistry
// ============================================================================

describe("addRegistry", () => {
  it("should add a new registry entry and persist it", async () => {
    const entry = await addRegistry("https://registry.example.com", "my-registry");

    expect(entry.url).toBe("https://registry.example.com");
    expect(entry.name).toBe("my-registry");
    expect(entry.enabled).toBe(true);
    expect(entry.lastSync).toBe(0);

    // Verify persisted by loading again
    const saved = await getPluginRegistries();
    expect(saved).toHaveLength(1);
    expect(saved[0].url).toBe("https://registry.example.com");
  });

  it("should use hostname as name when name not provided", async () => {
    const entry = await addRegistry("https://plugins.wopr.dev/registry");

    expect(entry.name).toBe("plugins.wopr.dev");
  });

  it("should append to existing registries", async () => {
    await addRegistry("https://first.example.com", "first");
    await addRegistry("https://second.example.com", "second");

    const registries = await getPluginRegistries();
    expect(registries).toHaveLength(2);
    expect(registries[0].name).toBe("first");
    expect(registries[1].name).toBe("second");
  });
});

// ============================================================================
// removeRegistry
// ============================================================================

describe("removeRegistry", () => {
  it("should remove a registry by URL and return true", async () => {
    await addRegistry("https://remove-me.example.com", "to-remove");
    await addRegistry("https://keep-me.example.com", "to-keep");

    const removed = await removeRegistry("https://remove-me.example.com");
    expect(removed).toBe(true);

    const registries = await getPluginRegistries();
    expect(registries).toHaveLength(1);
    expect(registries[0].name).toBe("to-keep");
  });

  it("should return false when URL not found", async () => {
    await addRegistry("https://existing.example.com", "existing");

    const removed = await removeRegistry("https://nonexistent.example.com");
    expect(removed).toBe(false);

    // Original still intact
    const registries = await getPluginRegistries();
    expect(registries).toHaveLength(1);
  });

  it("should return false when no registries exist", async () => {
    const removed = await removeRegistry("https://any.example.com");
    expect(removed).toBe(false);
  });
});

// ============================================================================
// listRegistries
// ============================================================================

describe("listRegistries", () => {
  it("should return empty array when none registered", async () => {
    const list = await listRegistries();
    expect(list).toEqual([]);
  });

  it("should return all registered registries", async () => {
    await addRegistry("https://a.example.com", "a");
    await addRegistry("https://b.example.com", "b");

    const list = await listRegistries();
    expect(list).toHaveLength(2);
  });
});

// ============================================================================
// searchPlugins
// ============================================================================

describe("searchPlugins", () => {
  it("should return installed plugins matching query", async () => {
    mockGetInstalledPlugins.mockResolvedValue([
      {
        name: "wopr-plugin-discord",
        version: "1.0.0",
        description: "Discord bot",
        source: "github",
        path: "/tmp/plugins/discord",
        enabled: true,
        installedAt: Date.now(),
      },
      {
        name: "wopr-plugin-memory",
        version: "1.0.0",
        description: "Memory plugin",
        source: "npm",
        path: "/tmp/plugins/memory",
        enabled: true,
        installedAt: Date.now(),
      },
    ]);

    const results = await searchPlugins("discord");

    expect(results.some((r) => r.name === "wopr-plugin-discord")).toBe(true);
    expect(results.find((r) => r.name === "wopr-plugin-discord")?.installed).toBe(true);
    expect(results.find((r) => r.name === "wopr-plugin-discord")?.source).toBe("installed");
  });

  it("should return empty results when no plugins match", async () => {
    mockGetInstalledPlugins.mockResolvedValue([
      {
        name: "wopr-plugin-discord",
        version: "1.0.0",
        source: "github",
        path: "/tmp/plugins/discord",
        enabled: true,
        installedAt: Date.now(),
      },
    ]);

    const results = await searchPlugins("nonexistent-xyz");
    // Only installed plugins matching the query should appear
    expect(results.filter((r) => r.source === "installed")).toHaveLength(0);
  });

  it("should deduplicate results by name", async () => {
    mockGetInstalledPlugins.mockResolvedValue([
      {
        name: "wopr-plugin-test",
        version: "1.0.0",
        source: "github",
        path: "/tmp/plugins/test",
        enabled: true,
        installedAt: Date.now(),
      },
    ]);

    const results = await searchPlugins("test");
    const testResults = results.filter((r) => r.name === "wopr-plugin-test");
    expect(testResults).toHaveLength(1);
  });

  it("should return all installed when query is empty", async () => {
    mockGetInstalledPlugins.mockResolvedValue([
      {
        name: "plugin-a",
        version: "1.0.0",
        source: "npm",
        path: "/tmp/a",
        enabled: true,
        installedAt: Date.now(),
      },
      {
        name: "plugin-b",
        version: "2.0.0",
        source: "github",
        path: "/tmp/b",
        enabled: false,
        installedAt: Date.now(),
      },
    ]);

    const results = await searchPlugins("");
    expect(results.filter((r) => r.source === "installed")).toHaveLength(2);
  });
});

// ============================================================================
// discoverVoicePlugins
// ============================================================================

describe("discoverVoicePlugins", () => {
  it("should return categorized empty results when no voice plugins found", async () => {
    const result = await discoverVoicePlugins();

    expect(result).toHaveProperty("stt");
    expect(result).toHaveProperty("tts");
    expect(result).toHaveProperty("channels");
    expect(result).toHaveProperty("cli");
    expect(result.stt).toEqual([]);
    expect(result.tts).toEqual([]);
    expect(result.channels).toEqual([]);
    expect(result.cli).toEqual([]);
  });

  it("should categorize voice plugins correctly", async () => {
    mockGetInstalledPlugins.mockResolvedValue([
      {
        name: "wopr-plugin-voice-stt-whisper",
        version: "1.0.0",
        description: "Whisper STT",
        source: "npm",
        path: "/tmp/stt",
        enabled: true,
        installedAt: Date.now(),
      },
      {
        name: "wopr-plugin-voice-tts-piper",
        version: "1.0.0",
        description: "Piper TTS",
        source: "npm",
        path: "/tmp/tts",
        enabled: true,
        installedAt: Date.now(),
      },
      {
        name: "wopr-plugin-voice-cli",
        version: "1.0.0",
        description: "Voice CLI",
        source: "npm",
        path: "/tmp/cli",
        enabled: true,
        installedAt: Date.now(),
      },
    ]);

    const result = await discoverVoicePlugins();

    // "voice" query matches all these plugin names
    expect(result.stt.some((p) => p.name.includes("whisper"))).toBe(true);
    expect(result.tts.some((p) => p.name.includes("piper"))).toBe(true);
    expect(result.cli.some((p) => p.name.includes("voice-cli"))).toBe(true);
  });
});
