/**
 * Sessions Module Tests (WOP-81)
 *
 * Tests for src/core/sessions.ts covering:
 * - Session creation and initialization (getSessions, saveSessionId, listSessions)
 * - Session restoration from disk (getSessionContext, getSessionProvider, readConversationLog)
 * - Session destruction and cleanup (deleteSessionId, deleteSession)
 * - State persistence (setSessionContext, setSessionProvider, appendToConversationLog)
 * - Edge cases: duplicate session names, missing files, concurrent access
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock paths — use a temp directory that we control via the mock fs
const MOCK_WOPR_HOME = "/mock/wopr";
const MOCK_SESSIONS_DIR = join(MOCK_WOPR_HOME, "sessions");
const MOCK_SESSIONS_FILE = join(MOCK_WOPR_HOME, "sessions.json");

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: MOCK_WOPR_HOME,
  SESSIONS_DIR: MOCK_SESSIONS_DIR,
  SESSIONS_FILE: MOCK_SESSIONS_FILE,
}));

// Mock security module — keep it permissive
vi.mock("../../src/security/index.js", () => ({
  checkSessionAccess: vi.fn(() => ({ allowed: true })),
  clearContext: vi.fn(),
  createInjectionSource: vi.fn(() => ({ type: "cli", origin: "test" })),
  createSecurityContext: vi.fn(() => ({
    requestId: "test-req",
    recordEvent: vi.fn(),
  })),
  isEnforcementEnabled: vi.fn(() => false),
  storeContext: vi.fn(),
}));

// Mock events module
vi.mock("../../src/core/events.js", () => ({
  emitMutableIncoming: vi.fn(async () => ({ prevented: false, message: "" })),
  emitMutableOutgoing: vi.fn(async () => ({ prevented: false, response: "" })),
  emitSessionCreate: vi.fn(async () => {}),
  emitSessionDestroy: vi.fn(async () => {}),
  emitSessionResponseChunk: vi.fn(async () => {}),
}));

// Mock context module
vi.mock("../../src/core/context.js", () => ({
  assembleContext: vi.fn(async () => ({
    context: "",
    system: "",
    sources: [],
    warnings: [],
  })),
  initContextSystem: vi.fn(),
  updateLastTriggerTimestamp: vi.fn(),
}));

// Mock providers module
vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    listProviders: vi.fn(() => []),
    resolveProvider: vi.fn(),
  },
}));

// Mock A2A MCP module
vi.mock("../../src/core/a2a-mcp.js", () => ({
  getA2AMcpServer: vi.fn(() => null),
  isA2AEnabled: vi.fn(() => false),
  setSessionFunctions: vi.fn(),
  listA2ATools: vi.fn(() => []),
  registerA2ATool: vi.fn(),
  unregisterA2ATool: vi.fn(),
}));

// Mock queue module
const mockQueueManager = {
  inject: vi.fn(),
  cancelActive: vi.fn(() => false),
  hasPending: vi.fn(() => false),
  getStats: vi.fn(() => ({ active: 0, queued: 0 })),
  getAllStats: vi.fn(() => ({})),
  setExecutor: vi.fn(),
  on: vi.fn(),
};

vi.mock("../../src/core/queue/index.js", () => ({
  queueManager: mockQueueManager,
}));

// ---------------------------------------------------------------------------
// In-memory filesystem mock for node:fs
// ---------------------------------------------------------------------------
const mockFiles = new Map<string, string>();

vi.mock("node:fs", () => ({
  existsSync: (p: string) => mockFiles.has(p),
  readFileSync: (p: string, _enc?: string) => {
    if (!mockFiles.has(p)) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
    return mockFiles.get(p)!;
  },
  writeFileSync: (p: string, content: string) => {
    mockFiles.set(p, content);
  },
  appendFileSync: (p: string, content: string, _enc?: string) => {
    const existing = mockFiles.get(p) || "";
    mockFiles.set(p, existing + content);
  },
  unlinkSync: (p: string) => {
    mockFiles.delete(p);
  },
  mkdirSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the module under test (after all mocks are registered)
// ---------------------------------------------------------------------------
let sessions: typeof import("../../src/core/sessions.js");

beforeEach(async () => {
  vi.resetModules();
  mockFiles.clear();
  mockQueueManager.inject.mockReset();
  mockQueueManager.cancelActive.mockReset().mockReturnValue(false);
  mockQueueManager.hasPending.mockReset().mockReturnValue(false);
  mockQueueManager.getStats.mockReset().mockReturnValue({ active: 0, queued: 0 });
  mockQueueManager.getAllStats.mockReset().mockReturnValue({});
  mockQueueManager.setExecutor.mockReset();
  mockQueueManager.on.mockReset();

  sessions = await import("../../src/core/sessions.js");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// getSessions / saveSessionId / deleteSessionId
// ===========================================================================
describe("getSessions", () => {
  it("should return empty object when sessions file does not exist", () => {
    const result = sessions.getSessions();
    expect(result).toEqual({});
  });

  it("should parse sessions from the sessions file", () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ alpha: "id-alpha", beta: "id-beta" }));
    const result = sessions.getSessions();
    expect(result).toEqual({ alpha: "id-alpha", beta: "id-beta" });
  });
});

describe("saveSessionId", () => {
  it("should create sessions file with new entry when file does not exist", () => {
    sessions.saveSessionId("test-session", "sid-123");

    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored).toEqual({ "test-session": "sid-123" });
  });

  it("should add to existing sessions", () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ existing: "id-existing" }));
    sessions.saveSessionId("new-session", "sid-new");

    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored).toEqual({ existing: "id-existing", "new-session": "sid-new" });
  });

  it("should overwrite session ID for duplicate name", () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ dup: "old-id" }));
    sessions.saveSessionId("dup", "new-id");

    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored).toEqual({ dup: "new-id" });
  });

  it("should persist creation timestamp for new sessions", () => {
    const before = Date.now();
    sessions.saveSessionId("new-session", "sid-123");
    const after = Date.now();

    const createdFile = join(MOCK_SESSIONS_DIR, "new-session.created");
    expect(mockFiles.has(createdFile)).toBe(true);

    const ts = Number(mockFiles.get(createdFile));
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("should not overwrite creation timestamp when updating existing session", () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ existing: "old-id" }));
    const createdFile = join(MOCK_SESSIONS_DIR, "existing.created");
    mockFiles.set(createdFile, "1700000000000");

    sessions.saveSessionId("existing", "new-id");

    // Creation timestamp should be unchanged
    expect(mockFiles.get(createdFile)).toBe("1700000000000");
  });
});

describe("deleteSessionId", () => {
  it("should remove a session from the sessions file", () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ a: "1", b: "2" }));
    sessions.deleteSessionId("a");

    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored).toEqual({ b: "2" });
  });

  it("should handle deleting a non-existent session gracefully", () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ a: "1" }));
    sessions.deleteSessionId("nonexistent");

    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored).toEqual({ a: "1" });
  });
});

// ===========================================================================
// Session context (getSessionContext / setSessionContext)
// ===========================================================================
describe("getSessionContext", () => {
  it("should return undefined when context file does not exist", () => {
    const result = sessions.getSessionContext("unknown");
    expect(result).toBeUndefined();
  });

  it("should return context content when file exists", () => {
    const contextFile = join(MOCK_SESSIONS_DIR, "my-session.md");
    mockFiles.set(contextFile, "You are a helpful bot.");

    const result = sessions.getSessionContext("my-session");
    expect(result).toBe("You are a helpful bot.");
  });
});

describe("setSessionContext", () => {
  it("should write context to the correct file", () => {
    sessions.setSessionContext("ctx-session", "New context content");

    const contextFile = join(MOCK_SESSIONS_DIR, "ctx-session.md");
    expect(mockFiles.get(contextFile)).toBe("New context content");
  });

  it("should overwrite existing context", () => {
    const contextFile = join(MOCK_SESSIONS_DIR, "overwrite.md");
    mockFiles.set(contextFile, "old context");

    sessions.setSessionContext("overwrite", "new context");
    expect(mockFiles.get(contextFile)).toBe("new context");
  });
});

// ===========================================================================
// Session provider (getSessionProvider / setSessionProvider)
// ===========================================================================
describe("getSessionProvider", () => {
  it("should return undefined when provider file does not exist", () => {
    const result = sessions.getSessionProvider("no-provider");
    expect(result).toBeUndefined();
  });

  it("should return parsed provider config when file exists", () => {
    const providerFile = join(MOCK_SESSIONS_DIR, "my-session.provider.json");
    const config = { name: "anthropic", model: "claude-3" };
    mockFiles.set(providerFile, JSON.stringify(config));

    const result = sessions.getSessionProvider("my-session");
    expect(result).toEqual(config);
  });
});

describe("setSessionProvider", () => {
  it("should write provider config to the correct file", () => {
    const config = { name: "openai", model: "gpt-4" };
    sessions.setSessionProvider("prov-session", config);

    const providerFile = join(MOCK_SESSIONS_DIR, "prov-session.provider.json");
    const stored = JSON.parse(mockFiles.get(providerFile)!);
    expect(stored).toEqual(config);
  });
});

// ===========================================================================
// getSessionCreated
// ===========================================================================
describe("getSessionCreated", () => {
  it("should return 0 when no .created file exists", () => {
    const result = sessions.getSessionCreated("nonexistent");
    expect(result).toBe(0);
  });

  it("should return the persisted timestamp", () => {
    const createdFile = join(MOCK_SESSIONS_DIR, "my-session.created");
    mockFiles.set(createdFile, "1700000000000");

    const result = sessions.getSessionCreated("my-session");
    expect(result).toBe(1700000000000);
  });

  it("should return 0 for invalid timestamp content", () => {
    const createdFile = join(MOCK_SESSIONS_DIR, "bad.created");
    mockFiles.set(createdFile, "not-a-number");

    const result = sessions.getSessionCreated("bad");
    expect(result).toBe(0);
  });
});

// ===========================================================================
// listSessions
// ===========================================================================
describe("listSessions", () => {
  it("should return empty array when no sessions exist", () => {
    const result = sessions.listSessions();
    expect(result).toEqual([]);
  });

  it("should list sessions with name, id, and context", () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ s1: "id-1", s2: "id-2" }));
    const ctxFile = join(MOCK_SESSIONS_DIR, "s1.md");
    mockFiles.set(ctxFile, "Context for s1");

    const result = sessions.listSessions();
    expect(result).toHaveLength(2);

    const s1 = result.find((s) => s.name === "s1");
    expect(s1).toBeDefined();
    expect(s1!.id).toBe("id-1");
    expect(s1!.context).toBe("Context for s1");

    const s2 = result.find((s) => s.name === "s2");
    expect(s2).toBeDefined();
    expect(s2!.id).toBe("id-2");
    expect(s2!.context).toBeUndefined();
  });

  it("should use persisted creation timestamp from .created file", () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ ts: "id-ts" }));
    const createdFile = join(MOCK_SESSIONS_DIR, "ts.created");
    mockFiles.set(createdFile, "1700000000000");

    const result = sessions.listSessions();
    expect(result[0].created).toBe(1700000000000);
  });

  it("should return 0 when session has no .created file", () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ ts: "id-ts" }));

    const result = sessions.listSessions();
    expect(result[0].created).toBe(0);
  });
});

// ===========================================================================
// deleteSession (async, emits event, cleans up files)
// ===========================================================================
describe("deleteSession", () => {
  it("should remove session ID, context file, provider file, and created file", async () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ doomed: "id-doomed" }));
    const contextFile = join(MOCK_SESSIONS_DIR, "doomed.md");
    const providerFile = join(MOCK_SESSIONS_DIR, "doomed.provider.json");
    const createdFile = join(MOCK_SESSIONS_DIR, "doomed.created");
    mockFiles.set(contextFile, "ctx");
    mockFiles.set(providerFile, "{}");
    mockFiles.set(createdFile, "1700000000000");

    await sessions.deleteSession("doomed", "test cleanup");

    // Session ID removed
    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored).toEqual({});

    // Files deleted
    expect(mockFiles.has(contextFile)).toBe(false);
    expect(mockFiles.has(providerFile)).toBe(false);
    expect(mockFiles.has(createdFile)).toBe(false);
  });

  it("should handle missing context/provider files gracefully", async () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ safe: "id-safe" }));

    // No context or provider files — should not throw
    await expect(sessions.deleteSession("safe")).resolves.toBeUndefined();

    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored).toEqual({});
  });

  it("should emit session:destroy event", async () => {
    const { emitSessionDestroy } = await import("../../src/core/events.js");
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ evt: "id-evt" }));

    await sessions.deleteSession("evt", "reason-test");

    expect(emitSessionDestroy).toHaveBeenCalledWith("evt", expect.any(Array), "reason-test");
  });
});

// ===========================================================================
// Conversation log (getConversationLogPath, appendToConversationLog, readConversationLog)
// ===========================================================================
describe("getConversationLogPath", () => {
  it("should return correct JSONL path for session", () => {
    const path = sessions.getConversationLogPath("my-session");
    expect(path).toBe(join(MOCK_SESSIONS_DIR, "my-session.conversation.jsonl"));
  });
});

describe("appendToConversationLog", () => {
  it("should append JSONL entry to conversation log", () => {
    const entry = {
      ts: 1000,
      from: "user",
      content: "Hello",
      type: "message" as const,
    };

    sessions.appendToConversationLog("log-test", entry);

    const logPath = join(MOCK_SESSIONS_DIR, "log-test.conversation.jsonl");
    const content = mockFiles.get(logPath)!;
    expect(content).toBe(JSON.stringify(entry) + "\n");
  });

  it("should append multiple entries", () => {
    const entry1 = { ts: 1, from: "user", content: "msg1", type: "message" as const };
    const entry2 = { ts: 2, from: "WOPR", content: "reply1", type: "response" as const };

    sessions.appendToConversationLog("multi", entry1);
    sessions.appendToConversationLog("multi", entry2);

    const logPath = join(MOCK_SESSIONS_DIR, "multi.conversation.jsonl");
    const lines = mockFiles.get(logPath)!.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(entry1);
    expect(JSON.parse(lines[1])).toEqual(entry2);
  });
});

describe("readConversationLog", () => {
  it("should return empty array when log file does not exist", () => {
    const result = sessions.readConversationLog("no-log");
    expect(result).toEqual([]);
  });

  it("should parse JSONL entries from log file", () => {
    const entries = [
      { ts: 1, from: "user", content: "hi", type: "message" },
      { ts: 2, from: "WOPR", content: "hello", type: "response" },
    ];
    const logPath = join(MOCK_SESSIONS_DIR, "read-test.conversation.jsonl");
    mockFiles.set(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const result = sessions.readConversationLog("read-test");
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("hi");
    expect(result[1].content).toBe("hello");
  });

  it("should limit results to last N entries", () => {
    const entries = [
      { ts: 1, from: "u", content: "a", type: "message" },
      { ts: 2, from: "u", content: "b", type: "message" },
      { ts: 3, from: "u", content: "c", type: "message" },
    ];
    const logPath = join(MOCK_SESSIONS_DIR, "limit-test.conversation.jsonl");
    mockFiles.set(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const result = sessions.readConversationLog("limit-test", 2);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("b");
    expect(result[1].content).toBe("c");
  });

  it("should return all entries when limit is 0 or negative", () => {
    const entries = [
      { ts: 1, from: "u", content: "a", type: "message" },
      { ts: 2, from: "u", content: "b", type: "message" },
    ];
    const logPath = join(MOCK_SESSIONS_DIR, "no-limit.conversation.jsonl");
    mockFiles.set(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

    expect(sessions.readConversationLog("no-limit", 0)).toHaveLength(2);
    expect(sessions.readConversationLog("no-limit", -1)).toHaveLength(2);
  });
});

// ===========================================================================
// logMessage
// ===========================================================================
describe("logMessage", () => {
  it("should append a message entry with defaults", () => {
    sessions.logMessage("log-msg", "Hello world");

    const logPath = join(MOCK_SESSIONS_DIR, "log-msg.conversation.jsonl");
    const line = mockFiles.get(logPath)!.trim();
    const parsed = JSON.parse(line);

    expect(parsed.from).toBe("unknown");
    expect(parsed.content).toBe("Hello world");
    expect(parsed.type).toBe("message");
    expect(parsed.ts).toBeGreaterThan(0);
  });

  it("should use provided from and senderId", () => {
    sessions.logMessage("log-msg2", "Test", {
      from: "alice",
      senderId: "user-123",
      channel: { id: "ch-1", type: "discord" },
    });

    const logPath = join(MOCK_SESSIONS_DIR, "log-msg2.conversation.jsonl");
    const parsed = JSON.parse(mockFiles.get(logPath)!.trim());

    expect(parsed.from).toBe("alice");
    expect(parsed.senderId).toBe("user-123");
    expect(parsed.channel).toEqual({ id: "ch-1", type: "discord" });
  });
});

// ===========================================================================
// Queue delegation (cancelInject, hasPendingInject, getQueueStats)
// ===========================================================================
describe("cancelInject", () => {
  it("should delegate to queueManager.cancelActive", () => {
    mockQueueManager.cancelActive.mockReturnValue(true);
    const result = sessions.cancelInject("my-session");
    expect(result).toBe(true);
    expect(mockQueueManager.cancelActive).toHaveBeenCalledWith("my-session");
  });
});

describe("hasPendingInject", () => {
  it("should delegate to queueManager.hasPending", () => {
    mockQueueManager.hasPending.mockReturnValue(true);
    const result = sessions.hasPendingInject("my-session");
    expect(result).toBe(true);
    expect(mockQueueManager.hasPending).toHaveBeenCalledWith("my-session");
  });
});

describe("getQueueStats", () => {
  it("should return stats for a specific session", () => {
    const stats = { active: 1, queued: 2 };
    mockQueueManager.getStats.mockReturnValue(stats);

    const result = sessions.getQueueStats("s1");
    expect(result).toEqual(stats);
    expect(mockQueueManager.getStats).toHaveBeenCalledWith("s1");
  });

  it("should return all stats when no session specified", () => {
    const allStats = { s1: { active: 1, queued: 0 }, s2: { active: 0, queued: 1 } };
    mockQueueManager.getAllStats.mockReturnValue(allStats);

    const result = sessions.getQueueStats();
    expect(result).toEqual(allStats);
    expect(mockQueueManager.getAllStats).toHaveBeenCalled();
  });
});

// ===========================================================================
// inject (delegates to queue)
// ===========================================================================
describe("inject", () => {
  it("should delegate to queueManager.inject", async () => {
    const expectedResult = { response: "hi", sessionId: "s1", cost: 0.01 };
    mockQueueManager.inject.mockResolvedValue(expectedResult);

    const result = await sessions.inject("test", "hello");
    expect(result).toEqual(expectedResult);
    expect(mockQueueManager.inject).toHaveBeenCalledWith("test", "hello", undefined);
  });

  it("should pass options through to queueManager", async () => {
    mockQueueManager.inject.mockResolvedValue({ response: "", sessionId: "", cost: 0 });

    const opts = { silent: true, from: "discord" };
    await sessions.inject("test", "msg", opts);

    expect(mockQueueManager.inject).toHaveBeenCalledWith("test", "msg", opts);
  });

  it("should handle multimodal messages", async () => {
    mockQueueManager.inject.mockResolvedValue({ response: "", sessionId: "", cost: 0 });

    const multimodalMsg = { text: "describe this", images: ["base64data"] };
    await sessions.inject("test", multimodalMsg);

    expect(mockQueueManager.inject).toHaveBeenCalledWith("test", multimodalMsg, undefined);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================
describe("edge cases", () => {
  it("should handle session names with special characters", () => {
    sessions.saveSessionId("session/with:special.chars", "id-special");
    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored["session/with:special.chars"]).toBe("id-special");
  });

  it("should handle empty session context", () => {
    sessions.setSessionContext("empty-ctx", "");
    const contextFile = join(MOCK_SESSIONS_DIR, "empty-ctx.md");
    expect(mockFiles.get(contextFile)).toBe("");

    // existsSync returns true for empty string in our mock
    const result = sessions.getSessionContext("empty-ctx");
    expect(result).toBe("");
  });

  it("should handle concurrent saves to the same session (last write wins)", () => {
    // Simulate two saves — the second should overwrite
    sessions.saveSessionId("race", "first-id");
    sessions.saveSessionId("race", "second-id");

    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored.race).toBe("second-id");
  });

  it("should handle saving and deleting in sequence", () => {
    sessions.saveSessionId("temp", "id-temp");
    expect(JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!)["temp"]).toBe("id-temp");

    sessions.deleteSessionId("temp");
    expect(JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!)["temp"]).toBeUndefined();
  });

  it("should handle conversation log with empty lines", () => {
    const logPath = join(MOCK_SESSIONS_DIR, "sparse.conversation.jsonl");
    const entry = { ts: 1, from: "u", content: "hi", type: "message" };
    // Simulate file with blank lines
    mockFiles.set(logPath, `\n${JSON.stringify(entry)}\n\n`);

    const result = sessions.readConversationLog("sparse");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hi");
  });

  it("should handle large number of sessions", () => {
    const bigSessions: Record<string, string> = {};
    for (let i = 0; i < 1000; i++) {
      bigSessions[`session-${i}`] = `id-${i}`;
    }
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify(bigSessions));

    const result = sessions.listSessions();
    expect(result).toHaveLength(1000);
    expect(result[0].name).toBe("session-0");
  });

  it("should handle deleteSession for session with conversation log", async () => {
    mockFiles.set(MOCK_SESSIONS_FILE, JSON.stringify({ logged: "id-logged" }));
    const logPath = join(MOCK_SESSIONS_DIR, "logged.conversation.jsonl");
    mockFiles.set(logPath, '{"ts":1,"from":"u","content":"hi","type":"message"}\n');

    // deleteSession reads the conversation log for the destroy event
    await sessions.deleteSession("logged");

    // Session ID should be removed
    const stored = JSON.parse(mockFiles.get(MOCK_SESSIONS_FILE)!);
    expect(stored.logged).toBeUndefined();

    // Note: deleteSession does NOT remove the conversation log file (only context + provider)
    expect(mockFiles.has(logPath)).toBe(true);
  });
});
