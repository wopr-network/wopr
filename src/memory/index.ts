/**
 * Memory module — STUB
 *
 * The full memory system (indexing, FTS5 search, file watching, session hooks)
 * has moved to wopr-plugin-memory-semantic.
 *
 * This stub exports the types that other core modules still reference,
 * and the temporal filter parser (used by A2A tools).
 */

// Re-export types that core modules reference
export type {
  MemoryConfig,
  MemorySearchResult,
  MemorySource,
  TemporalFilter,
} from "./types.js";

export { parseTemporalFilter } from "./types.js";

// discoverSessionMemoryDirs is used by A2A tools - keep it here
import fs from "node:fs/promises";
import path from "node:path";
import { SESSIONS_DIR } from "../paths.js";

export async function discoverSessionMemoryDirs(): Promise<string[]> {
  const sessionsBase = SESSIONS_DIR;
  const dirs: string[] = [];
  try {
    const entries = await fs.readdir(sessionsBase, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionDir = path.join(sessionsBase, entry.name);
      const memDir = path.join(sessionDir, "memory");
      try {
        const stat = await fs.stat(memDir);
        if (stat.isDirectory()) dirs.push(sessionDir);
      } catch {}
    }
  } catch {}
  return dirs;
}
