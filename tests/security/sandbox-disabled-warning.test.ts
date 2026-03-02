/**
 * Tests for sandbox-disabled startup warning (WOP-1510)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the plugin extension system — sandbox plugin NOT installed
vi.mock("../../src/plugins/extensions.js", () => ({
  getPluginExtension: vi.fn().mockReturnValue(undefined),
}));

const { logger } = await import("../../src/logger.js");
const { warnSandboxDisabled } = await import("../../src/security/sandbox.js");
const { DEFAULT_SECURITY_CONFIG } = await import("../../src/security/types.js");

describe("warnSandboxDisabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should log a warning when sandboxing is disabled and warnOnDisabledSandbox is true", () => {
    const config = { ...DEFAULT_SECURITY_CONFIG, warnOnDisabledSandbox: true };
    warnSandboxDisabled(config);

    expect(logger.warn).toHaveBeenCalledWith(
      "[SECURITY] Plugin sandboxing is disabled — plugins run with full process access. " +
        "Set sandbox.mode to 'non-main' or 'all' in config, or install wopr-plugin-sandbox. " +
        "To suppress this warning, set security.warnOnDisabledSandbox to false.",
    );
  });

  it("should NOT log a warning when warnOnDisabledSandbox is false", () => {
    const config = { ...DEFAULT_SECURITY_CONFIG, warnOnDisabledSandbox: false };
    warnSandboxDisabled(config);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should NOT log a warning when sandbox is enabled in config", () => {
    const config = {
      ...DEFAULT_SECURITY_CONFIG,
      warnOnDisabledSandbox: true,
      defaults: {
        ...DEFAULT_SECURITY_CONFIG.defaults,
        sandbox: { enabled: true, network: "bridge" as const },
      },
    };
    warnSandboxDisabled(config);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should default to warning when warnOnDisabledSandbox is undefined", () => {
    const config = { ...DEFAULT_SECURITY_CONFIG };
    delete (config as Record<string, unknown>).warnOnDisabledSandbox;
    warnSandboxDisabled(config);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("[SECURITY] Plugin sandboxing is disabled"));
  });
});
