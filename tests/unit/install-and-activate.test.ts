/**
 * Tests for src/plugins/install-and-activate.ts (WOP-1487)
 *
 * Verifies that installAndActivatePlugin():
 * 1. Calls installPlugin with the given source
 * 2. Enables the plugin
 * 3. Loads the plugin (hot-load)
 * 4. Runs providerRegistry.checkHealth()
 *
 * Also verifies createInjectors() builds the correct injector shape.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockInstallPlugin = vi.fn();
const mockEnablePlugin = vi.fn();
const mockLoadPlugin = vi.fn();

vi.mock("../../src/plugins.js", () => ({
  installPlugin: mockInstallPlugin,
  enablePlugin: mockEnablePlugin,
  loadPlugin: mockLoadPlugin,
}));

const mockCheckHealth = vi.fn();
vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: { checkHealth: mockCheckHealth },
}));

const mockGetSessions = vi.fn();
const mockInject = vi.fn();
vi.mock("../../src/core/sessions.js", () => ({
  getSessions: mockGetSessions,
  inject: mockInject,
}));

// ── Import after mocks ────────────────────────────────────────────────────

const { installAndActivatePlugin, createInjectors } = await import(
  "../../src/plugins/install-and-activate.js"
);

// ── Fixtures ──────────────────────────────────────────────────────────────

const SAMPLE_PLUGIN = {
  name: "test-plugin",
  version: "1.0.0",
  description: "A test plugin",
  source: "npm" as const,
  path: "/plugins/test-plugin",
  enabled: false,
  installedAt: Date.now(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInstallPlugin.mockResolvedValue(SAMPLE_PLUGIN);
  mockEnablePlugin.mockResolvedValue(true);
  mockLoadPlugin.mockResolvedValue(undefined);
  mockCheckHealth.mockResolvedValue(undefined);
  mockGetSessions.mockResolvedValue({ "session-1": {}, "session-2": {} });
  mockInject.mockResolvedValue({ response: "ok" });
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("installAndActivatePlugin", () => {
  it("calls installPlugin with the given source", async () => {
    await installAndActivatePlugin("my-plugin");
    expect(mockInstallPlugin).toHaveBeenCalledWith("my-plugin");
  });

  it("enables the plugin after installation", async () => {
    await installAndActivatePlugin("my-plugin");
    expect(mockEnablePlugin).toHaveBeenCalledWith("test-plugin");
  });

  it("hot-loads the plugin", async () => {
    await installAndActivatePlugin("my-plugin");
    expect(mockLoadPlugin).toHaveBeenCalledWith(SAMPLE_PLUGIN, expect.any(Object));
  });

  it("runs providerRegistry.checkHealth after loading", async () => {
    await installAndActivatePlugin("my-plugin");
    expect(mockCheckHealth).toHaveBeenCalled();
  });

  it("returns the installed plugin", async () => {
    const result = await installAndActivatePlugin("my-plugin");
    expect(result.plugin).toEqual(SAMPLE_PLUGIN);
  });

  it("calls steps in order: install → enable → load → checkHealth", async () => {
    const order: string[] = [];
    mockInstallPlugin.mockImplementation(async () => {
      order.push("install");
      return SAMPLE_PLUGIN;
    });
    mockEnablePlugin.mockImplementation(async () => {
      order.push("enable");
    });
    mockLoadPlugin.mockImplementation(async () => {
      order.push("load");
    });
    mockCheckHealth.mockImplementation(async () => {
      order.push("checkHealth");
    });

    await installAndActivatePlugin("my-plugin");
    expect(order).toEqual(["install", "enable", "load", "checkHealth"]);
  });

  it("propagates errors from installPlugin", async () => {
    mockInstallPlugin.mockRejectedValue(new Error("npm install failed"));
    await expect(installAndActivatePlugin("bad-plugin")).rejects.toThrow("npm install failed");
    expect(mockEnablePlugin).not.toHaveBeenCalled();
    expect(mockCheckHealth).not.toHaveBeenCalled();
  });

  it("propagates errors from enablePlugin", async () => {
    mockEnablePlugin.mockRejectedValue(new Error("enable failed"));
    await expect(installAndActivatePlugin("my-plugin")).rejects.toThrow("enable failed");
    expect(mockLoadPlugin).not.toHaveBeenCalled();
    expect(mockCheckHealth).not.toHaveBeenCalled();
  });

  it("propagates errors from loadPlugin", async () => {
    mockLoadPlugin.mockRejectedValue(new Error("load failed"));
    await expect(installAndActivatePlugin("my-plugin")).rejects.toThrow("load failed");
    expect(mockCheckHealth).not.toHaveBeenCalled();
  });
});

describe("createInjectors", () => {
  it("returns an object with inject and getSessions methods", async () => {
    const injectors = await createInjectors();
    expect(typeof injectors.inject).toBe("function");
    expect(typeof injectors.getSessions).toBe("function");
  });

  it("getSessions returns session keys", async () => {
    const injectors = await createInjectors();
    const sessions = injectors.getSessions();
    expect(sessions).toEqual(["session-1", "session-2"]);
  });

  it("inject delegates to core inject with silent:true", async () => {
    const injectors = await createInjectors();
    await injectors.inject("session-1", "hello");
    expect(mockInject).toHaveBeenCalledWith("session-1", "hello", { silent: true });
  });

  it("inject passes through extra options merged after silent:true default", async () => {
    const injectors = await createInjectors();
    await injectors.inject("session-1", "hello", { silent: false });
    // options spread after { silent: true }, so caller can override silent
    expect(mockInject).toHaveBeenCalledWith("session-1", "hello", { silent: false });
  });

  it("inject returns the response string", async () => {
    mockInject.mockResolvedValue({ response: "pong" });
    const injectors = await createInjectors();
    const result = await injectors.inject("session-1", "ping");
    expect(result).toBe("pong");
  });
});
