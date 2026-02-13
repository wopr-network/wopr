/**
 * InstanceStorage Tests (WOP-199)
 *
 * Tests for src/platform/instance-storage.ts covering:
 * - Instance ID validation (UUID only, path traversal prevention)
 * - Provisioning (directory tree creation, template config, idempotency)
 * - Deprovisioning (full removal, keepData option)
 * - Path helpers (getHomePath, exists)
 * - Listing instances (filters non-UUID entries)
 * - Config read/write (getConfig, setConfig)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// In-memory filesystem mock
// ---------------------------------------------------------------------------

/** Map of path -> content (files) */
let mockFiles: Map<string, string>;
/** Set of directory paths */
let mockDirs: Set<string>;

vi.mock("node:fs/promises", () => ({
  default: {
    stat: vi.fn(async (p: string) => {
      if (mockDirs.has(p)) {
        return { isDirectory: () => true };
      }
      if (mockFiles.has(p)) {
        return { isDirectory: () => false };
      }
      const err: any = new Error(`ENOENT: ${p}`);
      err.code = "ENOENT";
      throw err;
    }),
    mkdir: vi.fn(async (p: string, opts?: any) => {
      mockDirs.add(p);
      // When recursive, also add all parent directories
      if (opts?.recursive) {
        let dir = p;
        while (dir !== "/" && dir !== ".") {
          mockDirs.add(dir);
          const parent = dir.substring(0, dir.lastIndexOf("/")) || "/";
          if (parent === dir) break;
          dir = parent;
        }
      }
    }),
    readdir: vi.fn(async (p: string) => {
      if (!mockDirs.has(p)) {
        const err: any = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      // Collect immediate children from both mockDirs and mockFiles
      const prefix = p.endsWith("/") ? p : p + "/";
      const children = new Set<string>();
      for (const d of mockDirs) {
        if (d.startsWith(prefix) && d !== p) {
          const rest = d.slice(prefix.length);
          const first = rest.split("/")[0];
          if (first) children.add(first);
        }
      }
      for (const f of mockFiles.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          const first = rest.split("/")[0];
          if (first) children.add(first);
        }
      }
      return [...children];
    }),
    readFile: vi.fn(async (p: string) => {
      const content = mockFiles.get(p);
      if (content === undefined) {
        const err: any = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      return content;
    }),
    writeFile: vi.fn(async (p: string, content: string) => {
      mockFiles.set(p, content);
    }),
    access: vi.fn(async (p: string) => {
      if (!mockFiles.has(p) && !mockDirs.has(p)) {
        const err: any = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
    }),
    rm: vi.fn(async (p: string, _opts?: any) => {
      // Remove everything under p
      for (const k of [...mockFiles.keys()]) {
        if (k === p || k.startsWith(p + "/")) mockFiles.delete(k);
      }
      for (const k of [...mockDirs]) {
        if (k === p || k.startsWith(p + "/")) mockDirs.delete(k);
      }
    }),
    rename: vi.fn(async (src: string, dst: string) => {
      // Move directory and contents
      for (const k of [...mockDirs]) {
        if (k === src || k.startsWith(src + "/")) {
          mockDirs.delete(k);
          mockDirs.add(k.replace(src, dst));
        }
      }
      for (const k of [...mockFiles.keys()]) {
        if (k === src || k.startsWith(src + "/")) {
          const content = mockFiles.get(k)!;
          mockFiles.delete(k);
          mockFiles.set(k.replace(src, dst), content);
        }
      }
    }),
  },
}));

// ---------------------------------------------------------------------------
// Dynamic import (after mocks)
// ---------------------------------------------------------------------------

let storage: typeof import("../../src/platform/instance-storage.js");

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_UUID_2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const BASE = "/var/wopr/instances";

beforeEach(async () => {
  mockFiles = new Map();
  mockDirs = new Set();
  vi.unstubAllEnvs();
  storage = await import("../../src/platform/instance-storage.js");
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

// ===========================================================================
// Instance ID validation
// ===========================================================================
describe("instance ID validation", () => {
  it("accepts valid UUID v4", () => {
    expect(() => storage.getHomePath(VALID_UUID)).not.toThrow();
  });

  it("accepts uppercase UUID", () => {
    expect(() => storage.getHomePath(VALID_UUID.toUpperCase())).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => storage.getHomePath("")).toThrow(/Invalid instance ID/);
  });

  it("rejects plain text", () => {
    expect(() => storage.getHomePath("my-instance")).toThrow(/Invalid instance ID/);
  });

  it("rejects path traversal attempt", () => {
    expect(() => storage.getHomePath("../../../etc/passwd")).toThrow(/Invalid instance ID/);
  });

  it("rejects dot-dot with UUID suffix", () => {
    expect(() => storage.getHomePath("../../" + VALID_UUID)).toThrow(/Invalid instance ID/);
  });

  it("rejects UUID with trailing slash", () => {
    expect(() => storage.getHomePath(VALID_UUID + "/")).toThrow(/Invalid instance ID/);
  });

  it("rejects UUID with embedded null byte", () => {
    expect(() =>
      storage.getHomePath(VALID_UUID.slice(0, 8) + "\0" + VALID_UUID.slice(9)),
    ).toThrow(/Invalid instance ID/);
  });
});

// ===========================================================================
// getHomePath
// ===========================================================================
describe("getHomePath", () => {
  it("returns path under default base", () => {
    const home = storage.getHomePath(VALID_UUID);
    expect(home).toBe(join(BASE, VALID_UUID));
  });

  it("respects WOPR_INSTANCES_DIR env override", async () => {
    vi.stubEnv("WOPR_INSTANCES_DIR", "/custom/instances");
    // Re-import to pick up env change
    vi.resetModules();
    storage = await import("../../src/platform/instance-storage.js");
    const home = storage.getHomePath(VALID_UUID);
    expect(home).toBe(join("/custom/instances", VALID_UUID));
  });
});

// ===========================================================================
// exists
// ===========================================================================
describe("exists", () => {
  it("returns false when instance dir does not exist", async () => {
    expect(await storage.exists(VALID_UUID)).toBe(false);
  });

  it("returns true when instance dir exists", async () => {
    mockDirs.add(join(BASE, VALID_UUID));
    expect(await storage.exists(VALID_UUID)).toBe(true);
  });
});

// ===========================================================================
// provision
// ===========================================================================
describe("provision", () => {
  it("creates root directory and all subdirectories", async () => {
    await storage.provision(VALID_UUID);

    expect(mockDirs.has(join(BASE, VALID_UUID))).toBe(true);
    expect(mockDirs.has(join(BASE, VALID_UUID, "plugins"))).toBe(true);
    expect(mockDirs.has(join(BASE, VALID_UUID, "sessions"))).toBe(true);
    expect(mockDirs.has(join(BASE, VALID_UUID, "attachments"))).toBe(true);
    expect(mockDirs.has(join(BASE, VALID_UUID, "data"))).toBe(true);
  });

  it("creates empty config.json when no template", async () => {
    await storage.provision(VALID_UUID);

    const configPath = join(BASE, VALID_UUID, "config.json");
    expect(mockFiles.has(configPath)).toBe(true);
    expect(JSON.parse(mockFiles.get(configPath)!)).toEqual({});
  });

  it("creates config.json from template", async () => {
    const template = { model: "claude-3", maxTokens: 4096 };
    await storage.provision(VALID_UUID, { template });

    const configPath = join(BASE, VALID_UUID, "config.json");
    expect(JSON.parse(mockFiles.get(configPath)!)).toEqual(template);
  });

  it("creates empty plugins.json", async () => {
    await storage.provision(VALID_UUID);

    const pluginsPath = join(BASE, VALID_UUID, "plugins.json");
    expect(mockFiles.has(pluginsPath)).toBe(true);
    expect(JSON.parse(mockFiles.get(pluginsPath)!)).toEqual([]);
  });

  it("does not overwrite existing config.json", async () => {
    const configPath = join(BASE, VALID_UUID, "config.json");
    mockFiles.set(configPath, '{"existing":true}\n');
    mockDirs.add(join(BASE, VALID_UUID));

    await storage.provision(VALID_UUID, { template: { new: true } });

    expect(JSON.parse(mockFiles.get(configPath)!)).toEqual({ existing: true });
  });

  it("returns the home path", async () => {
    const home = await storage.provision(VALID_UUID);
    expect(home).toBe(join(BASE, VALID_UUID));
  });

  it("is idempotent — second call does not error", async () => {
    await storage.provision(VALID_UUID);
    await expect(storage.provision(VALID_UUID)).resolves.toBe(
      join(BASE, VALID_UUID),
    );
  });
});

// ===========================================================================
// deprovision
// ===========================================================================
describe("deprovision", () => {
  it("removes the entire instance directory", async () => {
    await storage.provision(VALID_UUID);
    await storage.deprovision(VALID_UUID);

    expect(mockDirs.has(join(BASE, VALID_UUID))).toBe(false);
    expect(mockFiles.has(join(BASE, VALID_UUID, "config.json"))).toBe(false);
  });

  it("no-ops when instance does not exist", async () => {
    await expect(storage.deprovision(VALID_UUID)).resolves.toBeUndefined();
  });

  it("preserves data/ when keepData is true", async () => {
    await storage.provision(VALID_UUID);
    // Add a file in data/
    const dataFile = join(BASE, VALID_UUID, "data", "important.db");
    mockFiles.set(dataFile, "precious data");
    mockDirs.add(join(BASE, VALID_UUID, "data"));

    await storage.deprovision(VALID_UUID, { keepData: true });

    // data dir should be restored
    expect(mockDirs.has(join(BASE, VALID_UUID, "data"))).toBe(true);
    expect(mockFiles.get(dataFile)).toBe("precious data");

    // config/plugins should be gone
    expect(mockFiles.has(join(BASE, VALID_UUID, "config.json"))).toBe(false);
    expect(mockFiles.has(join(BASE, VALID_UUID, "plugins.json"))).toBe(false);
  });

  it("removes everything when keepData is false", async () => {
    await storage.provision(VALID_UUID);
    const dataFile = join(BASE, VALID_UUID, "data", "important.db");
    mockFiles.set(dataFile, "precious data");

    await storage.deprovision(VALID_UUID, { keepData: false });

    expect(mockDirs.has(join(BASE, VALID_UUID))).toBe(false);
    expect(mockFiles.has(dataFile)).toBe(false);
  });
});

// ===========================================================================
// listInstances
// ===========================================================================
describe("listInstances", () => {
  it("returns empty array when base dir does not exist", async () => {
    expect(await storage.listInstances()).toEqual([]);
  });

  it("returns provisioned instance IDs", async () => {
    await storage.provision(VALID_UUID);
    await storage.provision(VALID_UUID_2);

    const list = await storage.listInstances();
    expect(list).toContain(VALID_UUID);
    expect(list).toContain(VALID_UUID_2);
    expect(list).toHaveLength(2);
  });

  it("returns sorted list", async () => {
    await storage.provision(VALID_UUID_2);
    await storage.provision(VALID_UUID);

    const list = await storage.listInstances();
    expect(list).toEqual([...list].sort());
  });

  it("ignores non-UUID entries", async () => {
    await storage.provision(VALID_UUID);
    // Add a non-UUID directory
    mockDirs.add(join(BASE, "not-a-uuid"));
    mockDirs.add(BASE);

    const list = await storage.listInstances();
    expect(list).toEqual([VALID_UUID]);
  });

  it("ignores files that happen to be UUID-named", async () => {
    mockDirs.add(BASE);
    // Add as file, not directory
    mockFiles.set(join(BASE, VALID_UUID), "file content");

    const list = await storage.listInstances();
    expect(list).toEqual([]);
  });
});

// ===========================================================================
// getConfig / setConfig
// ===========================================================================
describe("getConfig", () => {
  it("reads the instance config", async () => {
    await storage.provision(VALID_UUID, { template: { key: "value" } });

    const config = await storage.getConfig(VALID_UUID);
    expect(config).toEqual({ key: "value" });
  });

  it("throws when instance does not exist", async () => {
    await expect(storage.getConfig(VALID_UUID)).rejects.toThrow(/ENOENT/);
  });
});

describe("setConfig", () => {
  it("writes new config", async () => {
    await storage.provision(VALID_UUID);
    await storage.setConfig(VALID_UUID, { updated: true });

    const config = await storage.getConfig(VALID_UUID);
    expect(config).toEqual({ updated: true });
  });

  it("overwrites existing config", async () => {
    await storage.provision(VALID_UUID, { template: { old: true } });
    await storage.setConfig(VALID_UUID, { new: true });

    const config = await storage.getConfig(VALID_UUID);
    expect(config).toEqual({ new: true });
  });
});

// ===========================================================================
// Security: path traversal edge cases
// ===========================================================================
describe("security", () => {
  it("rejects symlink-like traversal in ID", () => {
    expect(() => storage.getHomePath("..%2F..%2Fetc%2Fpasswd")).toThrow(
      /Invalid instance ID/,
    );
  });

  it("rejects IDs with spaces", () => {
    expect(() => storage.getHomePath(" " + VALID_UUID)).toThrow(
      /Invalid instance ID/,
    );
  });

  it("rejects IDs with newlines", () => {
    expect(() => storage.getHomePath(VALID_UUID + "\n")).toThrow(
      /Invalid instance ID/,
    );
  });
});
