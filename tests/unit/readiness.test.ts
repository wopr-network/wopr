import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:sqlite before importing readiness module
vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    exec() {}
    close() {}
  },
}));

// Mock dependencies
vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    listProviders: vi.fn(() => []),
  },
}));

vi.mock("../../src/plugins/state.js", () => ({
  loadedPlugins: new Map(),
}));

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: "/tmp/test-wopr",
}));

import { existsSync } from "node:fs";
import { providerRegistry } from "../../src/core/providers.js";
import { loadedPlugins } from "../../src/plugins/state.js";
import {
  _resetForTesting,
  checkReadiness,
  markCronRunning,
  markStartupComplete,
} from "../../src/daemon/readiness.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

describe("readiness probe", () => {
  beforeEach(() => {
    _resetForTesting();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(providerRegistry.listProviders).mockReturnValue([]);
    loadedPlugins.clear();
  });

  it("returns not ready before startup completes", () => {
    const result = checkReadiness();
    expect(result.ready).toBe(false);
    expect(result.checks.startup.healthy).toBe(false);
    expect(result.checks.startup.message).toBe("Startup in progress");
  });

  it("returns not ready when cron scheduler is not running", () => {
    markStartupComplete();
    const result = checkReadiness();
    expect(result.checks.cron.healthy).toBe(false);
    expect(result.checks.cron.message).toBe("Cron scheduler not started");
  });

  it("checks memory db - file not found", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    markStartupComplete();
    markCronRunning();
    const result = checkReadiness();
    expect(result.checks.memory.healthy).toBe(false);
    expect(result.checks.memory.message).toBe("Database file not found");
  });

  it("checks memory db - file exists and accessible", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    markStartupComplete();
    markCronRunning();
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "test", name: "Test", available: true },
    ]);
    const result = checkReadiness();
    expect(result.checks.memory.healthy).toBe(true);
    expect(result.checks.memory.message).toBe("ok");
  });

  it("checks providers - none registered", () => {
    vi.mocked(providerRegistry.listProviders).mockReturnValue([]);
    const result = checkReadiness();
    expect(result.checks.providers.healthy).toBe(false);
    expect(result.checks.providers.message).toBe("No providers registered");
  });

  it("checks providers - none available", () => {
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "openai", name: "OpenAI", available: false },
    ]);
    const result = checkReadiness();
    expect(result.checks.providers.healthy).toBe(false);
    expect(result.checks.providers.message).toBe("0/1 providers available");
  });

  it("checks providers - at least one available", () => {
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "openai", name: "OpenAI", available: true },
      { id: "anthropic", name: "Anthropic", available: false },
    ]);
    const result = checkReadiness();
    expect(result.checks.providers.healthy).toBe(true);
    expect(result.checks.providers.message).toBe("1/2 providers available");
  });

  it("checks plugins - not ready during startup", () => {
    const result = checkReadiness();
    expect(result.checks.plugins.healthy).toBe(false);
    expect(result.checks.plugins.message).toBe(
      "Plugin loading still in progress",
    );
  });

  it("checks plugins - ready after startup with loaded plugins", () => {
    markStartupComplete();
    loadedPlugins.set("test-plugin", { plugin: {} as any, context: {} as any });
    const result = checkReadiness();
    expect(result.checks.plugins.healthy).toBe(true);
    expect(result.checks.plugins.message).toBe("1 plugin(s) loaded");
  });

  it("returns ready when all checks pass", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "openai", name: "OpenAI", available: true },
    ]);
    markStartupComplete();
    markCronRunning();
    loadedPlugins.set("test-plugin", { plugin: {} as any, context: {} as any });

    const result = checkReadiness();
    expect(result.ready).toBe(true);
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(Object.values(result.checks).every((c) => c.healthy)).toBe(true);
  });

  it("includes uptime in seconds", () => {
    const result = checkReadiness();
    expect(typeof result.uptime).toBe("number");
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });
});
