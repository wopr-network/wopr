import { beforeEach, describe, expect, it, vi } from "vitest";

const noteMock = vi.fn();
const selectMock = vi.fn();
const confirmMock = vi.fn();

const configMock = {
  load: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockReturnValue({}),
};

vi.mock("../../../../src/commands/onboard/prompts.js", () => ({
  note: noteMock,
  confirm: confirmMock,
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

vi.mock("../../../../src/core/config.js", () => ({
  config: configMock,
}));

vi.mock("../../../../src/commands/onboard/helpers.js", () => ({
  DEFAULT_WORKSPACE: "/home/test/.wopr/workspace",
  summarizeExistingConfig: vi.fn().mockReturnValue("provider: anthropic"),
}));

describe("03-config-check step", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    noteMock.mockResolvedValue(undefined);
    configMock.load.mockResolvedValue(undefined);
    configMock.get.mockReturnValue({});
  });

  it("should return empty object when no existing config found", async () => {
    configMock.get.mockReturnValue({});
    const { configCheckStep } = await import(
      "../../../../src/commands/onboard/steps/03-config-check.js"
    );

    const ctx = {
      opts: {},
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await configCheckStep(
      ctx as Parameters<typeof configCheckStep>[0],
    );
    expect(result).toEqual({});
    expect(noteMock).toHaveBeenCalledWith(
      "No existing configuration found. Starting fresh setup.",
      "Configuration",
    );
  });

  it("should return existing config when user chooses 'keep'", async () => {
    configMock.get.mockReturnValue({
      provider: { primary: "anthropic" },
      workspace: "/home/test/.wopr/workspace",
      gateway: { port: 3000 },
      channels: ["discord"],
      skills: [],
      plugins: [],
    });
    selectMock.mockResolvedValue("keep");
    const { configCheckStep } = await import(
      "../../../../src/commands/onboard/steps/03-config-check.js"
    );

    const ctx = {
      opts: {},
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await configCheckStep(
      ctx as Parameters<typeof configCheckStep>[0],
    );
    expect(result).toEqual({
      workspace: "/home/test/.wopr/workspace",
      provider: { primary: "anthropic" },
      gateway: { port: 3000 },
      channels: ["discord"],
      skills: [],
      plugins: [],
    });
  });

  it("should reset config when user chooses 'reset' and confirms", async () => {
    configMock.get.mockReturnValue({ provider: { primary: "anthropic" } });
    selectMock.mockResolvedValue("reset");
    confirmMock.mockResolvedValue(true);
    const { configCheckStep } = await import(
      "../../../../src/commands/onboard/steps/03-config-check.js"
    );

    const ctx = {
      opts: {},
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await configCheckStep(
      ctx as Parameters<typeof configCheckStep>[0],
    );
    expect(result).toEqual({
      workspace: "/home/test/.wopr/workspace",
      provider: undefined,
      gateway: undefined,
      channels: [],
      skills: [],
      plugins: [],
    });
  });

  it("should return existing config with defaults when user chooses 'modify'", async () => {
    configMock.get.mockReturnValue({ provider: { primary: "openai" } });
    selectMock.mockResolvedValue("modify");
    const { configCheckStep } = await import(
      "../../../../src/commands/onboard/steps/03-config-check.js"
    );

    const ctx = {
      opts: {},
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await configCheckStep(
      ctx as Parameters<typeof configCheckStep>[0],
    );
    expect(result).toEqual({
      workspace: "/home/test/.wopr/workspace",
      provider: { primary: "openai" },
      gateway: undefined,
      channels: [],
      skills: [],
      plugins: [],
    });
  });
});
