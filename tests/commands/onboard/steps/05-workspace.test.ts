import { beforeEach, describe, expect, it, vi } from "vitest";

const noteMock = vi.fn();
const textMock = vi.fn();
const spinnerMock = vi.fn();

vi.mock("../../../../src/commands/onboard/prompts.js", () => ({
  note: noteMock,
  text: textMock,
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

vi.mock("../../../../src/commands/onboard/helpers.js", () => ({
  DEFAULT_WORKSPACE: "/home/test/.wopr/workspace",
}));

const ensureWorkspaceMock = vi.fn();
vi.mock("../../../../src/core/workspace.js", () => ({
  ensureWorkspace: ensureWorkspaceMock,
}));

describe("05-workspace step", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    noteMock.mockResolvedValue(undefined);
    const spinnerInstance = { start: vi.fn(), stop: vi.fn() };
    spinnerMock.mockResolvedValue(spinnerInstance);
    ensureWorkspaceMock.mockResolvedValue({
      dir: "/home/test/.wopr/workspace",
      created: true,
    });
  });

  it("should use CLI override workspace when provided", async () => {
    const { workspaceStep } = await import(
      "../../../../src/commands/onboard/steps/05-workspace.js"
    );

    const ctx = {
      opts: { workspace: "/custom/workspace", flow: "advanced" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await workspaceStep(ctx as Parameters<typeof workspaceStep>[0]);
    expect(ensureWorkspaceMock).toHaveBeenCalledWith("/custom/workspace");
    expect(result).toEqual({ workspace: "/home/test/.wopr/workspace" });
  });

  it("should use default workspace in quickstart mode", async () => {
    const { workspaceStep } = await import(
      "../../../../src/commands/onboard/steps/05-workspace.js"
    );

    const ctx = {
      opts: { flow: "quickstart" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await workspaceStep(ctx as Parameters<typeof workspaceStep>[0]);
    expect(ensureWorkspaceMock).toHaveBeenCalledWith("/home/test/.wopr/workspace");
    expect(result).toEqual({ workspace: "/home/test/.wopr/workspace" });
  });

  it("should prompt for workspace path in advanced mode", async () => {
    textMock.mockResolvedValue("/advanced/workspace");
    ensureWorkspaceMock.mockResolvedValue({
      dir: "/advanced/workspace",
      created: false,
    });
    const { workspaceStep } = await import(
      "../../../../src/commands/onboard/steps/05-workspace.js"
    );

    const ctx = {
      opts: { flow: "advanced" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    const result = await workspaceStep(ctx as Parameters<typeof workspaceStep>[0]);
    expect(textMock).toHaveBeenCalled();
    expect(ensureWorkspaceMock).toHaveBeenCalledWith("/advanced/workspace");
    expect(result).toEqual({ workspace: "/advanced/workspace" });
  });

  it("should throw on workspace creation failure", async () => {
    ensureWorkspaceMock.mockRejectedValue(new Error("permission denied"));
    const { workspaceStep } = await import(
      "../../../../src/commands/onboard/steps/05-workspace.js"
    );

    const ctx = {
      opts: { flow: "quickstart" },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      baseConfig: {},
      nextConfig: {},
    };

    await expect(
      workspaceStep(ctx as Parameters<typeof workspaceStep>[0]),
    ).rejects.toThrow("Workspace setup failed: permission denied");
  });
});
