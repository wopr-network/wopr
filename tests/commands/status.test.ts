import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock shared module before importing status
vi.mock("../../src/commands/shared.js", () => ({
  client: {
    isRunning: vi.fn(),
    getPlugins: vi.fn(),
    getProviders: vi.fn(),
  },
  getDaemonPid: vi.fn(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { statusCommand } from "../../src/commands/status.js";
import { client, getDaemonPid } from "../../src/commands/shared.js";
import { logger } from "../../src/logger.js";

describe("statusCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows daemon stopped when not running", async () => {
    vi.mocked(getDaemonPid).mockReturnValue(null);
    vi.mocked(client.isRunning).mockResolvedValue(false);

    await statusCommand();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("stopped"),
    );
  });

  it("shows daemon running with plugin and provider counts", async () => {
    vi.mocked(getDaemonPid).mockReturnValue(12345);
    vi.mocked(client.isRunning).mockResolvedValue(true);
    vi.mocked(client.getPlugins).mockResolvedValue([
      { name: "wopr-plugin-cron", enabled: true },
      { name: "wopr-plugin-skills", enabled: true },
    ]);
    vi.mocked(client.getProviders).mockResolvedValue([
      { id: "anthropic", available: true },
      { id: "codex", available: false },
    ]);

    await statusCommand();

    const calls = vi.mocked(logger.info).mock.calls.map((c) => c[0]);
    const output = calls.join("\n");
    expect(output).toContain("running");
    expect(output).toContain("12345");
    expect(output).toContain("2 loaded"); // 2 plugins loaded
    expect(output).toContain("1/2 active"); // 1 of 2 providers active
  });

  it("handles daemon running but API unreachable", async () => {
    vi.mocked(getDaemonPid).mockReturnValue(99999);
    vi.mocked(client.isRunning).mockResolvedValue(false);

    await statusCommand();

    const calls = vi.mocked(logger.info).mock.calls.map((c) => c[0]);
    const output = calls.join("\n");
    expect(output).toContain("99999");
    expect(output).toContain("not responding");
  });
});
