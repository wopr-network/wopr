/**
 * Config command tests (WOP-1473)
 *
 * Verifies that `wopr config set` notifies the running daemon,
 * and succeeds silently when the daemon is not running.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../../src/core/config.js", () => {
  const configInstance = {
    load: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockReturnValue({}),
    getValue: vi.fn(),
    setValue: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  };
  return { config: configInstance };
});

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/daemon/auth-token.js", () => ({
  getToken: vi.fn(() => "test-token"),
}));

// We need to mock fetch globally to intercept WoprClient calls
let fetchMock: ReturnType<typeof vi.fn>;

import { config } from "../../src/core/config.js";
import { configCommand } from "../../src/commands/config.js";

const mockedConfig = vi.mocked(config);

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("configCommand", () => {
  describe("set subcommand", () => {
    it("should notify daemon after writing config to disk", async () => {
      // Daemon is running — fetch succeeds
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ key: "daemon.port", value: 9999 }),
      });

      await configCommand("set", ["daemon.port", "9999"]);

      // Config was written to disk
      expect(mockedConfig.setValue).toHaveBeenCalledWith("daemon.port", 9999);
      expect(mockedConfig.save).toHaveBeenCalled();

      // Daemon was notified via PUT /config/daemon.port
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/config/daemon.port"),
        expect.objectContaining({ method: "PUT" }),
      );
    });

    it("should succeed silently when daemon is not running", async () => {
      // Daemon is not running — fetch throws ECONNREFUSED
      fetchMock.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

      // Should NOT throw
      await configCommand("set", ["plugins.autoLoad", "true"]);

      // Config was still written to disk
      expect(mockedConfig.setValue).toHaveBeenCalledWith("plugins.autoLoad", true);
      expect(mockedConfig.save).toHaveBeenCalled();
    });

    it("should succeed silently when daemon returns an error", async () => {
      // Daemon returns 500
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: "Internal server error" }),
      });

      // Should NOT throw
      await configCommand("set", ["daemon.host", "0.0.0.0"]);

      // Config was still written to disk
      expect(mockedConfig.setValue).toHaveBeenCalledWith("daemon.host", "0.0.0.0");
      expect(mockedConfig.save).toHaveBeenCalled();
    });
  });

  describe("reset subcommand", () => {
    it("should notify daemon after resetting config", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ message: "Config reset to defaults" }),
      });

      await configCommand("reset", []);

      expect(mockedConfig.reset).toHaveBeenCalled();
      expect(mockedConfig.save).toHaveBeenCalled();

      // Daemon was notified via DELETE /config
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/config"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("should succeed silently when daemon is not running on reset", async () => {
      fetchMock.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

      await configCommand("reset", []);

      expect(mockedConfig.reset).toHaveBeenCalled();
      expect(mockedConfig.save).toHaveBeenCalled();
    });
  });
});
