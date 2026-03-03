/**
 * Plugin Dependency Resolution Tests (WOP-1014)
 *
 * Tests for manifest.dependencies resolution in src/plugins/loading.ts.
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

// Mock installation module
vi.mock("../../src/plugins/installation.js", () => ({
  getInstalledPlugins: vi.fn(),
  installPlugin: vi.fn(),
  enablePlugin: vi.fn(),
}));

// Mock state
vi.mock("../../src/plugins/state.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadedPlugins: new Map(),
    pluginManifests: new Map(),
    pluginStates: new Map(),
    configSchemas: new Map(),
  };
});

// Mock capability modules
vi.mock("../../src/core/capability-deps.js", () => ({
  getCapabilityDependencyGraph: () => ({
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
  }),
}));
vi.mock("../../src/core/capability-health.js", () => ({
  getCapabilityHealthProber: () => ({
    isRunning: () => false,
    start: vi.fn(),
    stop: vi.fn(),
    unregisterProbe: vi.fn(),
  }),
}));
vi.mock("../../src/core/capability-registry.js", () => ({
  getCapabilityRegistry: () => ({
    checkRequirements: () => ({ satisfied: true, missing: [], optional: [] }),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
  }),
}));
vi.mock("../../src/core/events.js", () => ({
  emitPluginActivated: vi.fn(),
  emitPluginDeactivated: vi.fn(),
  emitPluginDrained: vi.fn(),
  emitPluginDraining: vi.fn(),
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn(async () => {}) },
}));
vi.mock("../../src/plugins/context-factory.js", () => ({
  createPluginContext: vi.fn(() => ({})),
}));

import { enablePlugin, getInstalledPlugins, installPlugin } from "../../src/plugins/installation.js";
import { loadedPlugins } from "../../src/plugins/state.js";
import { normalizeDependencyName, resolveDependencies } from "../../src/plugins/loading.js";

const mockGetInstalledPlugins = vi.mocked(getInstalledPlugins);
const mockInstallPlugin = vi.mocked(installPlugin);
const mockEnablePlugin = vi.mocked(enablePlugin);

const mockInjectors = {
  inject: vi.fn(async () => ""),
  getSessions: vi.fn(() => []),
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  loadedPlugins.clear();
});

// ============================================================================
// normalizeDependencyName
// ============================================================================

describe("normalizeDependencyName", () => {
  it("strips @wopr-network/plugin- prefix", () => {
    expect(normalizeDependencyName("@wopr-network/plugin-cron")).toBe("cron");
  });

  it("strips @wopr-network/ prefix without plugin-", () => {
    expect(normalizeDependencyName("@wopr-network/cron")).toBe("cron");
  });

  it("strips wopr-plugin- prefix", () => {
    expect(normalizeDependencyName("wopr-plugin-cron")).toBe("cron");
  });

  it("returns bare name unchanged", () => {
    expect(normalizeDependencyName("cron")).toBe("cron");
  });
});

// ============================================================================
// resolveDependencies
// ============================================================================

describe("resolveDependencies", () => {
  it("does nothing when dependencies is undefined", async () => {
    await resolveDependencies(undefined, mockInjectors, {});
    expect(mockGetInstalledPlugins).not.toHaveBeenCalled();
  });

  it("does nothing when dependencies is empty", async () => {
    await resolveDependencies([], mockInjectors, {});
    expect(mockGetInstalledPlugins).not.toHaveBeenCalled();
  });

  it("skips already-loaded dependencies", async () => {
    loadedPlugins.set("cron", { plugin: {} as any, context: {} as any });
    await resolveDependencies(["@wopr-network/plugin-cron"], mockInjectors, {});
    expect(mockInstallPlugin).not.toHaveBeenCalled();
  });

  it("throws on circular dependency", async () => {
    const resolving = new Set(["cron"]);
    await expect(
      resolveDependencies(["@wopr-network/plugin-cron"], mockInjectors, { _resolving: resolving }),
    ).rejects.toThrow(/circular dependency/i);
  });

  it("installs and enables a missing dependency", async () => {
    mockGetInstalledPlugins.mockResolvedValue([]);
    const fakeInstalled = {
      name: "cron",
      version: "1.0.0",
      source: "npm" as const,
      path: "/fake/path/cron",
      enabled: true,
      installedAt: Date.now(),
    };
    mockInstallPlugin.mockResolvedValue(fakeInstalled);
    mockEnablePlugin.mockResolvedValue(true);

    // resolveDependencies calls loadPlugin internally for the dep,
    // which will fail because the path doesn't exist. That's fine —
    // we test the install+enable flow, not the full load.
    await expect(resolveDependencies(["@wopr-network/plugin-cron"], mockInjectors, {})).rejects.toThrow(); // will fail at dynamic import

    expect(mockInstallPlugin).toHaveBeenCalledWith("@wopr-network/plugin-cron");
    expect(mockEnablePlugin).toHaveBeenCalledWith("cron");
  });

  it("enables an installed-but-disabled dependency", async () => {
    const disabledPlugin = {
      name: "cron",
      version: "1.0.0",
      source: "npm" as const,
      path: "/fake/path/cron",
      enabled: false,
      installedAt: Date.now(),
    };
    mockGetInstalledPlugins.mockResolvedValue([disabledPlugin]);
    mockEnablePlugin.mockResolvedValue(true);

    // Will fail at dynamic import, but we verify enable was called
    await expect(resolveDependencies(["@wopr-network/plugin-cron"], mockInjectors, {})).rejects.toThrow();

    expect(mockInstallPlugin).not.toHaveBeenCalled();
    expect(mockEnablePlugin).toHaveBeenCalledWith("cron");
  });

  it("throws a clear error when install fails", async () => {
    mockGetInstalledPlugins.mockResolvedValue([]);
    mockInstallPlugin.mockRejectedValue(new Error("npm registry down"));

    await expect(resolveDependencies(["@wopr-network/plugin-cron"], mockInjectors, {})).rejects.toThrow(
      /failed to install dependency.*cron.*npm registry down/i,
    );
  });
});
