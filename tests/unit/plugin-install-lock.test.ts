/**
 * Tests for TOCTOU race fix in installAndActivatePlugin (WOP-1440)
 *
 * Verifies that concurrent install requests for the same plugin are
 * serialized — the second call awaits the first rather than racing.
 *
 * Lock semantics: when a second call arrives for the same source while
 * a first is in-flight, it receives the same Promise (not a new install).
 * This means installPlugin is called exactly once per concurrent group.
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

const { installAndActivatePlugin } = await import(
  "../../src/plugins/install-and-activate.js"
);

// ── Fixtures ──────────────────────────────────────────────────────────────

const SAMPLE_PLUGIN = {
  name: "test-plugin",
  version: "1.0.0",
  description: "A test plugin",
  source: "npm" as const,
  path: "/tmp/plugins/test-plugin",
  enabled: false,
  installedAt: Date.now(),
};

describe("installAndActivatePlugin TOCTOU lock (WOP-1440)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessions.mockResolvedValue({});
    mockInject.mockResolvedValue({ response: "" });
    mockCheckHealth.mockResolvedValue(undefined);
    mockEnablePlugin.mockResolvedValue(true);
    mockLoadPlugin.mockResolvedValue(undefined);
  });

  it("serializes concurrent installs — second call joins first, installPlugin called once", async () => {
    let resolveFirst!: () => void;
    const firstBlocks = new Promise<void>((r) => {
      resolveFirst = r;
    });

    // installPlugin blocks until we release it
    mockInstallPlugin.mockImplementationOnce(async () => {
      await firstBlocks;
      return { ...SAMPLE_PLUGIN };
    });

    // Start two concurrent installs for the same source
    const p1 = installAndActivatePlugin("lock-test-same-source-a1");
    const p2 = installAndActivatePlugin("lock-test-same-source-a1");

    // Both promises should be the same object — the lock returns the existing promise
    expect(p1).toBe(p2);

    // installPlugin should have been called exactly once (not twice)
    expect(mockInstallPlugin).toHaveBeenCalledTimes(1);

    resolveFirst();
    const [r1, r2] = await Promise.all([p1, p2]);

    // Both callers receive the same result
    expect(r1.plugin.name).toBe("test-plugin");
    expect(r2.plugin.name).toBe("test-plugin");

    // Still only one install happened
    expect(mockInstallPlugin).toHaveBeenCalledTimes(1);
  });

  it("releases lock on error so subsequent installs can proceed", async () => {
    // Use a fresh source to avoid interference from other tests
    mockInstallPlugin
      .mockRejectedValueOnce(new Error("npm failed"))
      .mockResolvedValueOnce({ ...SAMPLE_PLUGIN });

    // First attempt fails
    await expect(
      installAndActivatePlugin("lock-test-error-recovery-b2"),
    ).rejects.toThrow("npm failed");

    // Lock must be released in the finally block — second attempt should succeed
    const result = await installAndActivatePlugin("lock-test-error-recovery-b2");
    expect(result.plugin.name).toBe("test-plugin");
    expect(mockInstallPlugin).toHaveBeenCalledTimes(2);
  });

  it("allows concurrent installs for DIFFERENT sources to run in parallel", async () => {
    const callOrder: string[] = [];
    let resolveA!: () => void;
    const aBlocks = new Promise<void>((r) => {
      resolveA = r;
    });

    mockInstallPlugin
      .mockImplementationOnce(async () => {
        callOrder.push("install-a-start");
        await aBlocks;
        callOrder.push("install-a-end");
        return { ...SAMPLE_PLUGIN, name: "plugin-a" };
      })
      .mockImplementationOnce(async () => {
        callOrder.push("install-b");
        return { ...SAMPLE_PLUGIN, name: "plugin-b" };
      });

    const pA = installAndActivatePlugin("lock-test-different-source-c3a");
    const pB = installAndActivatePlugin("lock-test-different-source-c3b");

    // Different sources → different lock slots → both run concurrently
    // The two promises must be different objects
    expect(pA).not.toBe(pB);

    // Wait a tick for both to start
    await new Promise((r) => setTimeout(r, 10));

    // Both installs should have begun (no lock contention between different sources)
    expect(callOrder).toContain("install-a-start");
    expect(callOrder).toContain("install-b");

    resolveA();
    const [rA, rB] = await Promise.all([pA, pB]);
    expect(rA.plugin.name).toBe("plugin-a");
    expect(rB.plugin.name).toBe("plugin-b");
  });
});
