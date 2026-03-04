import { beforeEach, describe, expect, it, vi } from "vitest";

const noteMock = vi.fn();
const confirmMock = vi.fn();
const multiselectMock = vi.fn();

vi.mock("../../../../src/commands/onboard/prompts.js", () => ({
  note: noteMock,
  confirm: confirmMock,
  multiselect: multiselectMock,
  pc: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    blue: (s: string) => s,
  },
}));

describe("08-skills step", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    noteMock.mockResolvedValue(undefined);
  });

  it("should skip and return empty when skipSkills flag is set", async () => {
    const { skillsStep } = await import(
      "../../../../src/commands/onboard/steps/08-skills.js"
    );

    const ctx = {
      opts: { skipSkills: true },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await skillsStep(ctx as Parameters<typeof skillsStep>[0]);
    expect(result).toEqual({});
    expect(noteMock).toHaveBeenCalledWith(
      "Skipping skills setup (--skip-skills)",
      "Skills",
    );
  });

  it("should return recommended skills in quickstart when user accepts", async () => {
    confirmMock.mockResolvedValue(true);
    const { skillsStep } = await import(
      "../../../../src/commands/onboard/steps/08-skills.js"
    );

    const ctx = {
      opts: { flow: "quickstart" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await skillsStep(ctx as Parameters<typeof skillsStep>[0]);
    expect(result).toEqual({ skills: ["file-ops", "memory"] });
  });

  it("should return empty skills in quickstart when user declines recommended", async () => {
    confirmMock.mockResolvedValue(false);
    const { skillsStep } = await import(
      "../../../../src/commands/onboard/steps/08-skills.js"
    );

    const ctx = {
      opts: { flow: "quickstart" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await skillsStep(ctx as Parameters<typeof skillsStep>[0]);
    expect(result).toEqual({ skills: [] });
  });

  it("should return user-selected skills in advanced mode via multiselect", async () => {
    multiselectMock.mockResolvedValue(["file-ops", "web-search"]);
    const { skillsStep } = await import(
      "../../../../src/commands/onboard/steps/08-skills.js"
    );

    const ctx = {
      opts: { flow: "advanced" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await skillsStep(ctx as Parameters<typeof skillsStep>[0]);
    expect(multiselectMock).toHaveBeenCalled();
    expect(result).toEqual({ skills: ["file-ops", "web-search"] });
  });
});
