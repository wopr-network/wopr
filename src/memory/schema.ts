// SQLite schema for memory indexing - copied from OpenClaw
import type { DatabaseSync } from "node:sqlite";

export function ensureMemoryIndexSchema(params: { db: DatabaseSync; ftsTable: string; ftsEnabled: boolean }): {
  ftsAvailable: boolean;
  ftsError?: string;
} {
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      PRIMARY KEY (path, source)
    );
  `);
  params.db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  let ftsAvailable = false;
  let ftsError: string | undefined;
  if (params.ftsEnabled) {
    try {
      params.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${params.ftsTable} USING fts5(\n` +
          `  text,\n` +
          `  id UNINDEXED,\n` +
          `  path UNINDEXED,\n` +
          `  source UNINDEXED,\n` +
          `  model UNINDEXED,\n` +
          `  start_line UNINDEXED,\n` +
          `  end_line UNINDEXED\n` +
          `);`,
      );
      ftsAvailable = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ftsAvailable = false;
      ftsError = message;
    }
  }

  ensureColumn(params.db, "files", "source", "TEXT NOT NULL DEFAULT 'memory'");
  ensureColumn(params.db, "chunks", "source", "TEXT NOT NULL DEFAULT 'memory'");
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);`);
  params.db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);`);

  // Migrate files table from path-only PK to (path, source) composite PK
  migrateFilesCompositeKey(params.db);

  return { ftsAvailable, ...(ftsError ? { ftsError } : {}) };
}

/**
 * Migrate existing files table from path-only PK to (path, source) composite PK.
 * No-op if table already has composite PK.
 */
function migrateFilesCompositeKey(db: DatabaseSync): void {
  // Check if files table has path as sole PK (pk=1 on path, pk=0 on source)
  const cols = db.prepare(`PRAGMA table_info(files)`).all() as Array<{ name: string; pk: number }>;
  const pathCol = cols.find((c) => c.name === "path");
  const sourceCol = cols.find((c) => c.name === "source");
  if (!pathCol || !sourceCol) return;
  // If source already has pk > 0, composite key is in place
  if (sourceCol.pk > 0) return;
  // If path has pk=1 and source has pk=0, we need to migrate
  if (pathCol.pk !== 1) return;

  db.exec("BEGIN");
  try {
    db.exec(`ALTER TABLE files RENAME TO files_old;`);
    db.exec(`
      CREATE TABLE files (
        path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'memory',
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        PRIMARY KEY (path, source)
      );
    `);
    db.exec(`INSERT OR IGNORE INTO files (path, source, hash, mtime, size) SELECT path, source, hash, mtime, size FROM files_old;`);
    db.exec(`DROP TABLE files_old;`);
    db.exec("COMMIT");
  } catch {
    db.exec("ROLLBACK");
  }
}

function ensureColumn(db: DatabaseSync, table: "files" | "chunks", column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
