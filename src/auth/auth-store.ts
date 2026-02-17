/**
 * Auth storage implementation
 *
 * Handles persistence of:
 * - Provider credentials (encrypted, replaces auth.json)
 * - Daemon API keys (replaces auth.sqlite)
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { logger } from "../logger.js";
import type { Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import type { AuthApiKeyRecord, AuthCredentialRecord } from "./auth-schema.js";
import { authPluginSchema } from "./auth-schema.js";

const KEY_PREFIX = "wopr_";
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_LEN = 32;
const MAX_KEYS_PER_USER = 25;

export type ApiKeyScope = "full" | "read-only" | `instance:${string}`;

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

/**
 * Auth store - handles credential and API key persistence
 */
export class AuthStore {
  private credRepo: Repository<AuthCredentialRecord> | null = null;
  private apiKeyRepo: Repository<AuthApiKeyRecord> | null = null;

  // In-memory cache for synchronous getCredential() backward compat
  public configCache: Map<string, string> = new Map();

  /**
   * Initialize the store - registers schema and gets repositories
   */
  async init(): Promise<void> {
    const storage = getStorage();
    await storage.register(authPluginSchema);
    this.credRepo = storage.getRepository<AuthCredentialRecord>("auth", "auth_credentials");
    this.apiKeyRepo = storage.getRepository<AuthApiKeyRecord>("auth", "auth_api_keys");
    logger.info("[auth-store] Auth storage initialized");

    // Prime the cache
    await this.loadCredentialsToCache();
  }

  private ensureInitialized(): void {
    if (!this.credRepo || !this.apiKeyRepo) {
      throw new Error("Auth store not initialized - call init() first");
    }
  }

  /**
   * Load all credentials into cache for synchronous access
   */
  private async loadCredentialsToCache(): Promise<void> {
    if (!this.credRepo) return;
    const creds = await this.credRepo.findMany();
    this.configCache.clear();
    for (const cred of creds) {
      this.configCache.set(cred.id, cred.encryptedValue);
    }
  }

  // ============================================================================
  // Credential Methods (replaces auth.json)
  // ============================================================================

  /**
   * Get a credential by ID (provider name)
   */
  async getCredential(id: string): Promise<AuthCredentialRecord | null> {
    this.ensureInitialized();
    return (await this.credRepo?.findById(id)) ?? null;
  }

  /**
   * Set a credential (upsert)
   * @param id - Credential ID (typically provider name)
   * @param provider - Provider name
   * @param encryptedValue - The encrypted credential value
   * @param encryptionMethod - Optional encryption method ("aes-256-gcm")
   */
  async setCredential(id: string, provider: string, encryptedValue: string, encryptionMethod?: string): Promise<void> {
    this.ensureInitialized();
    const now = Date.now();
    const existing = await this.credRepo?.findById(id);

    const record: AuthCredentialRecord = {
      id,
      provider,
      encryptedValue,
      encryptionMethod,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      await this.credRepo?.update(id, record);
    } else {
      await this.credRepo?.insert(record);
    }

    // Update cache
    this.configCache.set(id, encryptedValue);
    logger.info(`[auth-store] Credential updated: id=${id} provider=${provider}`);
  }

  /**
   * Remove a credential
   */
  async removeCredential(id: string): Promise<boolean> {
    this.ensureInitialized();
    const deleted = (await this.credRepo?.delete(id)) ?? false;
    if (deleted) {
      this.configCache.delete(id);
      logger.info(`[auth-store] Credential removed: id=${id}`);
    }
    return deleted;
  }

  /**
   * List all credentials (without values)
   */
  async listCredentials(): Promise<Array<Omit<AuthCredentialRecord, "encryptedValue">>> {
    this.ensureInitialized();
    const creds = (await this.credRepo?.findMany()) ?? [];
    return creds.map(({ encryptedValue, ...rest }) => rest);
  }

  // ============================================================================
  // API Key Methods (replaces auth.sqlite)
  // ============================================================================

  /**
   * Hash a raw API key using scrypt with a random salt
   */
  private hashKey(rawKey: string): string {
    const salt = randomBytes(SCRYPT_SALT_BYTES);
    const derived = scryptSync(rawKey, salt, SCRYPT_KEY_LEN);
    return `${salt.toString("hex")}:${derived.toString("hex")}`;
  }

  /**
   * Verify a raw key against a stored "salt:hash" string
   */
  private verifyKey(rawKey: string, storedHash: string): boolean {
    const [saltHex, hashHex] = storedHash.split(":");
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = scryptSync(rawKey, salt, SCRYPT_KEY_LEN);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }

  /**
   * Generate a new API key
   */
  async createApiKey(
    userId: string,
    name: string,
    scope: ApiKeyScope = "full",
    expiresAt?: number | null,
  ): Promise<{ rawKey: string; keyInfo: ApiKeyInfo }> {
    this.ensureInitialized();

    // Enforce per-user key limit
    const repo = this.apiKeyRepo;
    if (!repo) throw new Error("Auth store not initialized");
    const userKeys = await repo.findMany({ userId });
    if (userKeys.length >= MAX_KEYS_PER_USER) {
      throw new KeyLimitError(`User has reached the maximum of ${MAX_KEYS_PER_USER} API keys`);
    }

    const id = randomBytes(16).toString("hex");
    const rawRandom = randomBytes(24).toString("hex");
    const rawKey = `${KEY_PREFIX}${rawRandom}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = this.hashKey(rawKey);
    const now = Date.now();

    const record: AuthApiKeyRecord = {
      id,
      userId,
      name,
      keyHash,
      keyPrefix,
      scope,
      lastUsedAt: undefined,
      createdAt: now,
      expiresAt: expiresAt ?? undefined,
    };

    await repo.insert(record);
    logger.info(`[auth-store] API key created: id=${id} user=${userId} scope=${scope} name="${name}"`);

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
   * Validate a raw API key and return user info if valid
   */
  async validateApiKey(rawKey: string): Promise<ValidatedKeyUser | null> {
    this.ensureInitialized();
    if (!rawKey.startsWith(KEY_PREFIX)) return null;

    const prefix = rawKey.slice(0, 12);
    const now = Date.now();

    // Find candidates by prefix
    const repo = this.apiKeyRepo;
    if (!repo) return null;
    const candidates = await repo.findMany({ keyPrefix: prefix });

    for (const row of candidates) {
      // Skip expired keys
      if (row.expiresAt !== undefined && row.expiresAt !== null && row.expiresAt < now) {
        continue;
      }

      if (this.verifyKey(rawKey, row.keyHash)) {
        // Update last_used_at
        await repo.update(row.id, { lastUsedAt: now });

        return {
          id: row.userId || "unknown",
          apiKeyId: row.id,
          scope: row.scope || "full",
        };
      }
    }

    logger.warn(`[auth-store] Validation failed for key prefix=${prefix}`);
    return null;
  }

  /**
   * Revoke (delete) an API key
   */
  async revokeApiKey(keyId: string, userId: string): Promise<boolean> {
    this.ensureInitialized();
    const repo = this.apiKeyRepo;
    if (!repo) return false;
    const key = await repo.findById(keyId);
    if (!key || key.userId !== userId) {
      return false;
    }
    const deleted = await repo.delete(keyId);
    if (deleted) {
      logger.info(`[auth-store] API key revoked: id=${keyId} user=${userId}`);
    }
    return deleted;
  }

  /**
   * List all API keys for a user
   */
  async listApiKeys(userId: string): Promise<ApiKeyInfo[]> {
    this.ensureInitialized();
    const repo = this.apiKeyRepo;
    if (!repo) return [];
    const keys = await repo.findMany({ userId });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scope: k.scope || "full",
      lastUsedAt: k.lastUsedAt ?? null,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt ?? null,
    }));
  }

  /**
   * Import a raw API key record (for migration from legacy auth.sqlite)
   */
  async importApiKeyRecord(record: AuthApiKeyRecord): Promise<void> {
    const repo = this.apiKeyRepo;
    if (!repo) throw new Error("Auth store not initialized");
    await repo.insert(record);
  }

  /**
   * Clear cache (for testing)
   */
  clearCache(): void {
    this.configCache.clear();
  }
}
