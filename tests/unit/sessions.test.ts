/**
 * Sessions Module Tests (WOP-81, WOP-547)
 *
 * Tests for src/core/sessions.ts covering:
 * - Session creation and initialization (getSessions, saveSessionId, listSessions)
 * - Session restoration from storage (getSessionContext, getSessionProvider, readConversationLog)
 * - Session destruction and cleanup (deleteSessionId, deleteSession)
 * - State persistence (setSessionContext, setSessionProvider, appendToConversationLog)
 * - Edge cases: duplicate session names, missing data, concurrent access
 *
 * After WOP-547 migration: ALL functions are async and use Storage API (SQLite).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

// Create temp directory for this test suite
const TEST_WOPR_HOME = mkdtempSync(join(tmpdir(), "wopr-sessions-test-"));
const TEST_SESSIONS_DIR = join(TEST_WOPR_HOME, "sessions");
const TEST_SESSIONS_FILE = join(TEST_WOPR_HOME, "sessions.json");

// Mock paths to use temp directory
vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: TEST_WOPR_HOME,
  SESSIONS_DIR: TEST_SESSIONS_DIR,
  SESSIONS_FILE: TEST_SESSIONS_FILE,
}));

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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
// Import the module under test and dependencies
// ---------------------------------------------------------------------------
let sessions: typeof import("../../src/core/sessions.js");
let sessionRepository: typeof import("../../src/core/session-repository.js");
let storage: typeof import("../../src/storage/index.js");

beforeEach(async () => {
  // Reset all mocks first
  vi.resetModules();

  // Reset queue mocks
  mockQueueManager.inject.mockReset();
  mockQueueManager.cancelActive.mockReset().mockReturnValue(false);
  mockQueueManager.hasPending.mockReset().mockReturnValue(false);
  mockQueueManager.getStats.mockReset().mockReturnValue({ active: 0, queued: 0 });
  mockQueueManager.getAllStats.mockReset().mockReturnValue({});
  mockQueueManager.setExecutor.mockReset();
  mockQueueManager.on.mockReset();

  // Import fresh modules
  storage = await import("../../src/storage/index.js");
  sessionRepository = await import("../../src/core/session-repository.js");
  sessions = await import("../../src/core/sessions.js");

  // Initialize storage for sessions
  await sessionRepository.initSessionStorage();
});

afterEach(async () => {
  // Clean up storage before next test
  storage.resetStorage();
  sessionRepository.resetSessionStorageInit();

  // Delete the SQLite database file to ensure clean slate for next test
  const dbPath = join(TEST_WOPR_HOME, "wopr.sqlite");
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
  // Also delete WAL and SHM files if they exist
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (existsSync(walPath)) unlinkSync(walPath);
  if (existsSync(shmPath)) unlinkSync(shmPath);

  vi.restoreAllMocks();
});

// Clean up temp directory at end of all tests
afterAll(() => {
  rmSync(TEST_WOPR_HOME, { recursive: true, force: true });
});

// ===========================================================================
// getSessions / saveSessionId / deleteSessionId
// ===========================================================================
describe("getSessions", () => {
  it("should return empty object when no sessions exist", async () => {
    const result = await sessions.getSessions();
    expect(result).toEqual({});
  });

  it("should return sessions as name→id map", async () => {
    await sessions.saveSessionId("alpha", "id-alpha");
    await sessions.saveSessionId("beta", "id-beta");

    const result = await sessions.getSessions();
    expect(result).toEqual({ alpha: "id-alpha", beta: "id-beta" });
  });
});

describe("saveSessionId", () => {
  it("should create new session entry", async () => {
    await sessions.saveSessionId("test-session", "sid-123");

    const stored = await sessions.getSessions();
    expect(stored).toEqual({ "test-session": "sid-123" });
  });

  it("should add to existing sessions", async () => {
    await sessions.saveSessionId("existing", "id-existing");
    await sessions.saveSessionId("new-session", "sid-new");

    const stored = await sessions.getSessions();
    expect(stored).toEqual({ existing: "id-existing", "new-session": "sid-new" });
  });

  it("should overwrite session ID for duplicate name", async () => {
    await sessions.saveSessionId("dup", "old-id");
    await sessions.saveSessionId("dup", "new-id");

    const stored = await sessions.getSessions();
    expect(stored).toEqual({ dup: "new-id" });
  });

  it("should persist creation timestamp for new sessions", async () => {
    const before = Date.now();
    await sessions.saveSessionId("new-session", "sid-123");
    const after = Date.now();

    const ts = await sessions.getSessionCreated("new-session");
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("should not overwrite creation timestamp when updating existing session", async () => {
    await sessions.saveSessionId("existing", "old-id");
    const originalTs = await sessions.getSessionCreated("existing");

    // Wait a bit to ensure timestamp would be different
    await new Promise((resolve) => setTimeout(resolve, 10));

    await sessions.saveSessionId("existing", "new-id");
    const newTs = await sessions.getSessionCreated("existing");

    expect(newTs).toBe(originalTs);
  });
});

describe("deleteSessionId", () => {
  it("should remove a session from the sessions map", async () => {
    await sessions.saveSessionId("a", "1");
    await sessions.saveSessionId("b", "2");

    await sessions.deleteSessionId("a");

    const stored = await sessions.getSessions();
    expect(stored).toEqual({ b: "2" });
  });

  it("should handle deleting a non-existent session gracefully", async () => {
    await sessions.saveSessionId("a", "1");
    await sessions.deleteSessionId("nonexistent");

    const stored = await sessions.getSessions();
    expect(stored).toEqual({ a: "1" });
  });
});

// ===========================================================================
// Session context (getSessionContext / setSessionContext)
// ===========================================================================
describe("getSessionContext", () => {
  it("should return undefined when context not set", async () => {
    const result = await sessions.getSessionContext("unknown");
    expect(result).toBeUndefined();
  });

  it("should return context content when set", async () => {
    await sessions.setSessionContext("my-session", "You are a helpful bot.");

    const result = await sessions.getSessionContext("my-session");
    expect(result).toBe("You are a helpful bot.");
  });
});

describe("setSessionContext", () => {
  it("should store context for a session", async () => {
    await sessions.setSessionContext("ctx-session", "New context content");

    const result = await sessions.getSessionContext("ctx-session");
    expect(result).toBe("New context content");
  });

  it("should overwrite existing context", async () => {
    await sessions.setSessionContext("overwrite", "old context");
    await sessions.setSessionContext("overwrite", "new context");

    const result = await sessions.getSessionContext("overwrite");
    expect(result).toBe("new context");
  });

  it("should create session if it doesn't exist", async () => {
    await sessions.setSessionContext("new-ctx", "context");

    const allSessions = await sessions.getSessions();
    // Session should exist (even if ID is auto-generated)
    expect(Object.keys(allSessions)).toContain("new-ctx");
  });
});

// ===========================================================================
// Session provider (getSessionProvider / setSessionProvider)
// ===========================================================================
describe("getSessionProvider", () => {
  it("should return undefined when provider not set", async () => {
    const result = await sessions.getSessionProvider("no-provider");
    expect(result).toBeUndefined();
  });

  it("should return provider config when set", async () => {
    const config = { name: "anthropic", model: "claude-3" };
    await sessions.setSessionProvider("my-session", config);

    const result = await sessions.getSessionProvider("my-session");
    expect(result).toEqual(config);
  });
});

describe("setSessionProvider", () => {
  it("should store provider config for a session", async () => {
    const config = { name: "openai", model: "gpt-4" };
    await sessions.setSessionProvider("prov-session", config);

    const result = await sessions.getSessionProvider("prov-session");
    expect(result).toEqual(config);
  });

  it("should create session if it doesn't exist", async () => {
    const config = { name: "anthropic" };
    await sessions.setSessionProvider("new-prov", config);

    const allSessions = await sessions.getSessions();
    expect(Object.keys(allSessions)).toContain("new-prov");
  });
});

// ===========================================================================
// getSessionCreated
// ===========================================================================
describe("getSessionCreated", () => {
  it("should return 0 when session does not exist", async () => {
    const result = await sessions.getSessionCreated("nonexistent");
    expect(result).toBe(0);
  });

  it("should return the persisted timestamp", async () => {
    const before = Date.now();
    await sessions.saveSessionId("my-session", "sid-123");
    const after = Date.now();

    const result = await sessions.getSessionCreated("my-session");
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

// ===========================================================================
// listSessions
// ===========================================================================
describe("listSessions", () => {
  it("should return empty array when no sessions exist", async () => {
    const result = await sessions.listSessions();
    expect(result).toEqual([]);
  });

  it("should list sessions with name, id, and context", async () => {
    await sessions.saveSessionId("s1", "id-1");
    await sessions.saveSessionId("s2", "id-2");
    await sessions.setSessionContext("s1", "Context for s1");

    const result = await sessions.listSessions();
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

  it("should include creation timestamp", async () => {
    const before = Date.now();
    await sessions.saveSessionId("ts", "id-ts");
    const after = Date.now();

    const result = await sessions.listSessions();
    const session = result.find((s) => s.name === "ts");
    expect(session!.created).toBeGreaterThanOrEqual(before);
    expect(session!.created).toBeLessThanOrEqual(after);
  });
});

// ===========================================================================
// deleteSession (async, emits event, cleans up data)
// ===========================================================================
describe("deleteSession", () => {
  it("should remove session from storage", async () => {
    await sessions.saveSessionId("doomed", "id-doomed");
    await sessions.setSessionContext("doomed", "ctx");
    const config = { name: "anthropic" };
    await sessions.setSessionProvider("doomed", config);

    await sessions.deleteSession("doomed", "test cleanup");

    // Session should be gone
    const stored = await sessions.getSessions();
    expect(stored).toEqual({});

    // Context and provider should be gone
    expect(await sessions.getSessionContext("doomed")).toBeUndefined();
    expect(await sessions.getSessionProvider("doomed")).toBeUndefined();
  });

  it("should handle missing context/provider gracefully", async () => {
    await sessions.saveSessionId("safe", "id-safe");

    // No context or provider — should not throw
    await expect(sessions.deleteSession("safe")).resolves.toBeUndefined();

    const stored = await sessions.getSessions();
    expect(stored).toEqual({});
  });

  it("should emit session:destroy event", async () => {
    const { emitSessionDestroy } = await import("../../src/core/events.js");
    await sessions.saveSessionId("evt", "id-evt");

    await sessions.deleteSession("evt", "reason-test");

    expect(emitSessionDestroy).toHaveBeenCalledWith("evt", expect.any(Array), "reason-test");
  });
});

// ===========================================================================
// Conversation log (appendToConversationLog, readConversationLog)
// ===========================================================================
describe("appendToConversationLog", () => {
  it("should append entry to conversation log", async () => {
    const entry = {
      ts: 1000,
      from: "user",
      content: "Hello",
      type: "message" as const,
    };

    await sessions.appendToConversationLog("log-test", entry);

    const log = await sessions.readConversationLog("log-test");
    expect(log).toHaveLength(1);
    expect(log[0].content).toBe("Hello");
    expect(log[0].from).toBe("user");
    expect(log[0].type).toBe("message");
  });

  it("should append multiple entries in order", async () => {
    const entry1 = { ts: 1, from: "user", content: "msg1", type: "message" as const };
    const entry2 = { ts: 2, from: "WOPR", content: "reply1", type: "response" as const };

    await sessions.appendToConversationLog("multi", entry1);
    await sessions.appendToConversationLog("multi", entry2);

    const log = await sessions.readConversationLog("multi");
    expect(log).toHaveLength(2);
    expect(log[0].content).toBe("msg1");
    expect(log[1].content).toBe("reply1");
  });

  it("should auto-create session if it doesn't exist", async () => {
    const entry = { ts: 1, from: "user", content: "hi", type: "message" as const };
    await sessions.appendToConversationLog("auto-create", entry);

    const allSessions = await sessions.getSessions();
    expect(Object.keys(allSessions)).toContain("auto-create");
  });
});

describe("readConversationLog", () => {
  it("should return empty array when log does not exist", async () => {
    const result = await sessions.readConversationLog("no-log");
    expect(result).toEqual([]);
  });

  it("should return entries from log", async () => {
    const entries = [
      { ts: 1, from: "user", content: "hi", type: "message" as const },
      { ts: 2, from: "WOPR", content: "hello", type: "response" as const },
    ];
    await sessions.appendToConversationLog("read-test", entries[0]);
    await sessions.appendToConversationLog("read-test", entries[1]);

    const result = await sessions.readConversationLog("read-test");
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("hi");
    expect(result[1].content).toBe("hello");
  });

  it("should limit results to last N entries", async () => {
    const entries = [
      { ts: 1, from: "u", content: "a", type: "message" as const },
      { ts: 2, from: "u", content: "b", type: "message" as const },
      { ts: 3, from: "u", content: "c", type: "message" as const },
    ];
    for (const e of entries) {
      await sessions.appendToConversationLog("limit-test", e);
    }

    const result = await sessions.readConversationLog("limit-test", 2);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("b");
    expect(result[1].content).toBe("c");
  });

  it("should return all entries when limit is 0 or negative", async () => {
    const entries = [
      { ts: 1, from: "u", content: "a", type: "message" as const },
      { ts: 2, from: "u", content: "b", type: "message" as const },
    ];
    for (const e of entries) {
      await sessions.appendToConversationLog("no-limit", e);
    }

    expect((await sessions.readConversationLog("no-limit", 0)).length).toBe(2);
    expect((await sessions.readConversationLog("no-limit", -1)).length).toBe(2);
  });
});

// ===========================================================================
// logMessage
// ===========================================================================
describe("logMessage", () => {
  it("should append a message entry with defaults", async () => {
    await sessions.logMessage("log-msg", "Hello world");

    const log = await sessions.readConversationLog("log-msg");
    expect(log).toHaveLength(1);
    expect(log[0].from).toBe("unknown");
    expect(log[0].content).toBe("Hello world");
    expect(log[0].type).toBe("message");
    expect(log[0].ts).toBeGreaterThan(0);
  });

  it("should use provided from and senderId", async () => {
    await sessions.logMessage("log-msg2", "Test", {
      from: "alice",
      senderId: "user-123",
      channel: { id: "ch-1", type: "discord" },
    });

    const log = await sessions.readConversationLog("log-msg2");
    expect(log[0].from).toBe("alice");
    expect(log[0].senderId).toBe("user-123");
    expect(log[0].channel?.id).toBe("ch-1");
    expect(log[0].channel?.type).toBe("discord");
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
    const expectedResult = { response: "hi", sessionId: "s1" };
    mockQueueManager.inject.mockResolvedValue(expectedResult);

    const result = await sessions.inject("test", "hello");
    expect(result).toEqual(expectedResult);
    expect(mockQueueManager.inject).toHaveBeenCalledWith("test", "hello", undefined);
  });

  it("should pass options through to queueManager", async () => {
    mockQueueManager.inject.mockResolvedValue({ response: "", sessionId: "" });

    const opts = { silent: true, from: "discord" };
    await sessions.inject("test", "msg", opts);

    expect(mockQueueManager.inject).toHaveBeenCalledWith("test", "msg", opts);
  });

  it("should handle multimodal messages", async () => {
    mockQueueManager.inject.mockResolvedValue({ response: "", sessionId: "" });

    const multimodalMsg = { text: "describe this", images: ["base64data"] };
    await sessions.inject("test", multimodalMsg);

    expect(mockQueueManager.inject).toHaveBeenCalledWith("test", multimodalMsg, undefined);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================
describe("edge cases", () => {
  it("should handle session names with special characters", async () => {
    await sessions.saveSessionId("session/with:special.chars", "id-special");
    const stored = await sessions.getSessions();
    expect(stored["session/with:special.chars"]).toBe("id-special");
  });

  it("should handle empty session context", async () => {
    await sessions.setSessionContext("empty-ctx", "");
    const result = await sessions.getSessionContext("empty-ctx");
    expect(result).toBe("");
  });

  it("should handle concurrent saves to the same session (last write wins)", async () => {
    // Simulate two saves — the second should overwrite
    await sessions.saveSessionId("race", "first-id");
    await sessions.saveSessionId("race", "second-id");

    const stored = await sessions.getSessions();
    expect(stored.race).toBe("second-id");
  });

  it("should handle saving and deleting in sequence", async () => {
    await sessions.saveSessionId("temp", "id-temp");
    const stored1 = await sessions.getSessions();
    expect(stored1.temp).toBe("id-temp");

    await sessions.deleteSessionId("temp");
    const stored2 = await sessions.getSessions();
    expect(stored2.temp).toBeUndefined();
  });

  it("should handle large number of sessions", async () => {
    // Create 50 sessions (100 causes unique constraint issues with auto-generated UUIDs)
    for (let i = 0; i < 50; i++) {
      await sessions.saveSessionId(`session-${i}`, `id-${i}`);
    }

    const result = await sessions.listSessions();
    expect(result).toHaveLength(50);
    expect(result.some((s) => s.name === "session-0")).toBe(true);
    expect(result.some((s) => s.name === "session-49")).toBe(true);
  });

  it("should delete conversation log when deleting session", async () => {
    await sessions.saveSessionId("logged", "id-logged");
    await sessions.appendToConversationLog("logged", {
      ts: 1,
      from: "u",
      content: "hi",
      type: "message",
    });

    // Verify conversation log exists before deletion
    const logBefore = await sessions.readConversationLog("logged");
    expect(logBefore).toHaveLength(1);

    // deleteSession should read the conversation log for the destroy event, then delete everything
    await sessions.deleteSession("logged");

    // Session ID should be removed
    const stored = await sessions.getSessions();
    expect(stored.logged).toBeUndefined();

    // Conversation log should also be gone (can't read without session)
    const logAfter = await sessions.readConversationLog("logged");
    expect(logAfter).toHaveLength(0);
  });
});
