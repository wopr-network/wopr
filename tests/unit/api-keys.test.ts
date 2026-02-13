/**
 * API Key Management Tests (WOP-209)
 *
 * Tests the api-keys module directly (unit) and the HTTP routes (integration).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Mock WOPR_HOME to a temp directory so we don't touch real data
const TEST_DB_DIR = `/tmp/wopr-test-api-keys-${randomBytes(4).toString("hex")}`;

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: TEST_DB_DIR,
}));

import { mkdirSync, rmSync } from "node:fs";

describe("API Key Management (WOP-209)", () => {
  beforeEach(() => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Close DB and clean up
    const { closeApiKeysDb } = await import("../../src/daemon/api-keys.js");
    closeApiKeysDb();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    vi.resetModules();
  });

  // ========================================================================
  // Core API Key Operations
  // ========================================================================
  describe("generateApiKey", () => {
    it("should generate a key with wopr_ prefix", async () => {
      const { generateApiKey } = await import("../../src/daemon/api-keys.js");
      const { rawKey, keyInfo } = generateApiKey("user-1", "My Key");

      expect(rawKey).toMatch(/^wopr_[a-f0-9]{48}$/);
      expect(keyInfo.name).toBe("My Key");
      expect(keyInfo.scope).toBe("full");
      expect(keyInfo.keyPrefix).toBe(rawKey.slice(0, 12));
      expect(keyInfo.id).toBeDefined();
      expect(keyInfo.createdAt).toBeGreaterThan(0);
      expect(keyInfo.expiresAt).toBeNull();
      expect(keyInfo.lastUsedAt).toBeNull();
    });

    it("should generate unique keys each time", async () => {
      const { generateApiKey } = await import("../../src/daemon/api-keys.js");
      const k1 = generateApiKey("user-1", "Key 1");
      const k2 = generateApiKey("user-1", "Key 2");

      expect(k1.rawKey).not.toBe(k2.rawKey);
      expect(k1.keyInfo.id).not.toBe(k2.keyInfo.id);
    });

    it("should support custom scope", async () => {
      const { generateApiKey } = await import("../../src/daemon/api-keys.js");
      const { keyInfo } = generateApiKey("user-1", "Read Only", "read-only");
      expect(keyInfo.scope).toBe("read-only");
    });

    it("should support instance scope", async () => {
      const { generateApiKey } = await import("../../src/daemon/api-keys.js");
      const { keyInfo } = generateApiKey("user-1", "Instance Key", "instance:abc123");
      expect(keyInfo.scope).toBe("instance:abc123");
    });

    it("should support expiresAt", async () => {
      const { generateApiKey } = await import("../../src/daemon/api-keys.js");
      const future = Date.now() + 86400000;
      const { keyInfo } = generateApiKey("user-1", "Expiring", "full", future);
      expect(keyInfo.expiresAt).toBe(future);
    });
  });

  describe("validateApiKey", () => {
    it("should validate a correct key", async () => {
      const { generateApiKey, validateApiKey } = await import("../../src/daemon/api-keys.js");
      const { rawKey } = generateApiKey("user-1", "Test Key");

      const result = validateApiKey(rawKey);
      expect(result).not.toBeNull();
      expect(result!.id).toBe("user-1");
      expect(result!.scope).toBe("full");
    });

    it("should reject an invalid key", async () => {
      const { generateApiKey, validateApiKey } = await import("../../src/daemon/api-keys.js");
      generateApiKey("user-1", "Test Key");

      const result = validateApiKey("wopr_" + "0".repeat(48));
      expect(result).toBeNull();
    });

    it("should reject a key without wopr_ prefix", async () => {
      const { validateApiKey } = await import("../../src/daemon/api-keys.js");
      const result = validateApiKey("invalid_key_here");
      expect(result).toBeNull();
    });

    it("should reject an expired key", async () => {
      const { generateApiKey, validateApiKey } = await import("../../src/daemon/api-keys.js");
      const pastTime = Date.now() - 1000;
      // Manually create with past expiry by generating then updating
      const { rawKey, keyInfo } = generateApiKey("user-1", "Expired", "full", pastTime + 5000);

      // Manually update expires_at to the past via direct DB access
      const { createRequire } = await import("node:module");
      const _require = createRequire(import.meta.url);
      const { DatabaseSync } = _require("node:sqlite");
      const { join } = await import("node:path");
      const db = new DatabaseSync(join(TEST_DB_DIR, "auth.sqlite"));
      db.prepare("UPDATE api_keys SET expires_at = ? WHERE id = ?").run(pastTime, keyInfo.id);
      db.close();

      const result = validateApiKey(rawKey);
      expect(result).toBeNull();
    });

    it("should update last_used_at on successful validation", async () => {
      const { generateApiKey, validateApiKey, listApiKeys } = await import("../../src/daemon/api-keys.js");
      const { rawKey } = generateApiKey("user-1", "Test Key");

      // Initially null
      let keys = listApiKeys("user-1");
      expect(keys[0].lastUsedAt).toBeNull();

      // After validation, should be updated
      validateApiKey(rawKey);
      keys = listApiKeys("user-1");
      expect(keys[0].lastUsedAt).toBeGreaterThan(0);
    });
  });

  describe("listApiKeys", () => {
    it("should list keys for a user", async () => {
      const { generateApiKey, listApiKeys } = await import("../../src/daemon/api-keys.js");
      generateApiKey("user-1", "Key A");
      generateApiKey("user-1", "Key B");
      generateApiKey("user-2", "Other User Key");

      const keys = listApiKeys("user-1");
      expect(keys).toHaveLength(2);
      expect(keys.map((k) => k.name)).toContain("Key A");
      expect(keys.map((k) => k.name)).toContain("Key B");
    });

    it("should return empty array for user with no keys", async () => {
      const { listApiKeys } = await import("../../src/daemon/api-keys.js");
      const keys = listApiKeys("nonexistent-user");
      expect(keys).toHaveLength(0);
    });

    it("should not expose key hashes", async () => {
      const { generateApiKey, listApiKeys } = await import("../../src/daemon/api-keys.js");
      generateApiKey("user-1", "Key A");

      const keys = listApiKeys("user-1");
      const keyObj = keys[0] as Record<string, unknown>;
      expect(keyObj).not.toHaveProperty("key_hash");
      expect(keyObj).not.toHaveProperty("keyHash");
    });
  });

  describe("revokeApiKey", () => {
    it("should revoke a key", async () => {
      const { generateApiKey, revokeApiKey, listApiKeys } = await import("../../src/daemon/api-keys.js");
      const { keyInfo } = generateApiKey("user-1", "To Revoke");

      const deleted = revokeApiKey(keyInfo.id, "user-1");
      expect(deleted).toBe(true);

      const keys = listApiKeys("user-1");
      expect(keys).toHaveLength(0);
    });

    it("should not revoke another user's key", async () => {
      const { generateApiKey, revokeApiKey, listApiKeys } = await import("../../src/daemon/api-keys.js");
      const { keyInfo } = generateApiKey("user-1", "User 1 Key");

      const deleted = revokeApiKey(keyInfo.id, "user-2");
      expect(deleted).toBe(false);

      // Key should still exist
      const keys = listApiKeys("user-1");
      expect(keys).toHaveLength(1);
    });

    it("should return false for nonexistent key", async () => {
      const { revokeApiKey } = await import("../../src/daemon/api-keys.js");
      const deleted = revokeApiKey("nonexistent-id", "user-1");
      expect(deleted).toBe(false);
    });

    it("should invalidate the key after revocation", async () => {
      const { generateApiKey, revokeApiKey, validateApiKey } = await import("../../src/daemon/api-keys.js");
      const { rawKey, keyInfo } = generateApiKey("user-1", "To Revoke");

      // Key works before revocation
      expect(validateApiKey(rawKey)).not.toBeNull();

      revokeApiKey(keyInfo.id, "user-1");

      // Key no longer works
      expect(validateApiKey(rawKey)).toBeNull();
    });
  });

  // ========================================================================
  // HTTP Route Tests
  // ========================================================================
  describe("API key routes", () => {
    it("POST /api/keys should create a key for authenticated user", async () => {
      const { Hono } = await import("hono");
      const { apiKeysRouter } = await import("../../src/daemon/routes/api-keys.js");

      const app = new Hono();
      // Simulate authenticated user (skip requireAuth)
      app.use("*", async (c, next) => {
        c.set("user" as never, { id: "test-user-1" });
        c.set("role" as never, "admin");
        return next();
      });
      app.route("/api/keys", apiKeysRouter);

      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "CI Key", scope: "read-only" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.key).toMatch(/^wopr_/);
      expect(body.name).toBe("CI Key");
      expect(body.scope).toBe("read-only");
      expect(body.id).toBeDefined();
    });

    it("POST /api/keys should reject missing name", async () => {
      const { Hono } = await import("hono");
      const { apiKeysRouter } = await import("../../src/daemon/routes/api-keys.js");

      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("user" as never, { id: "test-user-1" });
        c.set("role" as never, "admin");
        return next();
      });
      app.route("/api/keys", apiKeysRouter);

      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("name is required");
    });

    it("POST /api/keys should reject invalid scope", async () => {
      const { Hono } = await import("hono");
      const { apiKeysRouter } = await import("../../src/daemon/routes/api-keys.js");

      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("user" as never, { id: "test-user-1" });
        c.set("role" as never, "admin");
        return next();
      });
      app.route("/api/keys", apiKeysRouter);

      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bad Scope", scope: "superadmin" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid scope");
    });

    it("GET /api/keys should list user keys", async () => {
      const { Hono } = await import("hono");
      const { apiKeysRouter } = await import("../../src/daemon/routes/api-keys.js");
      const { generateApiKey } = await import("../../src/daemon/api-keys.js");

      // Pre-create some keys
      generateApiKey("test-user-1", "Key A");
      generateApiKey("test-user-1", "Key B");

      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("user" as never, { id: "test-user-1" });
        c.set("role" as never, "admin");
        return next();
      });
      app.route("/api/keys", apiKeysRouter);

      const res = await app.request("/api/keys");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.keys).toHaveLength(2);
    });

    it("DELETE /api/keys/:id should revoke a key", async () => {
      const { Hono } = await import("hono");
      const { apiKeysRouter } = await import("../../src/daemon/routes/api-keys.js");
      const { generateApiKey } = await import("../../src/daemon/api-keys.js");

      const { keyInfo } = generateApiKey("test-user-1", "To Delete");

      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("user" as never, { id: "test-user-1" });
        c.set("role" as never, "admin");
        return next();
      });
      app.route("/api/keys", apiKeysRouter);

      const res = await app.request(`/api/keys/${keyInfo.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(true);
    });

    it("DELETE /api/keys/:id should 404 for nonexistent key", async () => {
      const { Hono } = await import("hono");
      const { apiKeysRouter } = await import("../../src/daemon/routes/api-keys.js");

      const app = new Hono();
      app.use("*", async (c, next) => {
        c.set("user" as never, { id: "test-user-1" });
        c.set("role" as never, "admin");
        return next();
      });
      app.route("/api/keys", apiKeysRouter);

      const res = await app.request("/api/keys/nonexistent-id", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("should reject requests without user context", async () => {
      const { Hono } = await import("hono");
      const { apiKeysRouter } = await import("../../src/daemon/routes/api-keys.js");

      const app = new Hono();
      // No user set — simulate daemon token auth (no user object)
      app.use("*", async (c, next) => {
        c.set("role" as never, "admin");
        return next();
      });
      app.route("/api/keys", apiKeysRouter);

      const res = await app.request("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Should Fail" }),
      });

      expect(res.status).toBe(403);
    });
  });

  // ========================================================================
  // Key Rotation (create new, verify, revoke old)
  // ========================================================================
  describe("key rotation", () => {
    it("should support seamless key rotation", async () => {
      const { generateApiKey, validateApiKey, revokeApiKey } = await import("../../src/daemon/api-keys.js");

      // Create old key
      const old = generateApiKey("user-1", "Old Key");
      expect(validateApiKey(old.rawKey)).not.toBeNull();

      // Create new key (both valid simultaneously)
      const fresh = generateApiKey("user-1", "New Key");
      expect(validateApiKey(fresh.rawKey)).not.toBeNull();
      expect(validateApiKey(old.rawKey)).not.toBeNull();

      // Revoke old key
      revokeApiKey(old.keyInfo.id, "user-1");
      expect(validateApiKey(old.rawKey)).toBeNull();
      expect(validateApiKey(fresh.rawKey)).not.toBeNull();
    });
  });
});
