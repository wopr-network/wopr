/**
 * User Auth SQLite Schema (WOP-208)
 *
 * Creates users and refresh_tokens tables in the WOPR SQLite database.
 * Uses Node.js built-in node:sqlite (DatabaseSync).
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { WOPR_HOME } from "../../paths.js";

const require = createRequire(import.meta.url);

let _db: DatabaseSync | null = null;

/**
 * Get or create the auth database connection.
 * Uses the same WOPR_HOME directory as other WOPR databases.
 */
export function getAuthDb(): DatabaseSync {
  if (_db) return _db;

  const { DatabaseSync: DB } = require("node:sqlite");
  const dbPath = join(WOPR_HOME, "auth.sqlite");
  _db = new DB(dbPath) as DatabaseSync;

  ensureAuthSchema(_db);
  return _db;
}

/**
 * Create users and refresh_tokens tables if they don't exist.
 */
export function ensureAuthSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);`);
}

/**
 * Close the database connection. Used for testing cleanup.
 */
export function closeAuthDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
