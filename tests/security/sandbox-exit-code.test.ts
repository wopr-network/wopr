/**
 * Sandbox Docker exit code tests (WOP-611)
 *
 * Tests that signal-killed Docker processes are not masked as success.
 * Verifies that signal kills produce proper Unix exit codes (128+N),
 * that logger.warn is called for signal kills, and that null/null
 * is treated as a generic failure.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock logger — must be set up before any module imports
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the plugin extension system so sandbox.ts takes the execDockerDirect path
vi.mock("../../src/plugins/extensions.js", () => ({
  getPluginExtension: vi.fn(() => undefined),
}));

// Mock security context
vi.mock("../../src/security/context.js", () => ({
  getContext: vi.fn(() => null),
}));

// Mock child_process.spawn — return a fake ChildProcess EventEmitter
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import logger after mocks are set up
const { logger } = await import("../../src/logger.js");

// Helper: create a fake ChildProcess that emits close/error events
function createFakeChild() {
  const child = new EventEmitter();
  (child as unknown as Record<string, unknown>).stdout = new EventEmitter();
  (child as unknown as Record<string, unknown>).stderr = new EventEmitter();
  return child;
}

describe("execDockerDirect signal handling (WOP-611)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when process exits normally with code 0", async () => {
    const fakeChild = createFakeChild();
    spawnMock.mockReturnValue(fakeChild);

    const sandbox = await import("../../src/security/sandbox.js");
    const promise = sandbox.isDockerAvailable();

    // Simulate successful exit
    fakeChild.emit("close", 0, null);

    const result = await promise;
    expect(result).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns false when process exits with non-zero code 1", async () => {
    const fakeChild = createFakeChild();
    spawnMock.mockReturnValue(fakeChild);

    const sandbox = await import("../../src/security/sandbox.js");
    const promise = sandbox.isDockerAvailable();

    fakeChild.emit("close", 1, null);

    const result = await promise;
    expect(result).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns false when process is killed by SIGKILL (code=null, signal=SIGKILL)", async () => {
    const fakeChild = createFakeChild();
    spawnMock.mockReturnValue(fakeChild);

    const sandbox = await import("../../src/security/sandbox.js");
    const promise = sandbox.isDockerAvailable();

    // Simulate OOM kill / docker stop timeout: code=null, signal=SIGKILL
    fakeChild.emit("close", null, "SIGKILL");

    const result = await promise;
    // Should be false because exit code 137 !== 0
    expect(result).toBe(false);
  });

  it("logs a warning with signal name and exit code 137 when SIGKILL", async () => {
    const fakeChild = createFakeChild();
    spawnMock.mockReturnValue(fakeChild);

    const sandbox = await import("../../src/security/sandbox.js");
    const promise = sandbox.isDockerAvailable();

    fakeChild.emit("close", null, "SIGKILL");

    await promise;
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("SIGKILL"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("137"));
  });

  it("returns exit code 143 (128+15) when killed by SIGTERM", async () => {
    const fakeChild = createFakeChild();
    spawnMock.mockReturnValue(fakeChild);

    const sandbox = await import("../../src/security/sandbox.js");
    const promise = sandbox.isDockerAvailable();

    fakeChild.emit("close", null, "SIGTERM");

    const result = await promise;
    // SIGTERM = 15, so 128+15 = 143 — not 0, so docker is not available
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("SIGTERM"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("143"));
  });

  it("returns false and logs warning when both code and signal are null", async () => {
    const fakeChild = createFakeChild();
    spawnMock.mockReturnValue(fakeChild);

    const sandbox = await import("../../src/security/sandbox.js");
    const promise = sandbox.isDockerAvailable();

    // Defensive case: neither code nor signal
    fakeChild.emit("close", null, null);

    const result = await promise;
    // Should be 1 (generic failure), not 0
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("null"));
  });

  it("preserves normal non-zero exit code 127 without logging a warning", async () => {
    const fakeChild = createFakeChild();
    spawnMock.mockReturnValue(fakeChild);

    const sandbox = await import("../../src/security/sandbox.js");
    const promise = sandbox.isDockerAvailable();

    // Command not found
    fakeChild.emit("close", 127, null);

    const result = await promise;
    expect(result).toBe(false);
    // No warn for normal non-zero exit
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
