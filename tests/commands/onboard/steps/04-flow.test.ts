import { beforeEach, describe, expect, it, vi } from "vitest";

const noteMock = vi.fn();
const selectMock = vi.fn();

vi.mock("../../../../src/commands/onboard/prompts.js", () => ({
  note: noteMock,
  select: selectMock,
  pc: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    blue: (s: string) => s,
  },
}));

describe("04-flow step", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    noteMock.mockResolvedValue(undefined);
  });

  it("should return empty when flow already set via CLI flag", async () => {
    const { flowStep } = await import(
      "../../../../src/commands/onboard/steps/04-flow.js"
    );

    const ctx = {
      opts: { flow: "quickstart" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await flowStep(ctx as Parameters<typeof flowStep>[0]);
    expect(result).toEqual({});
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("should set flow to quickstart when user selects it and show defaults note", async () => {
    selectMock.mockResolvedValue("quickstart");
    const { flowStep } = await import(
      "../../../../src/commands/onboard/steps/04-flow.js"
    );

    const ctx = {
      opts: {},
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await flowStep(ctx as Parameters<typeof flowStep>[0]);
    expect(result).toEqual({});
    expect((ctx.opts as { flow?: string }).flow).toBe("quickstart");
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining("QuickStart will use these defaults"),
      "QuickStart Defaults",
    );
  });

  it("should set flow to advanced when user selects it with no defaults note", async () => {
    selectMock.mockResolvedValue("advanced");
    const { flowStep } = await import(
      "../../../../src/commands/onboard/steps/04-flow.js"
    );

    const ctx = {
      opts: {},
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await flowStep(ctx as Parameters<typeof flowStep>[0]);
    expect(result).toEqual({});
    expect((ctx.opts as { flow?: string }).flow).toBe("advanced");
    expect(noteMock).not.toHaveBeenCalled();
  });
});
