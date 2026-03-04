import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmMock = vi.fn();
const noteMock = vi.fn();

vi.mock("../../../../src/commands/onboard/prompts.js", () => ({
  note: noteMock,
  confirm: confirmMock,
  pc: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    blue: (s: string) => s,
  },
  WizardCancelledError: class WizardCancelledError extends Error {
    constructor(msg = "Wizard cancelled") {
      super(msg);
      this.name = "WizardCancelledError";
    }
  },
}));

describe("02-security step", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    noteMock.mockResolvedValue(undefined);
  });

  it("should skip when acceptRisk flag is true", async () => {
    confirmMock.mockResolvedValue(true);
    const { securityStep } = await import(
      "../../../../src/commands/onboard/steps/02-security.js"
    );

    const ctx = {
      opts: { acceptRisk: true },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await securityStep(ctx as Parameters<typeof securityStep>[0]);
    expect(result).toEqual({});
    expect(confirmMock).not.toHaveBeenCalled();
    expect(noteMock).not.toHaveBeenCalled();
  });

  it("should display security notice and return empty on acceptance", async () => {
    confirmMock.mockResolvedValue(true);
    const { securityStep } = await import(
      "../../../../src/commands/onboard/steps/02-security.js"
    );

    const ctx = {
      opts: { acceptRisk: false },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await securityStep(ctx as Parameters<typeof securityStep>[0]);
    expect(result).toEqual({});
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining("Security"),
      "Security Notice",
    );
    expect(confirmMock).toHaveBeenCalledOnce();
  });

  it("should throw WizardCancelledError when user declines", async () => {
    confirmMock.mockResolvedValue(false);
    const { securityStep } = await import(
      "../../../../src/commands/onboard/steps/02-security.js"
    );

    const ctx = {
      opts: { acceptRisk: false },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    await expect(
      securityStep(ctx as Parameters<typeof securityStep>[0]),
    ).rejects.toThrow("Security acknowledgment required");
  });
});
