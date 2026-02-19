/**
 * Unit tests for sandbox setup step execSync timeout handling (WOP-613)
 *
 * Verifies that execSync calls for docker pull and docker tag use
 * timeout: 120_000 and that the function handles timeouts gracefully.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process at module level (dynamic import in production code picks this up)
const execSyncMock = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: any[]) => execSyncMock(...args),
}));

// Mock clack prompts used by the step
vi.mock("../../src/commands/onboard/prompts.js", () => ({
  note: vi.fn(),
  spinner: vi.fn(() =>
    Promise.resolve({
      start: vi.fn(),
      stop: vi.fn(),
    }),
  ),
  confirm: vi.fn(),
  select: vi.fn(),
  pc: { dim: (s: string) => s, yellow: (s: string) => s },
}));

describe("sandbox setup execSync timeout (WOP-613)", () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it("passes timeout: 120_000 to docker pull execSync call", async () => {
    // docker image inspect throws (image not found), then pull succeeds, then tag succeeds
    execSyncMock
      .mockImplementationOnce(() => {
        throw new Error("No such image");
      }) // docker image inspect
      .mockReturnValueOnce(undefined) // docker pull
      .mockReturnValueOnce(undefined); // docker tag

    const { buildSandboxImage } = await import(
      "../../src/commands/onboard/steps/02b-sandbox.js"
    );
    await buildSandboxImage();

    const pullCall = execSyncMock.mock.calls.find((call) =>
      String(call[0]).includes("docker pull"),
    );
    expect(pullCall).toBeDefined();
    expect(pullCall![1]).toMatchObject({ timeout: 120_000 });
  });

  it("passes timeout: 120_000 to docker tag execSync call", async () => {
    execSyncMock
      .mockImplementationOnce(() => {
        throw new Error("No such image");
      }) // docker image inspect
      .mockReturnValueOnce(undefined) // docker pull
      .mockReturnValueOnce(undefined); // docker tag

    const { buildSandboxImage } = await import(
      "../../src/commands/onboard/steps/02b-sandbox.js"
    );
    await buildSandboxImage();

    const tagCall = execSyncMock.mock.calls.find((call) =>
      String(call[0]).includes("docker tag"),
    );
    expect(tagCall).toBeDefined();
    expect(tagCall![1]).toMatchObject({ timeout: 120_000 });
  });

  it("returns false and does not throw when docker pull times out", async () => {
    // Node throws an Error with signal SIGTERM when execSync timeout is exceeded
    const timeoutError = Object.assign(
      new Error("spawnSync docker ETIMEDOUT"),
      { signal: "SIGTERM", killed: true },
    );

    execSyncMock
      .mockImplementationOnce(() => {
        throw new Error("No such image");
      }) // docker image inspect
      .mockImplementationOnce(() => {
        throw timeoutError;
      }); // docker pull times out

    const { buildSandboxImage } = await import(
      "../../src/commands/onboard/steps/02b-sandbox.js"
    );
    const result = await buildSandboxImage();

    // Should return false without throwing
    expect(result).toBe(false);
  });
});
