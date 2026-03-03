import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
}));
vi.mock("../../../src/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../src/paths.js", () => ({
  AUTH_FILE: "/fake/auth.json",
  WOPR_HOME: "/fake",
}));
vi.mock("../../../src/auth.js", () => ({
  isEncryptedData: vi.fn((data: string) => data.startsWith("ENCRYPTED:")),
}));

// Shared mutable state for controlling MockDatabaseSync.prepare per-test
const dbState: {
  prepare: ((sql: string) => { all: () => unknown[] }) | null;
} = { prepare: null };

vi.mock("node:sqlite", () => {
  class MockDatabaseSync {
    constructor(_path: string, _opts?: unknown) {}
    prepare(sql: string): { all: () => unknown[] } {
      if (dbState.prepare) return dbState.prepare(sql);
      return { all: () => [] };
    }
    close() {}
  }
  return { DatabaseSync: MockDatabaseSync };
});

import { existsSync, readFileSync, renameSync } from "node:fs";
import { migrateAuthJson, migrateAuthSqlite } from "../../../src/auth/auth-migrate.js";
import type { AuthStore } from "../../../src/auth/auth-store.js";

function mockAuthStore(): AuthStore {
  return {
    setCredential: vi.fn(async () => {}),
    importApiKeyRecord: vi.fn(async () => {}),
    init: vi.fn(async () => {}),
    getCredential: vi.fn(async () => null),
    removeCredential: vi.fn(async () => false),
    listCredentials: vi.fn(async () => []),
    createApiKey: vi.fn(async () => ({ rawKey: "", keyInfo: {} as never })),
    validateApiKey: vi.fn(async () => null),
    revokeApiKey: vi.fn(async () => false),
    listApiKeys: vi.fn(async () => []),
    clearCache: vi.fn(),
    configCache: new Map(),
  } as unknown as AuthStore;
}

describe("migrateAuthJson", () => {
  let store: AuthStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = mockAuthStore();
  });

  it("skips when auth.json does not exist", async () => {
    (existsSync as Mock).mockReturnValue(false);
    await migrateAuthJson(store);
    expect(store.setCredential).not.toHaveBeenCalled();
  });

  it("migrates plaintext JSON auth state", async () => {
    (existsSync as Mock).mockReturnValue(true);
    const authData = { type: "oauth", token: "abc123" };
    (readFileSync as Mock).mockReturnValue(JSON.stringify(authData));

    await migrateAuthJson(store);

    expect(store.setCredential).toHaveBeenCalledWith(
      "wopr-auth-state",
      "wopr",
      JSON.stringify(authData),
    );
    expect(renameSync).toHaveBeenCalledWith("/fake/auth.json", "/fake/auth.json.migrated");
  });

  it("migrates encrypted auth state without decrypting", async () => {
    (existsSync as Mock).mockReturnValue(true);
    const encrypted = "ENCRYPTED:abc123deadbeef";
    (readFileSync as Mock).mockReturnValue(encrypted);

    await migrateAuthJson(store);

    expect(store.setCredential).toHaveBeenCalledWith(
      "wopr-auth-state",
      "wopr",
      encrypted,
      "aes-256-gcm",
    );
    expect(renameSync).toHaveBeenCalled();
  });

  it("throws on corrupt JSON that is not encrypted", async () => {
    (existsSync as Mock).mockReturnValue(true);
    (readFileSync as Mock).mockReturnValue("NOT JSON AND NOT ENCRYPTED");

    await expect(migrateAuthJson(store)).rejects.toThrow();
    expect(store.setCredential).not.toHaveBeenCalled();
    expect(renameSync).not.toHaveBeenCalled();
  });
});

describe("migrateAuthSqlite", () => {
  let store: AuthStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = mockAuthStore();
    dbState.prepare = null;
  });

  afterEach(() => {
    dbState.prepare = null;
  });

  it("skips when auth.sqlite does not exist", async () => {
    (existsSync as Mock).mockReturnValue(false);
    await migrateAuthSqlite(store);
    expect(store.importApiKeyRecord).not.toHaveBeenCalled();
  });

  it("skips when api_keys table does not exist", async () => {
    (existsSync as Mock).mockReturnValue(true);
    // dbState.prepare is null → prepare() returns { all: () => [] } → tables empty
    await migrateAuthSqlite(store);
    expect(store.importApiKeyRecord).not.toHaveBeenCalled();
  });

  it("migrates API key rows from SQLite to AuthStore", async () => {
    (existsSync as Mock).mockReturnValue(true);

    const row = {
      id: "key1",
      user_id: "user1",
      name: "My Key",
      key_hash: "somehash",
      key_prefix: "wopr_abc",
      scope: "full",
      last_used_at: null,
      created_at: 1700000000000,
      expires_at: null,
    };

    dbState.prepare = (sql: string) => ({
      all: () => {
        if (sql.includes("sqlite_master")) return [{ name: "api_keys" }];
        return [row];
      },
    });

    await migrateAuthSqlite(store);

    expect(store.importApiKeyRecord).toHaveBeenCalledWith({
      id: "key1",
      userId: "user1",
      name: "My Key",
      keyHash: "somehash",
      keyPrefix: "wopr_abc",
      scope: "full",
      lastUsedAt: undefined,
      createdAt: 1700000000000,
      expiresAt: undefined,
    });
    expect(renameSync).toHaveBeenCalledWith("/fake/auth.sqlite", "/fake/auth.sqlite.migrated");
  });

  it("maps non-null last_used_at and expires_at correctly", async () => {
    (existsSync as Mock).mockReturnValue(true);

    const row = {
      id: "k2",
      user_id: "u2",
      name: "Key2",
      key_hash: "h2",
      key_prefix: "wopr_def",
      scope: "read-only",
      last_used_at: 1700000005000,
      created_at: 1700000000000,
      expires_at: 1800000000000,
    };

    dbState.prepare = (sql: string) => ({
      all: () => {
        if (sql.includes("sqlite_master")) return [{ name: "api_keys" }];
        return [row];
      },
    });

    await migrateAuthSqlite(store);

    expect(store.importApiKeyRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        lastUsedAt: 1700000005000,
        expiresAt: 1800000000000,
      }),
    );
  });

  it("migrates multiple rows", async () => {
    (existsSync as Mock).mockReturnValue(true);

    const rows = [
      { id: "k1", user_id: "u1", name: "K1", key_hash: "h1", key_prefix: "p1", scope: "full", last_used_at: null, created_at: 1, expires_at: null },
      { id: "k2", user_id: "u2", name: "K2", key_hash: "h2", key_prefix: "p2", scope: "full", last_used_at: null, created_at: 2, expires_at: null },
    ];

    dbState.prepare = (sql: string) => ({
      all: () => {
        if (sql.includes("sqlite_master")) return [{ name: "api_keys" }];
        return rows;
      },
    });

    await migrateAuthSqlite(store);

    expect(store.importApiKeyRecord).toHaveBeenCalledTimes(2);
  });
});
