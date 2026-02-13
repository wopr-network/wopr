/**
 * API Key Management (WOP-209)
 *
 * Generates, stores, and validates long-lived API keys for programmatic access.
 * Keys use the `wopr_` prefix with 48 random hex characters.
 * Keys are hashed with scrypt before storage (never stored in plaintext).
 * Supports scoped access: full, read-only, instance:{id}.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { WOPR_HOME } from "../paths.js";

const _require = createRequire(import.meta.url);

// ── Types ──────────────────────────────────────────────────────────────

export type ApiKeyScope = "full" | "read-only" | `instance:${string}`;

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  salt: string;
  scope: ApiKeyScope;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ApiKeyCreateResult {
  id: string;
  name: string;
  key: string; // Only returned once at creation
  prefix: string;
  scope: ApiKeyScope;
  createdAt: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const KEY_PREFIX = "wopr_";
const KEY_RANDOM_BYTES = 24; // 24 bytes = 48 hex chars
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELIZATION = 1; // p
const SALT_BYTES = 16;

// ── Database ───────────────────────────────────────────────────────────

let db: any = null;

function getDb(): any {
  if (db) return db;
  const { DatabaseSync } = _require("node:sqlite");
  const dbPath = join(WOPR_HOME, "api-keys.sqlite");
  db = new DatabaseSync(dbPath);
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

/** Exposed for testing — allows injecting a mock database. */
export function setDb(mockDb: any): void {
  db = mockDb;
}

/** Exposed for testing — resets the database singleton. */
export function resetDb(): void {
  db = null;
}

// ── Key Generation ─────────────────────────────────────────────────────

function generateKeyId(): string {
  return randomBytes(16).toString("hex");
}

function generateRawKey(): string {
  return KEY_PREFIX + randomBytes(KEY_RANDOM_BYTES).toString("hex");
}

function hashKey(raw: string, salt: Buffer): string {
  const derived = scryptSync(raw, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return derived.toString("hex");
}

// ── Scope Validation ───────────────────────────────────────────────────

const VALID_SCOPES = new Set(["full", "read-only"]);

export function isValidScope(scope: string): scope is ApiKeyScope {
  if (VALID_SCOPES.has(scope)) return true;
  if (scope.startsWith("instance:") && scope.length > "instance:".length) return true;
  return false;
}

// ── CRUD Operations ────────────────────────────────────────────────────

export function createApiKey(name: string, scope: ApiKeyScope = "full"): ApiKeyCreateResult {
  const database = getDb();
  const id = generateKeyId();
  const rawKey = generateRawKey();
  const prefix = rawKey.slice(0, 10); // "wopr_" + 5 hex chars
  const salt = randomBytes(SALT_BYTES);
  const hash = hashKey(rawKey, salt);
  const createdAt = Date.now();

  const stmt = database.prepare(
    "INSERT INTO api_keys (id, name, prefix, hash, salt, scope, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  stmt.run(id, name, prefix, hash, salt.toString("hex"), scope, createdAt, null);

  return { id, name, key: rawKey, prefix, scope, createdAt };
}

export function listApiKeys(): ApiKeyRecord[] {
  const database = getDb();
  const stmt = database.prepare(
    "SELECT id, name, prefix, hash, salt, scope, created_at, last_used_at FROM api_keys ORDER BY created_at DESC",
  );
  const rows = stmt.all();
  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    hash: row.hash,
    salt: row.salt,
    scope: row.scope as ApiKeyScope,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

export function revokeApiKey(id: string): boolean {
  const database = getDb();
  const stmt = database.prepare("DELETE FROM api_keys WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

export function getApiKeyById(id: string): ApiKeyRecord | null {
  const database = getDb();
  const stmt = database.prepare(
    "SELECT id, name, prefix, hash, salt, scope, created_at, last_used_at FROM api_keys WHERE id = ?",
  );
  const row = stmt.get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    hash: row.hash,
    salt: row.salt,
    scope: row.scope as ApiKeyScope,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

// ── Validation ─────────────────────────────────────────────────────────

/**
 * Validates a raw API key against all stored keys.
 * Returns the matching key record if valid, null otherwise.
 * Updates last_used_at on successful validation.
 */
export function validateApiKey(rawKey: string): ApiKeyRecord | null {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;

  const keys = listApiKeys();
  const prefix = rawKey.slice(0, 10);

  // Pre-filter by prefix to avoid hashing against every key
  const candidates = keys.filter((k) => k.prefix === prefix);

  for (const candidate of candidates) {
    const salt = Buffer.from(candidate.salt, "hex");
    const candidateHash = hashKey(rawKey, salt);

    const hashBuf = Buffer.from(candidateHash, "hex");
    const storedBuf = Buffer.from(candidate.hash, "hex");

    if (hashBuf.length === storedBuf.length && timingSafeEqual(hashBuf, storedBuf)) {
      // Update last-used timestamp
      const database = getDb();
      const stmt = database.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?");
      stmt.run(Date.now(), candidate.id);
      candidate.lastUsedAt = Date.now();
      return candidate;
    }
  }

  return null;
}
