import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the logger before importing handlers
vi.mock("../../src/logger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  shouldLogStack: vi.fn().mockReturnValue(false),
}));

import { handleUncaughtException, handleUnhandledRejection } from "../../src/daemon/index.js";

describe("daemon crash handlers", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe("handleUncaughtException", () => {
    it("logs the error and exits with code 1", () => {
      const err = new Error("test uncaught");
      handleUncaughtException(err);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("handleUnhandledRejection", () => {
    it("logs an Error reason and exits with code 1", () => {
      const err = new Error("test rejection");
      handleUnhandledRejection(err, Promise.resolve());
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("logs a string reason and exits with code 1", () => {
      handleUnhandledRejection("string reason", Promise.resolve());
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
