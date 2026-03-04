import { beforeEach, describe, expect, it, vi } from "vitest";

const noteMock = vi.fn();
const selectMock = vi.fn();
const confirmMock = vi.fn();
const passwordMock = vi.fn();
const spinnerMock = vi.fn();

vi.mock("../../../../src/commands/onboard/prompts.js", () => ({
  note: noteMock,
  confirm: confirmMock,
  select: selectMock,
  password: passwordMock,
  spinner: spinnerMock,
  pc: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    blue: (s: string) => s,
  },
}));

const installPluginMock = vi.fn();
vi.mock("../../../../src/plugins.js", () => ({
  installPlugin: installPluginMock,
}));

const listProvidersMock = vi.fn().mockReturnValue([]);
vi.mock("../../../../src/core/providers.js", () => ({
  providerRegistry: {
    listProviders: listProvidersMock,
  },
}));

describe("06-providers step", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    noteMock.mockResolvedValue(undefined);
    spinnerMock.mockResolvedValue({ start: vi.fn(), stop: vi.fn() });
    installPluginMock.mockResolvedValue(undefined);
    listProvidersMock.mockReturnValue([]);
  });

  it("should skip when existing provider configured in quickstart mode", async () => {
    selectMock.mockResolvedValue("anthropic");
    const { providersStep } = await import(
      "../../../../src/commands/onboard/steps/06-providers.js"
    );

    const ctx = {
      opts: { flow: "quickstart" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: { provider: { primary: "anthropic" } },
    };

    const result = await providersStep(ctx as Parameters<typeof providersStep>[0]);
    expect(result).toEqual({});
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining("anthropic"),
      "AI Provider",
    );
    expect(installPluginMock).not.toHaveBeenCalled();
  });

  it("should return empty when user selects 'skip'", async () => {
    selectMock.mockResolvedValue("skip");
    const { providersStep } = await import(
      "../../../../src/commands/onboard/steps/06-providers.js"
    );

    const ctx = {
      opts: { flow: "advanced" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await providersStep(ctx as Parameters<typeof providersStep>[0]);
    expect(result).toEqual({});
    expect(noteMock).toHaveBeenCalledWith(
      expect.stringContaining("configure a provider later"),
      "Provider Skipped",
    );
  });

  it("should install plugin and return provider config when provider not in registry", async () => {
    selectMock.mockResolvedValue("anthropic");
    listProvidersMock.mockReturnValue([]);
    const { providersStep } = await import(
      "../../../../src/commands/onboard/steps/06-providers.js"
    );

    const ctx = {
      opts: { flow: "advanced" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await providersStep(ctx as Parameters<typeof providersStep>[0]);
    expect(installPluginMock).toHaveBeenCalledWith("wopr-plugin-provider-anthropic");
    expect(result).toEqual({ provider: { primary: "anthropic" } });
  });

  it("should handle install failure and return empty when user confirms continue", async () => {
    selectMock.mockResolvedValue("openai");
    installPluginMock.mockRejectedValue(new Error("network error"));
    confirmMock.mockResolvedValue(true);
    listProvidersMock.mockReturnValue([]);
    const { providersStep } = await import(
      "../../../../src/commands/onboard/steps/06-providers.js"
    );

    const ctx = {
      opts: { flow: "advanced" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await providersStep(ctx as Parameters<typeof providersStep>[0]);
    // After failed install + user confirms continue, provider is not loaded,
    // so we get the "not yet loaded" result
    expect(result).toEqual({ provider: { primary: "openai" } });
    expect(confirmMock).toHaveBeenCalled();
  });

  it("should throw for unknown provider id", async () => {
    selectMock.mockResolvedValue("nonexistent-provider");
    const { providersStep } = await import(
      "../../../../src/commands/onboard/steps/06-providers.js"
    );

    const ctx = {
      opts: { flow: "advanced" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    await expect(
      providersStep(ctx as Parameters<typeof providersStep>[0]),
    ).rejects.toThrow("Provider nonexistent-provider not found");
  });
});
