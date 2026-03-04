import { beforeEach, describe, expect, it, vi } from "vitest";

const noteMock = vi.fn();
const confirmMock = vi.fn();
const multiselectMock = vi.fn();
const spinnerMock = vi.fn();

vi.mock("../../../../src/commands/onboard/prompts.js", () => ({
  note: noteMock,
  confirm: confirmMock,
  multiselect: multiselectMock,
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

describe("07-channels step", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    noteMock.mockResolvedValue(undefined);
    const spinnerInstance = { start: vi.fn(), stop: vi.fn() };
    spinnerMock.mockResolvedValue(spinnerInstance);
    installPluginMock.mockResolvedValue(undefined);
  });

  it("should skip and return empty when skipChannels flag is set", async () => {
    const { channelsStep } = await import(
      "../../../../src/commands/onboard/steps/07-channels.js"
    );

    const ctx = {
      opts: { skipChannels: true },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await channelsStep(ctx as Parameters<typeof channelsStep>[0]);
    expect(result).toEqual({});
    expect(noteMock).toHaveBeenCalledWith(
      "Skipping channel setup (--skip-channels)",
      "Channels",
    );
  });

  it("should return empty channels when user selects none in quickstart", async () => {
    // All confirms return false (no channels selected)
    confirmMock.mockResolvedValue(false);
    const { channelsStep } = await import(
      "../../../../src/commands/onboard/steps/07-channels.js"
    );

    const ctx = {
      opts: { flow: "quickstart" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await channelsStep(ctx as Parameters<typeof channelsStep>[0]);
    expect(result).toEqual({ channels: [] });
  });

  it("should install discord plugin when selected in quickstart", async () => {
    // First confirm is discord (true), rest are false
    confirmMock
      .mockResolvedValueOnce(true) // discord
      .mockResolvedValue(false); // all others
    const { channelsStep } = await import(
      "../../../../src/commands/onboard/steps/07-channels.js"
    );

    const ctx = {
      opts: { flow: "quickstart" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: { channels: [] },
    };

    const result = await channelsStep(ctx as Parameters<typeof channelsStep>[0]);
    expect(installPluginMock).toHaveBeenCalledWith(
      expect.stringContaining("discord"),
    );
    expect(result).toEqual({ channels: expect.arrayContaining(["discord"]) });
  });

  it("should return selected channels in advanced mode via multiselect", async () => {
    multiselectMock.mockResolvedValue(["discord", "slack"]);
    const { channelsStep } = await import(
      "../../../../src/commands/onboard/steps/07-channels.js"
    );

    const ctx = {
      opts: { flow: "advanced" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: { channels: [] },
    };

    const result = await channelsStep(ctx as Parameters<typeof channelsStep>[0]);
    expect(multiselectMock).toHaveBeenCalled();
    expect(result).toEqual({ channels: expect.arrayContaining(["discord", "slack"]) });
  });
});
