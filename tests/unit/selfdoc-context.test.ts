import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session-context-repository module BEFORE importing selfdoc-context
vi.mock("../../src/core/session-context-repository.js", () => ({
  initSessionContextStorage: vi.fn().mockResolvedValue(undefined),
  resetSessionContextStorageInit: vi.fn(),
  getSessionContext: vi.fn().mockResolvedValue(null),
  setSessionContext: vi.fn().mockResolvedValue(undefined),
  listSessionContextFiles: vi.fn().mockResolvedValue([]),
}));

// Mock logger to suppress output
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getSessionContext,
  initSessionContextStorage,
  listSessionContextFiles,
  setSessionContext,
} from "../../src/core/session-context-repository.js";
import { createDefaultSelfDoc, selfDocContextProvider } from "../../src/core/selfdoc-context.js";

const mockGetSessionContext = vi.mocked(getSessionContext);
const mockSetSessionContext = vi.mocked(setSessionContext);
const mockListFiles = vi.mocked(listSessionContextFiles);
const mockInitStorage = vi.mocked(initSessionContextStorage);

describe("selfDocContextProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionContext.mockResolvedValue(null);
    mockListFiles.mockResolvedValue([]);
    mockInitStorage.mockResolvedValue(undefined);
  });

  it("has name 'selfdoc' and priority 15", () => {
    expect(selfDocContextProvider.name).toBe("selfdoc");
    expect(selfDocContextProvider.priority).toBe(15);
    expect(selfDocContextProvider.enabled).toBe(true);
  });

  it("returns null when no files are stored", async () => {
    const result = await selfDocContextProvider.getContext("test-session");
    expect(result).toBeNull();
    expect(mockInitStorage).toHaveBeenCalled();
  });

  it("returns context with IDENTITY.md content when present", async () => {
    mockGetSessionContext.mockImplementation(async (session: string, filename: string) => {
      if (session === "my-session" && filename === "IDENTITY.md") {
        return "I am WOPR";
      }
      return null;
    });

    const result = await selfDocContextProvider.getContext("my-session");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("## IDENTITY");
    expect(result!.content).toContain("I am WOPR");
    expect(result!.role).toBe("context");
    expect(result!.metadata?.source).toBe("selfdoc");
    expect(result!.metadata?.priority).toBe(15);
  });

  it("loads multiple selfdoc files in order", async () => {
    mockGetSessionContext.mockImplementation(async (session: string, filename: string) => {
      if (filename === "IDENTITY.md") return "identity content";
      if (filename === "AGENTS.md") return "agents content";
      if (filename === "USER.md") return "user content";
      return null;
    });

    const result = await selfDocContextProvider.getContext("my-session");
    expect(result).not.toBeNull();
    const content = result!.content;
    // IDENTITY should appear before AGENTS, AGENTS before USER
    const identityIdx = content.indexOf("identity content");
    const agentsIdx = content.indexOf("agents content");
    const userIdx = content.indexOf("user content");
    expect(identityIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(userIdx);
    expect(result!.metadata?.loadedFiles).toEqual(["IDENTITY.md", "AGENTS.md", "USER.md"]);
  });

  it("falls back to __global__ when session-specific file is missing", async () => {
    // readSelfDocFile checks session first, then __global__
    mockGetSessionContext.mockImplementation(async (session: string, filename: string) => {
      if (session === "__global__" && filename === "AGENTS.md") {
        return "global agents";
      }
      return null;
    });

    const result = await selfDocContextProvider.getContext("my-session");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("global agents");
  });

  it("loads SELF.md from global identity", async () => {
    mockGetSessionContext.mockImplementation(async (session: string, filename: string) => {
      if (session === "__global__" && filename === "memory/SELF.md") {
        return "I remember everything";
      }
      return null;
    });

    const result = await selfDocContextProvider.getContext("my-session");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("SELF (Long-term Memory)");
    expect(result!.content).toContain("I remember everything");
    expect(result!.metadata?.loadedFiles).toContain("memory/SELF.md");
  });

  it("loads recent memory files and limits to last 7 days", async () => {
    const dates = [
      "2026-02-20",
      "2026-02-21",
      "2026-02-22",
      "2026-02-23",
      "2026-02-24",
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
    ];
    const filenames = dates.map((d) => `memory/${d}.md`);

    mockListFiles.mockResolvedValue(filenames);
    mockGetSessionContext.mockImplementation(async (_session: string, filename: string) => {
      if (filename.startsWith("memory/") && filename.match(/\d{4}-\d{2}-\d{2}\.md$/)) {
        return `Notes for ${filename}`;
      }
      return null;
    });

    const result = await selfDocContextProvider.getContext("my-session");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Recent Memory (last 7 days)");
    // Should only have 7, not 9
    expect(result!.content).not.toContain("2026-02-20");
    expect(result!.content).not.toContain("2026-02-21");
    expect(result!.content).toContain("2026-02-22");
    expect(result!.content).toContain("2026-02-28");
  });

  it("handles error in listSessionContextFiles gracefully", async () => {
    mockListFiles.mockRejectedValue(new Error("storage unavailable"));
    mockGetSessionContext.mockImplementation(async (session: string, filename: string) => {
      if (filename === "IDENTITY.md") return "still works";
      return null;
    });

    // Should not throw — readRecentMemoryFiles catches errors
    const result = await selfDocContextProvider.getContext("my-session");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("still works");
  });
});

describe("createDefaultSelfDoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionContext.mockResolvedValue(null);
    mockSetSessionContext.mockResolvedValue(undefined);
    mockInitStorage.mockResolvedValue(undefined);
  });

  it("creates IDENTITY.md, AGENTS.md, and USER.md when missing", async () => {
    await createDefaultSelfDoc("new-session", { agentName: "TestBot", userName: "Alice" });

    // Should have called setSessionContext for each of the 3 files
    expect(mockSetSessionContext).toHaveBeenCalledTimes(3);

    const calls = mockSetSessionContext.mock.calls;
    const filenames = calls.map((c) => c[1]);
    expect(filenames).toContain("IDENTITY.md");
    expect(filenames).toContain("AGENTS.md");
    expect(filenames).toContain("USER.md");

    // Check IDENTITY.md content includes agent name
    const identityCall = calls.find((c) => c[1] === "IDENTITY.md");
    expect(identityCall![2]).toContain("TestBot");

    // Check USER.md content includes user name
    const userCall = calls.find((c) => c[1] === "USER.md");
    expect(userCall![2]).toContain("Alice");
  });

  it("uses defaults when no options provided", async () => {
    await createDefaultSelfDoc("new-session");

    const identityCall = mockSetSessionContext.mock.calls.find((c) => c[1] === "IDENTITY.md");
    expect(identityCall![2]).toContain("WOPR Assistant");

    const userCall = mockSetSessionContext.mock.calls.find((c) => c[1] === "USER.md");
    expect(userCall![2]).toContain("Unknown");
  });

  it("does not overwrite existing files", async () => {
    // Simulate IDENTITY.md already exists
    mockGetSessionContext.mockImplementation(async (_session: string, filename: string) => {
      if (filename === "IDENTITY.md") return "existing identity";
      return null;
    });

    await createDefaultSelfDoc("existing-session");

    // setSessionContext should NOT be called for IDENTITY.md
    const filenames = mockSetSessionContext.mock.calls.map((c) => c[1]);
    expect(filenames).not.toContain("IDENTITY.md");
    // But should be called for AGENTS.md and USER.md
    expect(filenames).toContain("AGENTS.md");
    expect(filenames).toContain("USER.md");
  });
});
