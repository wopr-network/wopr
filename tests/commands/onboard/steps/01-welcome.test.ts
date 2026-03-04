import { beforeEach, describe, expect, it, vi } from "vitest";

const noteMock = vi.fn();
const introMock = vi.fn();
const printHeaderMock = vi.fn();

vi.mock("../../../../src/commands/onboard/prompts.js", () => ({
  note: noteMock,
  intro: introMock,
  printHeader: printHeaderMock,
  pc: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    blue: (s: string) => s,
  },
}));

describe("01-welcome step", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    noteMock.mockResolvedValue(undefined);
    introMock.mockResolvedValue(undefined);
    printHeaderMock.mockReturnValue(undefined);
  });

  it("should call printHeader, intro, and note then return empty object", async () => {
    const { welcomeStep } = await import(
      "../../../../src/commands/onboard/steps/01-welcome.js"
    );

    const ctx = {
      opts: {},
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await welcomeStep(ctx as Parameters<typeof welcomeStep>[0]);

    expect(result).toEqual({});
    expect(printHeaderMock).toHaveBeenCalledOnce();
    expect(introMock).toHaveBeenCalledWith("WOPR Onboarding");
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining("This wizard will help you set up WOPR"),
      "What we'll do",
    );
  });
});
