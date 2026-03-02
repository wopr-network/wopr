import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs before importing the module under test
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

// Mock plugin-storage
const mockPluginRepo = {
  findById: vi.fn(),
  insert: vi.fn(),
};
const mockRegistryRepo = {
  findById: vi.fn(),
  insert: vi.fn(),
};
vi.mock("../../src/plugins/plugin-storage.js", () => ({
  ensurePluginSchema: vi.fn(async () => {}),
  getPluginRepo: () => mockPluginRepo,
  getRegistryRepo: () => mockRegistryRepo,
}));

// Mock logger to silence output
vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { existsSync, readFileSync, renameSync } from "node:fs";
import { migratePluginJsonToSql } from "../../src/plugins/migrate-json.js";
import { PLUGINS_FILE, REGISTRIES_FILE } from "../../src/plugins/state.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("migratePluginJsonToSql", () => {
  it("returns zeros when no JSON files exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const result = await migratePluginJsonToSql();
    expect(result).toEqual({ plugins: 0, registries: 0 });
    expect(renameSync).not.toHaveBeenCalled();
  });

  it("migrates plugins.json and renames to .backup", async () => {
    const plugins = [
      {
        name: "test-plugin",
        version: "1.0.0",
        source: "npm",
        path: "/x",
        enabled: true,
        installedAt: 1,
      },
    ];
    vi.mocked(existsSync).mockImplementation((p) => p === PLUGINS_FILE);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(plugins));
    mockPluginRepo.findById.mockResolvedValue(null);
    mockPluginRepo.insert.mockResolvedValue(undefined);

    const result = await migratePluginJsonToSql();
    expect(result.plugins).toBe(1);
    expect(mockPluginRepo.insert).toHaveBeenCalledOnce();
    expect(renameSync).toHaveBeenCalledWith(
      PLUGINS_FILE,
      `${PLUGINS_FILE}.backup`,
    );
  });

  it("skips already-migrated plugins (idempotent)", async () => {
    const plugins = [
      {
        name: "existing",
        version: "1.0.0",
        source: "npm",
        path: "/x",
        enabled: true,
        installedAt: 1,
      },
    ];
    vi.mocked(existsSync).mockImplementation((p) => p === PLUGINS_FILE);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(plugins));
    mockPluginRepo.findById.mockResolvedValue({ name: "existing" }); // already exists

    const result = await migratePluginJsonToSql();
    expect(result.plugins).toBe(0);
    expect(mockPluginRepo.insert).not.toHaveBeenCalled();
  });

  it("migrates plugin-registries.json and renames to .backup", async () => {
    const registries = [
      {
        name: "official",
        url: "https://registry.wopr.dev",
        enabled: true,
        lastSync: 1,
      },
    ];
    vi.mocked(existsSync).mockImplementation((p) => p === REGISTRIES_FILE);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(registries));
    mockRegistryRepo.findById.mockResolvedValue(null);
    mockRegistryRepo.insert.mockResolvedValue(undefined);

    const result = await migratePluginJsonToSql();
    expect(result.registries).toBe(1);
    expect(mockRegistryRepo.insert).toHaveBeenCalledOnce();
    expect(renameSync).toHaveBeenCalledWith(
      REGISTRIES_FILE,
      `${REGISTRIES_FILE}.backup`,
    );
  });

  it("handles both files at once", async () => {
    const plugins = [
      {
        name: "p1",
        version: "1.0.0",
        source: "npm",
        path: "/x",
        enabled: true,
        installedAt: 1,
      },
    ];
    const registries = [
      { name: "r1", url: "https://r1.dev", enabled: true, lastSync: 1 },
    ];

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p) === PLUGINS_FILE) return JSON.stringify(plugins);
      return JSON.stringify(registries);
    });
    mockPluginRepo.findById.mockResolvedValue(null);
    mockPluginRepo.insert.mockResolvedValue(undefined);
    mockRegistryRepo.findById.mockResolvedValue(null);
    mockRegistryRepo.insert.mockResolvedValue(undefined);

    const result = await migratePluginJsonToSql();
    expect(result).toEqual({ plugins: 1, registries: 1 });
    expect(renameSync).toHaveBeenCalledTimes(2);
  });

  it("handles malformed JSON gracefully (no throw)", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("NOT VALID JSON");

    const result = await migratePluginJsonToSql();
    // Should not throw — errors are caught and logged
    expect(result.plugins).toBe(0);
    expect(result.registries).toBe(0);
  });
});
