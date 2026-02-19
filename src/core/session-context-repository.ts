/**
 * Session Context Repository (WOP-556)
 *
 * CRUD operations for session context files via the Storage API.
 * Replaces direct filesystem reads/writes of SOUL.md, IDENTITY.md,
 * MEMORY.md, AGENTS.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md,
 * and daily memory files (memory/YYYY-MM-DD.md).
 *
 * Key design decisions:
 * - Composite primary key: "{sessionName}:{filename}"
 * - Global identity files stored under sessionName "__global__"
 * - Daily memory files stored as filename "memory/YYYY-MM-DD.md"
 */

import { logger } from "../logger.js";
import { getStorage } from "../storage/index.js";
import { type SessionContextRecord, sessionContextPluginSchema } from "./session-context-schema.js";

let initialized = false;

/** Initialize schema — idempotent, call on first access */
export async function initSessionContextStorage(): Promise<void> {
  if (initialized) return;
  const storage = getStorage();
  await storage.register(sessionContextPluginSchema);
  initialized = true;
}

/** Reset for testing */
export function resetSessionContextStorageInit(): void {
  initialized = false;
}

/** Build composite key from session name and filename */
function makeId(sessionName: string, filename: string): string {
  return `${sessionName}:${filename}`;
}

/** Get the repository (ensures schema is initialized) */
function repo() {
  return getStorage().getRepository<SessionContextRecord>("session_context", "session_context");
}

// ---------- Public API ----------

/**
 * Get the content of a session context file.
 * Returns null if not found.
 */
export async function getSessionContext(sessionName: string, filename: string): Promise<string | null> {
  await initSessionContextStorage();
  const id = makeId(sessionName, filename);
  const record = await repo().findById(id);
  return record?.content ?? null;
}

/**
 * Set (upsert) the content of a session context file.
 */
export async function setSessionContext(
  sessionName: string,
  filename: string,
  content: string,
  source: "global" | "session",
): Promise<void> {
  await initSessionContextStorage();
  const id = makeId(sessionName, filename);
  const r = repo();
  const existing = await r.findById(id);
  const now = Date.now();

  if (existing) {
    await r.update(id, { content, source, updatedAt: now });
  } else {
    await r.insert({
      id,
      sessionName,
      filename,
      content,
      source,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * List all filenames stored for a given session.
 */
export async function listSessionContextFiles(sessionName: string): Promise<string[]> {
  await initSessionContextStorage();
  const records = await repo().findMany({ sessionName } as Partial<SessionContextRecord>);
  return records.map((r) => r.filename);
}

/**
 * Delete a specific session context file.
 * No-op if not found.
 */
export async function deleteSessionContext(sessionName: string, filename: string): Promise<void> {
  await initSessionContextStorage();
  const id = makeId(sessionName, filename);
  await repo().delete(id);
}

/**
 * Delete all context files for a session.
 */
export async function deleteAllSessionContext(sessionName: string): Promise<void> {
  await initSessionContextStorage();
  await repo().deleteMany({ sessionName } as Partial<SessionContextRecord>);
}

/**
 * One-time migration: read all .md files from session directories and global
 * identity directory, insert them into SQL.
 *
 * Idempotent: skips files already in SQL.
 */
export async function migrateSessionContextFromFilesystem(
  sessionsDir: string,
  globalIdentityDir: string,
): Promise<void> {
  const { existsSync, readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");

  await initSessionContextStorage();

  let migratedCount = 0;

  // Helper to migrate a single file
  const migrateFile = async (sessionName: string, filename: string, filePath: string, source: "global" | "session") => {
    const id = makeId(sessionName, filename);
    const existing = await repo().findById(id);
    if (existing) return; // Already migrated

    try {
      const content = readFileSync(filePath, "utf-8");
      const stats = statSync(filePath);
      const now = stats.mtimeMs || Date.now();
      await repo().insert({
        id,
        sessionName,
        filename,
        content,
        source,
        createdAt: stats.birthtimeMs || now,
        updatedAt: now,
      });
      migratedCount++;
      logger.debug(`[session-context-migrate] Migrated ${source}/${sessionName}/${filename}`);
    } catch (err) {
      logger.warn(`[session-context-migrate] Failed to migrate ${filePath}:`, err);
    }
  };

  // Migrate global identity files
  if (existsSync(globalIdentityDir)) {
    const globalFiles = readdirSync(globalIdentityDir).filter((f: string) => f.endsWith(".md"));
    for (const file of globalFiles) {
      await migrateFile("__global__", file, join(globalIdentityDir, file), "global");
    }

    // Global memory directory (SELF.md, YYYY-MM-DD.md)
    const globalMemoryDir = join(globalIdentityDir, "memory");
    if (existsSync(globalMemoryDir)) {
      const memFiles = readdirSync(globalMemoryDir).filter((f: string) => f.endsWith(".md"));
      for (const file of memFiles) {
        await migrateFile("__global__", `memory/${file}`, join(globalMemoryDir, file), "global");
      }
    }
  }

  // Migrate per-session files
  if (existsSync(sessionsDir)) {
    let entries: string[];
    try {
      entries = readdirSync(sessionsDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(sessionsDir, entry);
      try {
        if (!statSync(entryPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const sessionName = entry;

      // Root-level .md files: SOUL.md, IDENTITY.md, AGENTS.md, USER.md, etc.
      const rootFiles = readdirSync(entryPath).filter((f: string) => f.endsWith(".md"));
      for (const file of rootFiles) {
        await migrateFile(sessionName, file, join(entryPath, file), "session");
      }

      // memory/ subdirectory: SELF.md, YYYY-MM-DD.md
      const memoryDir = join(entryPath, "memory");
      if (existsSync(memoryDir)) {
        const memFiles = readdirSync(memoryDir).filter((f: string) => f.endsWith(".md"));
        for (const file of memFiles) {
          await migrateFile(sessionName, `memory/${file}`, join(memoryDir, file), "session");
        }
      }
    }
  }

  logger.info(`[session-context-migrate] Migration complete: ${migratedCount} files migrated`);
}
