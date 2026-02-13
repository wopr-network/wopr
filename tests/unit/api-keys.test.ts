/**
 * API Key Management Tests (WOP-209)
 *
 * Tests key generation, hashing, validation, listing, revocation,
 * scope validation, and the HTTP routes.
 */

import { createRequire } from "node:module";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the logger to suppress output during tests
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock paths to use predictable values
vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: "/tmp/wopr-test-api-keys",
  AUTH_FILE: "/tmp/wopr-test-api-keys/auth.json",
}));

// Mock auth-token to return a fixed token
vi.mock("../../src/daemon/auth-token.js", () => ({
  ensureToken: () => "test-daemon-token",
  getToken: () => "test-daemon-token",
  TOKEN_FILE: "/tmp/wopr-test-api-keys/daemon-token",
}));

// ── In-memory SQLite for testing ──────────────────────────────────────

const _require = createRequire(import.meta.url);

function createInMemoryDb() {
  const { DatabaseSync } = _require("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'full',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    )
  `);
  return db;
}

// ── Import modules after mocks ────────────────────────────────────────

const { createApiKey, listApiKeys, revokeApiKey, validateApiKey, isValidScope, setDb, resetDb, getApiKeyById } =
  await import("../../src/daemon/api-keys.js");
const { apiKeysRouter } = await import("../../src/daemon/routes/api-keys.js");
const { bearerAuth } = await import("../../src/daemon/middleware/auth.js");

describe("API Key Management", () => {
  let testDb: any;

  beforeEach(() => {
    testDb = createInMemoryDb();
    setDb(testDb);
  });

  afterEach(() => {
    resetDb();
  });

  // ────────────────────────────────────────────────────────────────────
  // Key Generation
  // ────────────────────────────────────────────────────────────────────
  describe("createApiKey", () => {
    it("should generate a key with wopr_ prefix", () => {
      const result = createApiKey("test-key");
      expect(result.key).toMatch(/^wopr_[a-f0-9]{48}$/);
    });

    it("should return unique keys on each call", () => {
      const a = createApiKey("key-a");
      const b = createApiKey("key-b");
      expect(a.key).not.toBe(b.key);
      expect(a.id).not.toBe(b.id);
    });

    it("should default to 'full' scope", () => {
      const result = createApiKey("test-key");
      expect(result.scope).toBe("full");
    });

    it("should accept custom scope", () => {
      const result = createApiKey("test-key", "read-only");
      expect(result.scope).toBe("read-only");
    });

    it("should accept instance scope", () => {
      const result = createApiKey("test-key", "instance:abc-123");
      expect(result.scope).toBe("instance:abc-123");
    });

    it("should store the key prefix (first 10 chars)", () => {
      const result = createApiKey("test-key");
      expect(result.prefix).toBe(result.key.slice(0, 10));
      expect(result.prefix).toMatch(/^wopr_[a-f0-9]{5}$/);
    });

    it("should set createdAt to current timestamp", () => {
      const before = Date.now();
      const result = createApiKey("test-key");
      const after = Date.now();
      expect(result.createdAt).toBeGreaterThanOrEqual(before);
      expect(result.createdAt).toBeLessThanOrEqual(after);
    });

    it("should persist the key in the database", () => {
      const result = createApiKey("test-key");
      const keys = listApiKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].id).toBe(result.id);
      expect(keys[0].name).toBe("test-key");
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Key Listing
  // ────────────────────────────────────────────────────────────────────
  describe("listApiKeys", () => {
    it("should return empty array when no keys exist", () => {
      expect(listApiKeys()).toEqual([]);
    });

    it("should list all keys ordered by creation time descending", () => {
      createApiKey("first");
      createApiKey("second");
      createApiKey("third");
      const keys = listApiKeys();
      expect(keys).toHaveLength(3);
      // Most recent first
      expect(keys[0].name).toBe("third");
      expect(keys[2].name).toBe("first");
    });

    it("should not include the raw key in listed records", () => {
      createApiKey("test-key");
      const keys = listApiKeys();
      // The record has hash + salt, not the raw key
      expect(keys[0]).not.toHaveProperty("key");
      expect(keys[0].hash).toBeTruthy();
      expect(keys[0].salt).toBeTruthy();
    });

    it("should include null for lastUsedAt on new keys", () => {
      createApiKey("test-key");
      const keys = listApiKeys();
      expect(keys[0].lastUsedAt).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Key Validation
  // ────────────────────────────────────────────────────────────────────
  describe("validateApiKey", () => {
    it("should validate a correct raw key", () => {
      const created = createApiKey("test-key");
      const result = validateApiKey(created.key);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
      expect(result!.name).toBe("test-key");
    });

    it("should reject an incorrect key", () => {
      createApiKey("test-key");
      const result = validateApiKey("wopr_000000000000000000000000000000000000000000000000");
      expect(result).toBeNull();
    });

    it("should reject a key without wopr_ prefix", () => {
      const result = validateApiKey("not_a_wopr_key");
      expect(result).toBeNull();
    });

    it("should update lastUsedAt on successful validation", () => {
      const created = createApiKey("test-key");
      const before = Date.now();
      validateApiKey(created.key);
      const after = Date.now();

      const record = getApiKeyById(created.id);
      expect(record!.lastUsedAt).toBeGreaterThanOrEqual(before);
      expect(record!.lastUsedAt).toBeLessThanOrEqual(after);
    });

    it("should validate the correct key when multiple exist", () => {
      createApiKey("key-1");
      const key2 = createApiKey("key-2");
      createApiKey("key-3");

      const result = validateApiKey(key2.key);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(key2.id);
    });

    it("should return null for empty string", () => {
      expect(validateApiKey("")).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Key Revocation
  // ────────────────────────────────────────────────────────────────────
  describe("revokeApiKey", () => {
    it("should remove a key from the database", () => {
      const created = createApiKey("test-key");
      expect(listApiKeys()).toHaveLength(1);

      const revoked = revokeApiKey(created.id);
      expect(revoked).toBe(true);
      expect(listApiKeys()).toHaveLength(0);
    });

    it("should return false for non-existent key", () => {
      const revoked = revokeApiKey("nonexistent-id");
      expect(revoked).toBe(false);
    });

    it("should make the key no longer validate", () => {
      const created = createApiKey("test-key");
      revokeApiKey(created.id);
      const result = validateApiKey(created.key);
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Scope Validation
  // ────────────────────────────────────────────────────────────────────
  describe("isValidScope", () => {
    it('should accept "full"', () => {
      expect(isValidScope("full")).toBe(true);
    });

    it('should accept "read-only"', () => {
      expect(isValidScope("read-only")).toBe(true);
    });

    it('should accept "instance:abc-123"', () => {
      expect(isValidScope("instance:abc-123")).toBe(true);
    });

    it("should reject empty string", () => {
      expect(isValidScope("")).toBe(false);
    });

    it("should reject arbitrary string", () => {
      expect(isValidScope("admin")).toBe(false);
    });

    it('should reject "instance:" without ID', () => {
      expect(isValidScope("instance:")).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // getApiKeyById
  // ────────────────────────────────────────────────────────────────────
  describe("getApiKeyById", () => {
    it("should return a key by ID", () => {
      const created = createApiKey("test-key", "read-only");
      const record = getApiKeyById(created.id);
      expect(record).not.toBeNull();
      expect(record!.name).toBe("test-key");
      expect(record!.scope).toBe("read-only");
    });

    it("should return null for non-existent ID", () => {
      expect(getApiKeyById("nonexistent")).toBeNull();
    });
  });
});

// ── Route Tests ───────────────────────────────────────────────────────

describe("API Keys Routes", () => {
  let testDb: any;

  function createTestApp() {
    const app = new Hono();
    app.route("/api/keys", apiKeysRouter);
    return app;
  }

  beforeEach(() => {
    testDb = createInMemoryDb();
    setDb(testDb);
  });

  afterEach(() => {
    resetDb();
  });

  describe("POST /api/keys", () => {
    it("should create a new API key", async () => {
      const app = createTestApp();
      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "my-key" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.key).toMatch(/^wopr_[a-f0-9]{48}$/);
      expect(body.name).toBe("my-key");
      expect(body.scope).toBe("full");
      expect(body.warning).toContain("Store this key securely");
    });

    it("should accept a custom scope", async () => {
      const app = createTestApp();
      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "read-key", scope: "read-only" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.scope).toBe("read-only");
    });

    it("should reject missing name", async () => {
      const app = createTestApp();
      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("name is required");
    });

    it("should reject empty name", async () => {
      const app = createTestApp();
      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "  " }),
      });

      expect(res.status).toBe(400);
    });

    it("should reject invalid scope", async () => {
      const app = createTestApp();
      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "bad-scope", scope: "admin" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid scope");
    });
  });

  describe("GET /api/keys", () => {
    it("should return empty list when no keys exist", async () => {
      const app = createTestApp();
      const res = await app.request("/api/keys");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.keys).toEqual([]);
    });

    it("should list keys with masked prefix", async () => {
      const app = createTestApp();

      // Create a key directly
      createApiKey("my-key", "full");

      const res = await app.request("/api/keys");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.keys).toHaveLength(1);
      expect(body.keys[0].name).toBe("my-key");
      expect(body.keys[0].prefix).toMatch(/^wopr_[a-f0-9]{5}\.\.\.$/);
      // Should not include hash or salt
      expect(body.keys[0]).not.toHaveProperty("hash");
      expect(body.keys[0]).not.toHaveProperty("salt");
    });
  });

  describe("DELETE /api/keys/:id", () => {
    it("should revoke an existing key", async () => {
      const app = createTestApp();
      const created = createApiKey("to-revoke");

      const res = await app.request(`/api/keys/${created.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.revoked).toBe(true);
      expect(body.id).toBe(created.id);
    });

    it("should return 404 for non-existent key", async () => {
      const app = createTestApp();
      const res = await app.request("/api/keys/deadbeef0123456789abcdef01234567", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("should reject invalid ID format", async () => {
      const app = createTestApp();
      const res = await app.request("/api/keys/not-valid-hex!", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
    });
  });
});

// ── Auth Middleware Integration Tests ─────────────────────────────────

describe("Auth Middleware with API Keys", () => {
  let testDb: any;

  beforeEach(() => {
    testDb = createInMemoryDb();
    setDb(testDb);
  });

  afterEach(() => {
    resetDb();
  });

  function createAuthApp() {
    const app = new Hono();
    app.use("*", bearerAuth());
    app.get("/health", (c) => c.json({ status: "ok" }));
    app.get("/ready", (c) => c.json({ ready: true }));
    app.get("/test", (c) => c.json({ authenticated: true }));
    return app;
  }

  it("should accept valid daemon bearer token", async () => {
    const app = createAuthApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer test-daemon-token" },
    });
    expect(res.status).toBe(200);
  });

  it("should accept valid wopr_ API key", async () => {
    const app = createAuthApp();
    const created = createApiKey("auth-test-key");

    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(res.status).toBe(200);
  });

  it("should reject invalid wopr_ API key", async () => {
    const app = createAuthApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wopr_000000000000000000000000000000000000000000000000" },
    });
    expect(res.status).toBe(401);
  });

  it("should reject revoked API key", async () => {
    const app = createAuthApp();
    const created = createApiKey("revoke-test");
    revokeApiKey(created.id);

    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(res.status).toBe(401);
  });

  it("should skip auth for /health", async () => {
    const app = createAuthApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("should skip auth for /ready", async () => {
    const app = createAuthApp();
    const res = await app.request("/ready");
    expect(res.status).toBe(200);
  });

  it("should reject missing Authorization header", async () => {
    const app = createAuthApp();
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("should reject invalid bearer token", async () => {
    const app = createAuthApp();
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });
});
