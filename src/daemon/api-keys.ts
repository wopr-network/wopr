/**
 * API Key Management (WOP-209)
 *
 * Provides CRUD operations for user-scoped API keys:
 * - Generate: creates a `wopr_` prefixed key, stores scrypt hash
 * - List: returns masked keys for the authenticated user
 * - Revoke: deletes a key by ID (user-scoped)
 * - Validate: verifies a raw key against stored hashes, updates last_used_at
 *
 * Keys are stored in the same auth.sqlite database used by Better Auth.
 * The raw key is never persisted — only a scrypt hash is stored.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { logger } from "../logger.js";
import { WOPR_HOME } from "../paths.js";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite");

const AUTH_DB_PATH = join(WOPR_HOME, "auth.sqlite");

const KEY_PREFIX = "wopr_";
const KEY_RANDOM_BYTES = 24; // 24 bytes = 48 hex chars
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_LEN = 32;
const MAX_KEYS_PER_USER = 25;

export type ApiKeyScope = "full" | "read-only" | `instance:${string}`;

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scope: string;
  last_used_at: number | null;
  created_at: number;
  expires_at: number | null;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  scope: string;
  lastUsedAt: number | null;
  createdAt: number;
  expiresAt: number | null;
}

export interface ValidatedKeyUser {
  id: string;
  apiKeyId: string;
  scope: string;
}

export class KeyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyLimitError";
  }
}

let db: InstanceType<typeof DatabaseSync> | undefined;

function getDb(): InstanceType<typeof DatabaseSync> {
  if (!db) {
    db = new DatabaseSync(AUTH_DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'full',
        last_used_at INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys (key_prefix)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id)`);
  }
  return db;
}

/**
 * Hash a raw API key using scrypt with a random salt.
 * Returns "salt:hash" (both hex-encoded).
 */
function hashKey(rawKey: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = scryptSync(rawKey, salt, SCRYPT_KEY_LEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/**
 * Verify a raw key against a stored "salt:hash" string.
 */
function verifyKey(rawKey: string, storedHash: string): boolean {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(rawKey, salt, SCRYPT_KEY_LEN);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Generate a new API key for a user.
 * Returns the raw key (shown once) and the key metadata.
 */
export function generateApiKey(
  userId: string,
  name: string,
  scope: ApiKeyScope = "full",
  expiresAt?: number | null,
): { rawKey: string; keyInfo: ApiKeyInfo } {
  const d = getDb();

  // Enforce per-user key limit (WOP-209 finding #6)
  const countStmt = d.prepare(`SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = ?`);
  const { cnt } = countStmt.get(userId) as { cnt: number };
  if (cnt >= MAX_KEYS_PER_USER) {
    throw new KeyLimitError(`User has reached the maximum of ${MAX_KEYS_PER_USER} API keys`);
  }

  const id = randomBytes(16).toString("hex");
  const rawRandom = randomBytes(KEY_RANDOM_BYTES).toString("hex");
  const rawKey = `${KEY_PREFIX}${rawRandom}`;
  const keyPrefix = rawKey.slice(0, 12); // "wopr_" + first 7 hex chars
  const keyHash = hashKey(rawKey);
  const now = Date.now();

  const stmt = d.prepare(
    `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scope, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(id, userId, name, keyHash, keyPrefix, scope, now, expiresAt ?? null);

  logger.info(`[api-keys] Key created: id=${id} user=${userId} scope=${scope} name="${name}"`);

  return {
    rawKey,
    keyInfo: {
      id,
      name,
      keyPrefix,
      scope,
      lastUsedAt: null,
      createdAt: now,
      expiresAt: expiresAt ?? null,
    },
  };
}

/**
 * List all API keys for a user (masked — no raw key or hash returned).
 */
export function listApiKeys(userId: string): ApiKeyInfo[] {
  const d = getDb();
  const stmt = d.prepare(
    `SELECT id, name, key_prefix, scope, last_used_at, created_at, expires_at
     FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
  );
  const rows = stmt.all(userId) as ApiKeyRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keyPrefix: r.key_prefix,
    scope: r.scope,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

/**
 * Revoke (delete) an API key. Only succeeds if the key belongs to the user.
 * Returns true if a key was deleted, false if not found.
 */
export function revokeApiKey(keyId: string, userId: string): boolean {
  const d = getDb();
  const stmt = d.prepare(`DELETE FROM api_keys WHERE id = ? AND user_id = ?`);
  const result = stmt.run(keyId, userId);
  if (result.changes > 0) {
    logger.info(`[api-keys] Key revoked: id=${keyId} user=${userId}`);
  }
  return result.changes > 0;
}

/**
 * Validate a raw API key (e.g. from Authorization header).
 * Checks all non-expired keys, verifies the hash, updates last_used_at.
 * Returns the user ID and scope if valid, null otherwise.
 */
export function validateApiKey(rawKey: string): ValidatedKeyUser | null {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;

  const d = getDb();
  const prefix = rawKey.slice(0, 12);
  const now = Date.now();

  // Narrow candidates by prefix to avoid scanning all keys
  const stmt = d.prepare(
    `SELECT id, user_id, key_hash, scope, expires_at
     FROM api_keys WHERE key_prefix = ?`,
  );
  const candidates = stmt.all(prefix) as Array<{
    id: string;
    user_id: string;
    key_hash: string;
    scope: string;
    expires_at: number | null;
  }>;

  for (const row of candidates) {
    // Skip expired keys
    if (row.expires_at !== null && row.expires_at < now) continue;

    if (verifyKey(rawKey, row.key_hash)) {
      // Update last_used_at
      const updateStmt = d.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`);
      updateStmt.run(now, row.id);

      return {
        id: row.user_id,
        apiKeyId: row.id,
        scope: row.scope,
      };
    }
  }

  logger.warn(`[api-keys] Validation failed for key prefix=${prefix}`);
  return null;
}

/**
 * Close the database connection. Used for testing cleanup.
 */
export function closeApiKeysDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
