// MemoryIndexManager - FTS5 keyword search only
// Vector/semantic search available via wopr-plugin-memory-semantic

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);

import type { MemoryFileChange } from "../core/events.js";
import { eventBus } from "../core/events.js";
import { WOPR_HOME } from "../paths.js";
import { buildFileEntry, chunkMarkdown, ensureDir, hashText, listMemoryFiles } from "./internal.js";
import { ensureMemoryIndexSchema } from "./schema.js";
import { syncSessionFiles } from "./sync-sessions.js";
import {
  DEFAULT_MEMORY_CONFIG,
  type MemoryConfig,
  type MemorySearchResult,
  type MemorySource,
  type TemporalFilter,
} from "./types.js";

const META_KEY = "memory_index_meta_v1";
const SNIPPET_MAX_CHARS = 700;
const FTS_TABLE = "chunks_fts";

type MemoryIndexMeta = {
  chunkTokens: number;
  chunkOverlap: number;
};

/**
 * Build FTS5 query from raw search string
 */
function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[A-Za-z0-9_]+/g)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) {
    return null;
  }
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}

/**
 * Convert BM25 rank to normalized score (0-1)
 */
function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

/**
 * Build SQL WHERE clause for temporal filtering
 * Uses the chunks.updated_at column (ms since epoch)
 */
function buildTemporalFilter(temporal: TemporalFilter | undefined, alias?: string): { sql: string; params: number[] } {
  if (!temporal) {
    return { sql: "", params: [] };
  }

  const column = alias ? `${alias}.updated_at` : "updated_at";
  const clauses: string[] = [];
  const params: number[] = [];

  if (temporal.after !== undefined) {
    clauses.push(`${column} >= ?`);
    params.push(temporal.after);
  }

  if (temporal.before !== undefined) {
    clauses.push(`${column} <= ?`);
    params.push(temporal.before);
  }

  if (clauses.length === 0) {
    return { sql: "", params: [] };
  }

  return { sql: ` AND ${clauses.join(" AND ")}`, params };
}

/**
 * Scan /data/sessions/{id}/ directories that have a memory/ subdirectory.
 * Returns the session ROOT dirs (not the memory/ subdirs) because
 * listMemoryFiles() expects a workspace dir and looks for memory/ inside it.
 * Exported so other modules (e.g. a2a-mcp) can discover these dirs independently.
 */
export async function discoverSessionMemoryDirs(): Promise<string[]> {
  const sessionsBase = "/data/sessions";
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

export class MemoryIndexManager {
  private readonly globalDir: string;
  private readonly sessionDir: string;
  private readonly config: MemoryConfig;
  private db: DatabaseSync;
  private readonly sources: Set<MemorySource>;
  private readonly fts: {
    enabled: boolean;
    available: boolean;
    loadError?: string;
  };
  private closed = false;
  private dirty = false;
  private syncing: Promise<void> | null = null;

  static async create(params: {
    globalDir: string;
    sessionDir: string;
    config?: Partial<MemoryConfig>;
  }): Promise<MemoryIndexManager> {
    const config = { ...DEFAULT_MEMORY_CONFIG, ...params.config };

    // Set default store path if not provided
    if (!config.store.path) {
      config.store.path = path.join(WOPR_HOME, "memory", "index.sqlite");
    }

    return new MemoryIndexManager({
      globalDir: params.globalDir,
      sessionDir: params.sessionDir,
      config,
    });
  }

  private constructor(params: {
    globalDir: string;
    sessionDir: string;
    config: MemoryConfig;
  }) {
    this.globalDir = params.globalDir;
    this.sessionDir = params.sessionDir;
    this.config = params.config;
    this.sources = new Set(["global", "session", "sessions"] as MemorySource[]);
    this.db = this.openDatabase();
    this.fts = { enabled: true, available: false };
    this.ensureSchema();

    // Subscribe FTS5 indexing as handler for memory:filesChanged
    eventBus.on("memory:filesChanged", (event) => {
      this.handleFilesChanged(event);
    });

    this.dirty = true;
  }

  async search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      temporal?: TemporalFilter;
    },
  ): Promise<MemorySearchResult[]> {
    if (this.config.sync.onSearch && this.dirty) {
      await this.sync().catch((err) => {
        console.warn(`memory sync failed (search): ${String(err)}`);
      });
    }
    const cleaned = query.trim();
    if (!cleaned) {
      return [];
    }
    const minScore = opts?.minScore ?? this.config.query.minScore;
    const maxResults = opts?.maxResults ?? this.config.query.maxResults;
    const temporal = opts?.temporal;

    const results = await this.searchKeyword(cleaned, maxResults * 2, temporal);
    return results.filter((entry) => entry.score >= minScore).slice(0, maxResults);
  }

  private async searchKeyword(query: string, limit: number, temporal?: TemporalFilter): Promise<MemorySearchResult[]> {
    if (!this.fts.available) {
      return [];
    }

    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    const sourceFilter = this.buildSourceFilter();
    const temporalFilter = buildTemporalFilter(temporal, "c");
    const hasTemporal = temporalFilter.sql.length > 0;

    // If temporal filter is set, join with chunks table to get updated_at
    // FTS5 virtual tables don't have the updated_at column
    let sql: string;
    let params: (string | number)[];

    if (hasTemporal) {
      sql = `
        SELECT
          f.id,
          f.path,
          f.source,
          f.start_line,
          f.end_line,
          snippet(${FTS_TABLE}, 0, '', '', '...', 64) AS snippet,
          bm25(${FTS_TABLE}) AS rank
        FROM ${FTS_TABLE} f
        JOIN chunks c ON c.id = f.id
        WHERE ${FTS_TABLE} MATCH ?
          ${sourceFilter.sql}
          ${temporalFilter.sql}
        ORDER BY rank
        LIMIT ?
      `;
      params = [ftsQuery, ...sourceFilter.params, ...temporalFilter.params, limit];
    } else {
      sql = `
        SELECT
          f.id,
          f.path,
          f.source,
          f.start_line,
          f.end_line,
          snippet(${FTS_TABLE}, 0, '', '', '...', 64) AS snippet,
          bm25(${FTS_TABLE}) AS rank
        FROM ${FTS_TABLE} f
        WHERE ${FTS_TABLE} MATCH ?
          ${sourceFilter.sql}
        ORDER BY rank
        LIMIT ?
      `;
      params = [ftsQuery, ...sourceFilter.params, limit];
    }

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: string;
        path: string;
        source: MemorySource;
        start_line: number;
        end_line: number;
        snippet: string;
        rank: number;
      }>;

      return rows.map((row) => ({
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        score: bm25RankToScore(row.rank),
        snippet: row.snippet?.substring(0, SNIPPET_MAX_CHARS) ?? "",
        source: row.source,
      }));
    } catch (err) {
      console.warn(`FTS search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async sync(params?: { force?: boolean }): Promise<void> {
    if (this.syncing) {
      return this.syncing;
    }
    this.syncing = this.runSync(params).finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async runSync(_params?: { force?: boolean }): Promise<void> {
    const heapMB = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const needsFullReindex = await this.checkNeedsFullReindex();
    console.log(`[memory-sync] start (heap: ${heapMB()}MB, fullReindex: ${needsFullReindex})`);

    // Emit per-source to keep memory bounded (don't accumulate all changes at once)

    // Global memory files
    const globalChanges = await this.scanMemoryFiles({
      dirs: [this.globalDir],
      source: "global",
      needsFullReindex,
    });
    console.log(`[memory-sync] global: ${globalChanges.length} changes (heap: ${heapMB()}MB)`);
    if (globalChanges.length > 0) {
      await eventBus.emit("memory:filesChanged", { changes: globalChanges }, "core");
      console.log(`[memory-sync] global emitted (heap: ${heapMB()}MB)`);
    }

    // Session memory files (current session + all session memory dirs)
    const sessionMemoryDirs = await discoverSessionMemoryDirs();
    console.log(`[memory-sync] session dirs: ${sessionMemoryDirs.length} (heap: ${heapMB()}MB)`);
    const sessionChanges = await this.scanMemoryFiles({
      dirs: [this.sessionDir, ...sessionMemoryDirs],
      source: "session",
      needsFullReindex,
    });
    console.log(`[memory-sync] session: ${sessionChanges.length} changes (heap: ${heapMB()}MB)`);
    if (sessionChanges.length > 0) {
      await eventBus.emit("memory:filesChanged", { changes: sessionChanges }, "core");
      console.log(`[memory-sync] session emitted (heap: ${heapMB()}MB)`);
    }

    // Session transcripts — index one file at a time to avoid OOM
    if (this.config.sync.indexSessions !== false) {
      console.log(`[memory-sync] starting transcript streaming (heap: ${heapMB()}MB)`);
      await this.syncSessionTranscriptsStreaming(needsFullReindex);
      console.log(`[memory-sync] transcripts done (heap: ${heapMB()}MB)`);
    }

    this.writeMeta();
    this.dirty = false;
    console.log(`[memory-sync] complete (heap: ${heapMB()}MB)`);
  }

  /**
   * Stream session transcripts one file at a time — emit per-file so each
   * can be processed and GC'd before loading the next. Prevents OOM from
   * accumulating all 50MB+ of session JSONL in memory at once.
   */
  private async syncSessionTranscriptsStreaming(needsFullReindex: boolean): Promise<void> {
    await syncSessionFiles({
      db: this.db,
      needsFullReindex,
      vectorTable: "",
      ftsTable: FTS_TABLE,
      ftsEnabled: this.fts.enabled,
      ftsAvailable: this.fts.available,
      model: "fts5",
      dirtyFiles: new Set(),
      runWithConcurrency: (tasks, concurrency) => this.runWithConcurrency(tasks, concurrency),
      indexSessionFile: async (entry) => {
        const chunks = chunkMarkdown(entry.content, this.config.chunking);
        if (chunks.length === 0) return;
        // Emit per-file — handlers process and release before next file
        await eventBus.emit(
          "memory:filesChanged",
          {
            changes: [
              {
                action: "upsert" as const,
                path: entry.path,
                absPath: entry.absPath,
                source: "sessions" as MemorySource,
                chunks: chunks.map((chunk) => ({
                  id: hashText(`sessions:${entry.path}:${chunk.startLine}:${chunk.endLine}:${chunk.hash}`),
                  text: chunk.text,
                  hash: chunk.hash,
                  startLine: chunk.startLine,
                  endLine: chunk.endLine,
                })),
              },
            ],
          },
          "core",
        );
      },
      concurrency: 1, // One at a time to keep memory bounded
    });
  }

  private async scanMemoryFiles(params: {
    dirs: string[];
    source: MemorySource;
    needsFullReindex: boolean;
  }): Promise<MemoryFileChange[]> {
    const changes: MemoryFileChange[] = [];
    const activePaths = new Set<string>();

    for (const dir of params.dirs) {
      const files = await listMemoryFiles(dir);
      const fileEntries = await Promise.all(files.map(async (file) => buildFileEntry(file, dir)));

      for (const entry of fileEntries) {
        activePaths.add(entry.path);
        const record = this.db
          .prepare(`SELECT hash FROM files WHERE path = ? AND source = ?`)
          .get(entry.path, params.source) as { hash: string } | undefined;
        if (!params.needsFullReindex && record?.hash === entry.hash) {
          continue;
        }
        const content = await fs.readFile(entry.absPath, "utf-8");
        const chunks = chunkMarkdown(content, this.config.chunking);
        changes.push({
          action: "upsert",
          path: entry.path,
          absPath: entry.absPath,
          source: params.source,
          chunks: chunks.map((chunk) => ({
            id: hashText(`${params.source}:${entry.path}:${chunk.startLine}:${chunk.endLine}:${chunk.hash}`),
            text: chunk.text,
            hash: chunk.hash,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
          })),
        });
      }
    }

    // Detect stale entries across ALL dirs for this source
    const staleRows = this.db.prepare(`SELECT path FROM files WHERE source = ?`).all(params.source) as Array<{
      path: string;
    }>;
    for (const stale of staleRows) {
      if (!activePaths.has(stale.path)) {
        changes.push({
          action: "delete",
          path: stale.path,
          source: params.source,
        });
      }
    }

    return changes;
  }

  private handleFilesChanged(event: { changes: MemoryFileChange[] }): void {
    const heapMB = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalChunks = event.changes.reduce((sum, c) => sum + (c.chunks?.length || 0), 0);
    console.log(
      `[handleFilesChanged] ${event.changes.length} changes, ${totalChunks} total chunks (heap=${heapMB()}MB)`,
    );
    for (const change of event.changes) {
      if (change.action === "delete") {
        this.db.prepare(`DELETE FROM files WHERE path = ? AND source = ?`).run(change.path, change.source);
        this.db.prepare(`DELETE FROM chunks WHERE path = ? AND source = ?`).run(change.path, change.source);
        if (this.fts.available) {
          try {
            this.db.prepare(`DELETE FROM ${FTS_TABLE} WHERE path = ? AND source = ?`).run(change.path, change.source);
          } catch (err) {
            console.warn(`[memory] FTS delete failed for ${change.path}: ${err}`);
          }
        }
        continue;
      }

      // Upsert
      if (!change.chunks || change.chunks.length === 0) continue;
      console.log(`[handleFilesChanged] upsert ${change.path}: ${change.chunks.length} chunks (heap=${heapMB()}MB)`);

      // Delete existing chunks for this file
      this.db.prepare(`DELETE FROM chunks WHERE path = ? AND source = ?`).run(change.path, change.source);
      if (this.fts.available) {
        try {
          this.db.prepare(`DELETE FROM ${FTS_TABLE} WHERE path = ? AND source = ?`).run(change.path, change.source);
        } catch (err) {
          console.warn(`[memory] FTS delete failed for ${change.path}: ${err}`);
        }
      }

      const insertChunk = this.db.prepare(
        `INSERT OR REPLACE INTO chunks (id, path, source, start_line, end_line, hash, model, text, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertFts = this.fts.available
        ? this.db.prepare(
            `INSERT OR REPLACE INTO ${FTS_TABLE} (text, id, path, source, model, start_line, end_line)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
        : null;

      this.db.exec("BEGIN");
      try {
        for (const chunk of change.chunks) {
          const now = Date.now();
          insertChunk.run(
            chunk.id,
            change.path,
            change.source,
            chunk.startLine,
            chunk.endLine,
            chunk.hash,
            "fts5",
            chunk.text,
            now,
          );
          if (insertFts) {
            insertFts.run(chunk.text, chunk.id, change.path, change.source, "fts5", chunk.startLine, chunk.endLine);
          }
        }

        // Compute file-level hash from chunk hashes for the files table
        const combinedHash = change.chunks.map((c) => c.hash).join("");
        this.db
          .prepare(
            `INSERT OR REPLACE INTO files (path, source, hash, mtime, size)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(change.path, change.source, combinedHash, Date.now(), 0);

        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  private async checkNeedsFullReindex(): Promise<boolean> {
    const meta = this.readMeta();
    if (!meta) {
      return true;
    }
    if (meta.chunkTokens !== this.config.chunking.tokens) {
      return true;
    }
    if (meta.chunkOverlap !== this.config.chunking.overlap) {
      return true;
    }
    return false;
  }

  private readMeta(): MemoryIndexMeta | null {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(META_KEY) as { value: string } | undefined;
    if (!row?.value) {
      return null;
    }
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  private writeMeta(): void {
    const meta: MemoryIndexMeta = {
      chunkTokens: this.config.chunking.tokens,
      chunkOverlap: this.config.chunking.overlap,
    };
    this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(META_KEY, JSON.stringify(meta));
  }

  private buildSourceFilter(alias?: string): { sql: string; params: MemorySource[] } {
    const sources = Array.from(this.sources);
    if (sources.length === 0) {
      return { sql: "", params: [] };
    }
    const column = alias ? `${alias}.source` : "source";
    const placeholders = sources.map(() => "?").join(", ");
    return { sql: ` AND ${column} IN (${placeholders})`, params: sources };
  }

  private openDatabase(): DatabaseSync {
    const dbPath = this.config.store.path;
    const dir = path.dirname(dbPath);
    ensureDir(dir);
    const { DatabaseSync } = require("node:sqlite");
    return new DatabaseSync(dbPath);
  }

  private ensureSchema() {
    const result = ensureMemoryIndexSchema({
      db: this.db,
      ftsTable: FTS_TABLE,
      ftsEnabled: this.fts.enabled,
    });
    this.fts.available = result.ftsAvailable;
    if (result.ftsError) {
      this.fts.loadError = result.ftsError;
      console.warn(`fts unavailable: ${result.ftsError}`);
    }
  }

  private async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
    const results: T[] = [];
    const executing: Set<Promise<void>> = new Set();

    for (const task of tasks) {
      const p = task().then((result) => {
        results.push(result);
      }).finally(() => {
        executing.delete(p);
      });
      executing.add(p);

      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  status(): {
    files: number;
    chunks: number;
    dirty: boolean;
    fts: { enabled: boolean; available: boolean };
  } {
    const files = this.db.prepare(`SELECT COUNT(*) as c FROM files`).get() as { c: number };
    const chunks = this.db.prepare(`SELECT COUNT(*) as c FROM chunks`).get() as { c: number };
    return {
      files: files?.c ?? 0,
      chunks: chunks?.c ?? 0,
      dirty: this.dirty,
      fts: { enabled: this.fts.enabled, available: this.fts.available },
    };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.db.close();
  }
}
