import { beforeEach, describe, expect, it, vi } from "vitest";

const MOCK_TOKEN = "abcdef1234567890abcdef1234567890abcdef12";

const noteMock = vi.fn();

vi.mock("../../../../src/commands/onboard/prompts.js", () => ({
  note: noteMock,
  text: vi.fn().mockResolvedValue("3000"),
  select: vi.fn().mockResolvedValue("loopback"),
  confirm: vi.fn().mockResolvedValue(false),
  isCancel: vi.fn().mockReturnValue(false),
  guardCancel: vi.fn((v: unknown) => v),
  spinner: vi.fn().mockResolvedValue({ start: vi.fn(), stop: vi.fn() }),
  pc: {
    dim: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
  p: {
    isCancel: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("../../../../src/commands/onboard/helpers.js", () => ({
  DEFAULT_PORT: 3000,
  isSystemdAvailable: vi.fn().mockResolvedValue(false),
  isLaunchdAvailable: vi.fn().mockResolvedValue(false),
  randomToken: vi.fn().mockReturnValue(MOCK_TOKEN),
  waitForGateway: vi.fn().mockResolvedValue({ ok: true }),
}));

describe("09-daemon step — token redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noteMock.mockResolvedValue(undefined);
  });

  it("should NOT display any portion of the auth token in note output", async () => {
    const { daemonStep } = await import(
      "../../../../src/commands/onboard/steps/09-daemon.js"
    );

    const ctx = {
      opts: { skipDaemon: false, flow: "quickstart" },
      nextConfig: {},
      runtime: { woprHome: "/tmp/wopr-test" },
    };

    await daemonStep(ctx as Parameters<typeof daemonStep>[0]);

    // Find the "Gateway Configuration" note call
    const configNoteCall = noteMock.mock.calls.find(
      (call) => call[1] === "Gateway Configuration",
    );
    expect(configNoteCall).toBeDefined();

    const noteContent = configNoteCall![0] as string;

    // Must NOT contain any prefix of the token (even 8 chars)
    expect(noteContent).not.toContain(MOCK_TOKEN.substring(0, 8));
    expect(noteContent).not.toContain(MOCK_TOKEN.substring(0, 20));
    expect(noteContent).not.toContain(MOCK_TOKEN);

    // SHOULD contain the token length instead
    expect(noteContent).toContain(String(MOCK_TOKEN.length));
  });

  it("should include token length in the Gateway Configuration note", async () => {
    const { daemonStep } = await import(
      "../../../../src/commands/onboard/steps/09-daemon.js"
    );

    const ctx = {
      opts: { skipDaemon: false, flow: "quickstart" },
      nextConfig: {},
      runtime: { woprHome: "/tmp/wopr-test" },
    };

    await daemonStep(ctx as Parameters<typeof daemonStep>[0]);

    const configNoteCall = noteMock.mock.calls.find(
      (call) => call[1] === "Gateway Configuration",
    );
    expect(configNoteCall).toBeDefined();

    const noteContent = configNoteCall![0] as string;
    expect(noteContent).toContain(`[${MOCK_TOKEN.length} characters`);
  });
});
