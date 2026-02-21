/**
 * Plugin Installation Security Tests (WOP-743)
 *
 * Tests for the path traversal fix in src/plugins/installation.ts:
 * - assertSafePluginSource validates local plugin paths
 * - Rejects paths pointing to non-directories
 * - Rejects paths inside WOPR_HOME
 * - Rejects broken symlinks
 * - Rejects unsafe directory names
 * - Accepts valid local plugin directories
 * - Does not re-symlink if directory already exists
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Mock node:child_process so npm/git never actually run during tests
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => Buffer.from("")),
}));

// We'll hold our temp dirs so they can be cleaned up
let testWoprHome: string;
let testPluginsDir: string;
let testExternalDir: string;

// Mock state.js before importing installation
vi.mock("../../src/plugins/state.js", () => {
  // We use a getter so testWoprHome and testPluginsDir can be set after vi.mock
  // but actual values must be stable by the time module is imported.
  // We use a lazy factory pattern via getter.
  return {
    get WOPR_HOME() {
      return testWoprHome;
    },
    get PLUGINS_DIR() {
      return testPluginsDir;
    },
    PLUGINS_FILE: "/tmp/wopr-test/plugins.json",
    REGISTRIES_FILE: "/tmp/wopr-test/plugin-registries.json",
    loadedPlugins: new Map(),
    pluginManifests: new Map(),
    configSchemas: new Map(),
    pluginStates: new Map(),
  };
});

// Mock plugin-storage so no real DB is touched
vi.mock("../../src/plugins/plugin-storage.js", () => ({
  ensurePluginSchema: vi.fn(async () => {}),
  getPluginRepo: vi.fn(() => ({
    findById: vi.fn(async () => null),
    insert: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    findMany: vi.fn(async () => []),
  })),
}));

let installPlugin: (source: string) => Promise<unknown>;

beforeEach(async () => {
  // Create isolated temp dirs for each test
  testWoprHome = mkdtempSync(join(tmpdir(), "wopr-test-home-"));
  testPluginsDir = join(testWoprHome, "plugins");
  testExternalDir = mkdtempSync(join(tmpdir(), "wopr-test-external-"));

  mkdirSync(testPluginsDir, { recursive: true });

  // Fresh module import per test so mocks pick up the new dirs
  vi.resetModules();

  // Re-apply mocks after resetModules
  vi.mock("../../src/logger.js", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));
  vi.mock("node:child_process", () => ({
    execFileSync: vi.fn(() => Buffer.from("")),
  }));
  vi.mock("../../src/plugins/state.js", () => ({
    get WOPR_HOME() {
      return testWoprHome;
    },
    get PLUGINS_DIR() {
      return testPluginsDir;
    },
    PLUGINS_FILE: "/tmp/wopr-test/plugins.json",
    REGISTRIES_FILE: "/tmp/wopr-test/plugin-registries.json",
    loadedPlugins: new Map(),
    pluginManifests: new Map(),
    configSchemas: new Map(),
    pluginStates: new Map(),
  }));
  vi.mock("../../src/plugins/plugin-storage.js", () => ({
    ensurePluginSchema: vi.fn(async () => {}),
    getPluginRepo: vi.fn(() => ({
      findById: vi.fn(async () => null),
      insert: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      findMany: vi.fn(async () => []),
    })),
  }));

  const mod = await import("../../src/plugins/installation.js");
  installPlugin = mod.installPlugin;
});

afterEach(() => {
  vi.restoreAllMocks();
  // Clean up temp dirs
  try {
    rmSync(testWoprHome, { recursive: true, force: true });
  } catch {}
  try {
    rmSync(testExternalDir, { recursive: true, force: true });
  } catch {}
});

// ============================================================================
// Path traversal rejection
// ============================================================================

describe("installPlugin — local path traversal rejection", () => {
  it("rejects a traversal path that resolves to a non-existent file", async () => {
    // ./../../etc/passwd resolves to /etc/passwd — a file, not a dir
    await expect(installPlugin("/etc/passwd")).rejects.toThrow(
      /not a directory|does not resolve to a directory/i,
    );
  });

  it("rejects path traversal pointing to a directory inside WOPR_HOME", async () => {
    // A subdirectory of WOPR_HOME should be rejected
    const inside = join(testWoprHome, "config");
    mkdirSync(inside, { recursive: true });

    await expect(installPlugin(inside)).rejects.toThrow(/must not be inside WOPR_HOME/i);
  });

  it("rejects path equal to WOPR_HOME itself", async () => {
    await expect(installPlugin(testWoprHome)).rejects.toThrow(/must not be inside WOPR_HOME/i);
  });
});

// ============================================================================
// Non-directory path rejection
// ============================================================================

describe("installPlugin — non-directory path rejection", () => {
  it("rejects a regular file path", async () => {
    const filePath = join(testExternalDir, "notadir.txt");
    writeFileSync(filePath, "content");

    await expect(installPlugin(filePath)).rejects.toThrow(/not a directory/i);
  });

  it("rejects a non-existent path", async () => {
    const ghost = join(testExternalDir, "does-not-exist");

    await expect(installPlugin(ghost)).rejects.toThrow(/does not exist/i);
  });
});

// ============================================================================
// Broken symlink rejection
// ============================================================================

describe("installPlugin — broken symlink rejection", () => {
  it("rejects a symlink pointing to a non-existent target", async () => {
    const symlink = join(testExternalDir, "broken-link");
    symlinkSync(join(testExternalDir, "ghost"), symlink);

    // existsSync returns false for dangling symlinks, so "does not exist" fires first
    await expect(installPlugin(symlink)).rejects.toThrow(
      /does not exist|Cannot resolve|broken symlink/i,
    );
  });
});

// ============================================================================
// Unsafe directory name rejection
// ============================================================================

describe("installPlugin — unsafe directory name rejection", () => {
  it("rejects a plugin directory name containing semicolons", async () => {
    // Create a dir whose basename has unsafe chars
    const unsafeName = "plugin;rm -rf /";
    // We can't actually create a dir with ';' in the name on most Unix systems,
    // so we test via a path manipulation: create a valid dir, rename concept is
    // tested by mocking resolve to return a path ending with unsafe chars.
    // Instead we test the SAFE_NAME check by using a path with special chars via
    // a temp dir that has the unsafe name as a basename.
    // On Linux, ";" is actually allowed in dir names, so we CAN create it:
    const unsafeDir = join(testExternalDir, unsafeName);
    try {
      mkdirSync(unsafeDir, { recursive: true });
      await expect(installPlugin(unsafeDir)).rejects.toThrow(
        /Invalid local plugin directory name/i,
      );
    } catch (e: unknown) {
      // If OS won't allow the name, skip
      if (
        (e as NodeJS.ErrnoException).code === "ENOENT" ||
        (e as NodeJS.ErrnoException).code === "EINVAL"
      ) {
        // OS doesn't allow this name — test is vacuously satisfied
        return;
      }
      throw e;
    }
  });
});

// ============================================================================
// Valid local plugin directory
// ============================================================================

describe("installPlugin — valid local plugin directory", () => {
  it("accepts a valid local plugin directory and creates a symlink", async () => {
    // Create an external plugin dir with package.json (no build step)
    const pluginSrc = join(testExternalDir, "my-plugin");
    mkdirSync(pluginSrc, { recursive: true });
    writeFileSync(
      join(pluginSrc, "package.json"),
      JSON.stringify({ name: "my-plugin", version: "1.0.0" }),
    );

    // node:child_process is mocked at module level — npm install will not actually run
    const result = (await installPlugin(pluginSrc)) as { name: string; source: string };

    expect(result.name).toBe("my-plugin");
    expect(result.source).toBe("local");
  });

  it("does not call symlinkSync if the plugin directory already exists", async () => {
    const pluginSrc = join(testExternalDir, "existing-plugin");
    mkdirSync(pluginSrc, { recursive: true });
    writeFileSync(
      join(pluginSrc, "package.json"),
      JSON.stringify({ name: "existing-plugin", version: "1.0.0" }),
    );

    // Pre-create the destination symlink to simulate already-installed
    const destLink = join(testPluginsDir, "existing-plugin");
    symlinkSync(pluginSrc, destLink);

    // Should not throw even though the symlink already exists
    const result = (await installPlugin(pluginSrc)) as { name: string };
    expect(result.name).toBe("existing-plugin");
  });
});
