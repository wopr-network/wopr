import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn(),
  createReadStream: vi.fn(),
}));
vi.mock("node:readline", () => ({
  createInterface: vi.fn(),
}));
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-0001"),
}));
vi.mock("../../../src/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../src/paths.js", () => ({
  SESSIONS_FILE: "/fake/sessions.json",
  SESSIONS_DIR: "/fake/sessions",
}));
vi.mock("../../../src/storage/index.js", () => ({
  getStorage: vi.fn(),
}));
vi.mock("../../../src/core/session-repository.js", () => ({
  initSessionStorage: vi.fn(async () => {}),
}));

import { existsSync, readFileSync, renameSync, readdirSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { getStorage } from "../../../src/storage/index.js";
import { migrateSessionsToSQL } from "../../../src/core/session-migration.js";

function mockRepo() {
  return {
    insert: vi.fn(async (data: unknown) => data),
    insertMany: vi.fn(async (data: unknown[]) => data),
    findById: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    update: vi.fn(async (_id: string, data: unknown) => data),
    delete: vi.fn(async () => true),
    updateMany: vi.fn(async () => 0),
    deleteMany: vi.fn(async () => 0),
    query: vi.fn(),
    count: vi.fn(async () => 0),
  };
}

describe("migrateSessionsToSQL", () => {
  let sessionsRepo: ReturnType<typeof mockRepo>;
  let messagesRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionsRepo = mockRepo();
    messagesRepo = mockRepo();
    (getStorage as Mock).mockReturnValue({
      getRepository: vi.fn((ns: string, table: string) => {
        if (table === "sessions") return sessionsRepo;
        if (table === "session_messages") return messagesRepo;
        return mockRepo();
      }),
      register: vi.fn(async () => {}),
    });
  });

  it("skips migration when sessions.json does not exist", async () => {
    (existsSync as Mock).mockReturnValue(false);
    await migrateSessionsToSQL();
    expect(sessionsRepo.insert).not.toHaveBeenCalled();
  });

  it("handles corrupt sessions.json gracefully (no crash)", async () => {
    (existsSync as Mock).mockImplementation((p: string) => p === "/fake/sessions.json");
    (readFileSync as Mock).mockReturnValue("NOT VALID JSON{{{");
    (readdirSync as Mock).mockReturnValue([]);

    await migrateSessionsToSQL();
    expect(sessionsRepo.insert).not.toHaveBeenCalled();
  });

  it("migrates a session with all file types present", async () => {
    (existsSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return true;
      if (path === "/fake/sessions") return true;
      if (path.endsWith(".created")) return true;
      if (path.endsWith(".provider.json")) return true;
      if (path.endsWith(".conversation.jsonl")) return true;
      if (path.endsWith(".md")) return true;
      return false;
    });

    (readFileSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return JSON.stringify({ "my-session": "sess-id-1" });
      if (path.endsWith(".created")) return "1700000000000";
      if (path.endsWith(".provider.json")) return JSON.stringify({ name: "anthropic", model: "claude-3" });
      if (path.endsWith(".md")) return "# Session context";
      return "";
    });

    (readdirSync as Mock).mockReturnValue([
      "my-session.created",
      "my-session.provider.json",
      "my-session.conversation.jsonl",
      "my-session.md",
    ]);

    const lines = [
      JSON.stringify({ ts: 1700000001000, from: "user1", content: "hello", type: "message" }),
      JSON.stringify({ ts: 1700000002000, from: "WOPR", content: "hi back", type: "response" }),
    ];
    (createInterface as Mock).mockReturnValue(
      (async function* () {
        for (const line of lines) yield line;
      })(),
    );
    (createReadStream as Mock).mockReturnValue({});

    await migrateSessionsToSQL();

    expect(sessionsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sess-id-1",
        name: "my-session",
        providerId: "anthropic",
        status: "active",
        createdAt: 1700000000000,
        context: "# Session context",
      }),
    );

    expect(messagesRepo.insertMany).toHaveBeenCalledTimes(1);
    const msgs = messagesRepo.insertMany.mock.calls[0][0];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hello");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("hi back");
    expect(msgs[0].sequence).toBe(0);
    expect(msgs[1].sequence).toBe(1);

    expect(renameSync).toHaveBeenCalledWith("/fake/sessions.json", "/fake/sessions.json.backup");
  });

  it("handles missing .created file — falls back to Date.now()", async () => {
    (existsSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return true;
      if (path === "/fake/sessions") return false;
      return false;
    });
    (readFileSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return JSON.stringify({ "bare-session": "bare-id" });
      return "";
    });
    (readdirSync as Mock).mockReturnValue([]);

    const before = Date.now();
    await migrateSessionsToSQL();

    const call = sessionsRepo.insert.mock.calls[0][0];
    expect(call.id).toBe("bare-id");
    expect(call.createdAt).toBeGreaterThanOrEqual(before);
    expect(call.providerId).toBeUndefined();
    expect(call.context).toBeUndefined();
  });

  it("handles NaN in .created file — falls back to Date.now()", async () => {
    (existsSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return true;
      if (path === "/fake/sessions") return false;
      if (path.endsWith(".created")) return true;
      return false;
    });
    (readFileSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return JSON.stringify({ s1: "id1" });
      if (path.endsWith(".created")) return "not-a-number";
      return "";
    });
    (readdirSync as Mock).mockReturnValue([]);

    const before = Date.now();
    await migrateSessionsToSQL();
    expect(sessionsRepo.insert.mock.calls[0][0].createdAt).toBeGreaterThanOrEqual(before);
  });

  it("skips malformed JSONL lines without crashing", async () => {
    (existsSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return true;
      if (path === "/fake/sessions") return false;
      if (path.endsWith(".conversation.jsonl")) return true;
      return false;
    });
    (readFileSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return JSON.stringify({ s1: "id1" });
      return "";
    });

    const lines = [
      "NOT JSON",
      "",
      "   ",
      JSON.stringify({ ts: 100, from: "user1", content: "valid", type: "message" }),
    ];
    (createInterface as Mock).mockReturnValue(
      (async function* () {
        for (const line of lines) yield line;
      })(),
    );
    (createReadStream as Mock).mockReturnValue({});
    (readdirSync as Mock).mockReturnValue([]);

    await migrateSessionsToSQL();

    expect(messagesRepo.insertMany).toHaveBeenCalledTimes(1);
    expect(messagesRepo.insertMany.mock.calls[0][0]).toHaveLength(1);
  });

  it("continues migrating other sessions when one fails", async () => {
    (existsSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return true;
      if (path === "/fake/sessions") return false;
      return false;
    });
    (readFileSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return JSON.stringify({ s1: "id1", s2: "id2" });
      return "";
    });
    (readdirSync as Mock).mockReturnValue([]);

    sessionsRepo.insert
      .mockRejectedValueOnce(new Error("DB error"))
      .mockResolvedValueOnce({});

    await migrateSessionsToSQL();
    expect(sessionsRepo.insert).toHaveBeenCalledTimes(2);
  });

  it("maps 'WOPR' sender to assistant role and others to user", async () => {
    (existsSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return true;
      if (path === "/fake/sessions") return false;
      if (path.endsWith(".conversation.jsonl")) return true;
      return false;
    });
    (readFileSync as Mock).mockImplementation((path: string) => {
      if (path === "/fake/sessions.json") return JSON.stringify({ s1: "id1" });
      return "";
    });
    (readdirSync as Mock).mockReturnValue([]);

    const lines = [
      JSON.stringify({ ts: 1, from: "system", content: "sys msg", type: "system" }),
      JSON.stringify({ ts: 2, from: "WOPR", content: "assistant msg", type: "response" }),
      JSON.stringify({ ts: 3, from: "someuser", content: "user msg", type: "message" }),
    ];
    (createInterface as Mock).mockReturnValue(
      (async function* () {
        for (const line of lines) yield line;
      })(),
    );
    (createReadStream as Mock).mockReturnValue({});

    await migrateSessionsToSQL();

    const msgs = messagesRepo.insertMany.mock.calls[0][0];
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[2].role).toBe("user");
  });
});
