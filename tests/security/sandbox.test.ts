/**
 * Security Sandbox Tests (WOP-612)
 *
 * Tests destroySandbox multi-container cleanup and related sandbox functions.
 * Bug: destroySandbox() used .split("\n")[0] — only removed first container.
 * Fix: iterate all container names, like cleanupAllSandboxes() already does.
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

// Mock child_process.spawn to avoid real Docker execution
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

// Mock the plugin extension system so getSandboxExtension() returns undefined
// (forces the code to use execDockerDirect, which uses the mocked spawn)
vi.mock("../../src/plugins/extensions.js", () => ({
  getPluginExtension: vi.fn(() => undefined),
}));

// Mock the security context module
vi.mock("../../src/security/context.js", () => ({
  getContext: vi.fn(() => null),
}));

// Import after mocks
const { destroySandbox, cleanupAllSandboxes } = await import("../../src/security/sandbox.js");

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock child process that writes stdout and emits close.
 * Mirrors the helper in tests/security/hooks.test.ts.
 */
function createMockProcess(stdout: string, exitCode = 0) {
  const stdoutCallbacks: Record<string, Function[]> = {};
  const stderrCallbacks: Record<string, Function[]> = {};
  const procCallbacks: Record<string, Function[]> = {};

  const stdoutStream = {
    on: (event: string, cb: Function) => {
      stdoutCallbacks[event] = stdoutCallbacks[event] || [];
      stdoutCallbacks[event].push(cb);
      // Emit data immediately for "data" listeners
      if (event === "data") {
        queueMicrotask(() => cb(Buffer.from(stdout)));
      }
    },
  };

  const stderrStream = {
    on: (event: string, cb: Function) => {
      stderrCallbacks[event] = stderrCallbacks[event] || [];
      stderrCallbacks[event].push(cb);
    },
  };

  return {
    stdout: stdoutStream,
    stderr: stderrStream,
    on: (event: string, cb: Function) => {
      procCallbacks[event] = procCallbacks[event] || [];
      procCallbacks[event].push(cb);
      // Emit close after a tick
      if (event === "close") {
        queueMicrotask(() => cb(exitCode));
      }
    },
  };
}

// ============================================================================
// destroySandbox tests
// ============================================================================

describe("destroySandbox", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes a single container matching the session label", async () => {
    // First call: docker ps returns one container
    const listProc = createMockProcess("wopr-sandbox-abc\n");
    // Second call: docker rm -f succeeds
    const rmProc = createMockProcess("");
    spawnMock.mockReturnValueOnce(listProc).mockReturnValueOnce(rmProc);

    await destroySandbox("my-session");

    // 1 ps + 1 rm = 2 calls
    expect(spawnMock).toHaveBeenCalledTimes(2);

    // Verify ps command filters by session label
    const psArgs = spawnMock.mock.calls[0][1] as string[];
    expect(psArgs).toContain("--filter");
    expect(psArgs).toContain("label=wopr.sessionKey=my-session");

    // Verify rm -f was called with the container name
    const rmArgs = spawnMock.mock.calls[1][1] as string[];
    expect(rmArgs).toContain("rm");
    expect(rmArgs).toContain("-f");
    expect(rmArgs).toContain("wopr-sandbox-abc");
  });

  it("removes ALL containers when multiple match the session label", async () => {
    // docker ps returns THREE containers (the bug only removed the first)
    const listProc = createMockProcess("container-1\ncontainer-2\ncontainer-3\n");
    const rmProc1 = createMockProcess("");
    const rmProc2 = createMockProcess("");
    const rmProc3 = createMockProcess("");
    spawnMock
      .mockReturnValueOnce(listProc)
      .mockReturnValueOnce(rmProc1)
      .mockReturnValueOnce(rmProc2)
      .mockReturnValueOnce(rmProc3);

    await destroySandbox("multi-session");

    // 1 ps + 3 rm = 4 total calls
    expect(spawnMock).toHaveBeenCalledTimes(4);

    // Verify all three containers were individually removed
    const rmCalls = spawnMock.mock.calls.slice(1);
    const removedContainers = rmCalls.map((call: any) => {
      const args = call[1] as string[];
      return args[args.length - 1]; // last arg is the container name
    });
    expect(removedContainers).toContain("container-1");
    expect(removedContainers).toContain("container-2");
    expect(removedContainers).toContain("container-3");
  });

  it("does nothing when no containers match (empty docker ps output)", async () => {
    const listProc = createMockProcess("");
    spawnMock.mockReturnValueOnce(listProc);

    await destroySandbox("no-match-session");

    // Only the ps call — no rm calls
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when docker ps fails (non-zero exit code)", async () => {
    const listProc = createMockProcess("", 1); // exit code 1
    spawnMock.mockReturnValueOnce(listProc);

    // Should not throw — allowFailure: true means failure is handled gracefully
    await destroySandbox("fail-session");

    // Only the ps call — no rm calls attempted after failure
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("skips empty lines in docker ps output without making empty rm calls", async () => {
    // Trailing and interior empty lines from docker ps
    const listProc = createMockProcess("container-a\n\n\ncontainer-b\n\n");
    const rmProc1 = createMockProcess("");
    const rmProc2 = createMockProcess("");
    spawnMock
      .mockReturnValueOnce(listProc)
      .mockReturnValueOnce(rmProc1)
      .mockReturnValueOnce(rmProc2);

    await destroySandbox("newline-session");

    // 1 ps + 2 rm = 3 (not 5 — empty lines are filtered)
    expect(spawnMock).toHaveBeenCalledTimes(3);

    const rmCalls = spawnMock.mock.calls.slice(1);
    const removedContainers = rmCalls.map((call: any) => {
      const args = call[1] as string[];
      return args[args.length - 1];
    });
    expect(removedContainers).toContain("container-a");
    expect(removedContainers).toContain("container-b");
  });

  it("continues removing remaining containers if one rm call fails", async () => {
    // Two containers — first rm fails, second should still be attempted
    const listProc = createMockProcess("container-x\ncontainer-y\n");
    const rmProc1 = createMockProcess("", 1); // fails
    const rmProc2 = createMockProcess("", 0); // succeeds
    spawnMock
      .mockReturnValueOnce(listProc)
      .mockReturnValueOnce(rmProc1)
      .mockReturnValueOnce(rmProc2);

    // Should not throw — each rm uses allowFailure: true
    await destroySandbox("partial-fail-session");

    // Both rm calls should have been attempted
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });
});

// ============================================================================
// cleanupAllSandboxes regression tests (already correct — ensure no regressions)
// ============================================================================

describe("cleanupAllSandboxes", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes all sandbox-labeled containers", async () => {
    const listProc = createMockProcess("sandbox-a\nsandbox-b\n");
    const rmProc1 = createMockProcess("");
    const rmProc2 = createMockProcess("");
    spawnMock
      .mockReturnValueOnce(listProc)
      .mockReturnValueOnce(rmProc1)
      .mockReturnValueOnce(rmProc2);

    await cleanupAllSandboxes();

    // 1 ps + 2 rm = 3 calls
    expect(spawnMock).toHaveBeenCalledTimes(3);

    // ps uses the global sandbox label (not a session key)
    const psArgs = spawnMock.mock.calls[0][1] as string[];
    expect(psArgs).toContain("--filter");
    expect(psArgs).toContain("label=wopr.sandbox=1");

    // Both containers were removed
    expect(spawnMock.mock.calls[1][1]).toContain("sandbox-a");
    expect(spawnMock.mock.calls[2][1]).toContain("sandbox-b");
  });

  it("does nothing when no sandbox containers exist", async () => {
    const listProc = createMockProcess("");
    spawnMock.mockReturnValueOnce(listProc);

    await cleanupAllSandboxes();

    // Only the ps call
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
