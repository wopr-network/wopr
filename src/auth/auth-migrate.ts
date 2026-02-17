/**
 * Auth migration - migrate auth.json and auth.sqlite to Storage API
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { logger } from "../logger.js";
import { WOPR_HOME, AUTH_FILE } from "../paths.js";
import type { AuthStore } from "./auth-store.js";
import type { AuthState } from "../auth.js";
import { isEncryptedData } from "../auth.js";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite");

const AUTH_SQLITE_PATH = join(WOPR_HOME, "auth.sqlite");

/**
 * Migrate auth.json to Storage API
 * Preserves encryption - encrypted values stay encrypted
 */
export async function migrateAuthJson(authStore: AuthStore): Promise<void> {
  if (!existsSync(AUTH_FILE)) {
    logger.info("[auth-migrate] No auth.json found, skipping migration");
    return;
  }

  logger.info("[auth-migrate] Migrating auth.json to Storage API");

  try {
    const raw = readFileSync(AUTH_FILE, "utf-8");
    
    // Check if this is a valid JSON (could be encrypted or plaintext JSON)
    let authData: AuthState | null = null;
    
    if (isEncryptedData(raw)) {
      // Store the encrypted blob directly - we don't decrypt during migration
      // The decryption key (WOPR_CREDENTIAL_KEY) is used at read time
      await authStore.setCredential(
        "wopr-auth-state",
        "wopr",
        raw,
        "aes-256-gcm",
      );
      logger.info("[auth-migrate] Stored encrypted auth state");
    } else {
      // Parse plaintext JSON
      try {
        authData = JSON.parse(raw);
        if (authData) {
          // Store the JSON as-is (will be read by loadAuth())
          await authStore.setCredential(
            "wopr-auth-state",
            "wopr",
            JSON.stringify(authData),
          );
          logger.info(`[auth-migrate] Migrated auth state: type=${authData.type}`);
        }
      } catch (parseErr) {
        logger.error(`[auth-migrate] Failed to parse auth.json: ${parseErr}`);
        throw parseErr;
      }
    }

    // Backup the original file
    const backupPath = `${AUTH_FILE}.migrated`;
    renameSync(AUTH_FILE, backupPath);
    logger.info(`[auth-migrate] Original auth.json backed up to ${backupPath}`);
  } catch (err) {
    logger.error(`[auth-migrate] Migration failed: ${err}`);
    throw err;
  }
}

/**
 * Migrate auth.sqlite to Storage API
 * This is a driver migration - copy rows from raw node:sqlite to Storage API
 */
export async function migrateAuthSqlite(authStore: AuthStore): Promise<void> {
  if (!existsSync(AUTH_SQLITE_PATH)) {
    logger.info("[auth-migrate] No auth.sqlite found, skipping migration");
    return;
  }

  logger.info("[auth-migrate] Migrating auth.sqlite to Storage API");

  let db: InstanceType<typeof DatabaseSync> | undefined;

  try {
    // Open read-only to ensure we don't modify the source
    db = new DatabaseSync(AUTH_SQLITE_PATH, { readOnly: true });

    // Check if api_keys table exists
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'"
    ).all() as Array<{ name: string }>;

    if (tables.length === 0) {
      logger.info("[auth-migrate] No api_keys table in auth.sqlite, skipping");
      db.close();
      return;
    }

    // Fetch all API keys
    const stmt = db.prepare(
      `SELECT id, user_id, name, key_hash, key_prefix, scope, last_used_at, created_at, expires_at
       FROM api_keys ORDER BY created_at ASC`
    );
    const rows = stmt.all() as Array<{
      id: string;
      user_id: string;
      name: string;
      key_hash: string;
      key_prefix: string;
      scope: string;
      last_used_at: number | null;
      created_at: number;
      expires_at: number | null;
    }>;

    logger.info(`[auth-migrate] Found ${rows.length} API keys to migrate`);

    // Copy each row to the new storage
    for (const row of rows) {
      await authStore["apiKeyRepo"]!.insert({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        keyHash: row.key_hash,
        keyPrefix: row.key_prefix,
        scope: row.scope,
        lastUsedAt: row.last_used_at ?? undefined,
        createdAt: row.created_at,
        expiresAt: row.expires_at ?? undefined,
      });
    }

    db.close();
    db = undefined;

    // Backup the original file
    const backupPath = `${AUTH_SQLITE_PATH}.migrated`;
    renameSync(AUTH_SQLITE_PATH, backupPath);
    logger.info(`[auth-migrate] Original auth.sqlite backed up to ${backupPath}`);
    logger.info(`[auth-migrate] Migrated ${rows.length} API keys successfully`);
  } catch (err) {
    if (db) db.close();
    logger.error(`[auth-migrate] Migration failed: ${err}`);
    throw err;
  }
}

/**
 * Run all auth migrations
 */
export async function migrateAuth(authStore: AuthStore): Promise<void> {
  await migrateAuthJson(authStore);
  await migrateAuthSqlite(authStore);
}
