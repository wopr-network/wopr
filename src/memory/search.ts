// Search functions for vector and keyword search - adapted from OpenClaw
import type { DatabaseSync } from "node:sqlite";
import { cosineSimilarity, parseEmbedding, truncateUtf16Safe } from "./internal.js";
import type { TemporalFilter } from "./types.js";

const vectorToBlob = (embedding: number[]): Buffer =>
  Buffer.from(new Float32Array(embedding).buffer);

export type SearchSource = string;

export type SearchRowResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: SearchSource;
};

/**
 * Build SQL WHERE clause for temporal filtering
 * Uses the chunks.updated_at column (ms since epoch)
 */
export function buildTemporalFilter(
  temporal: TemporalFilter | undefined,
  alias?: string
): { sql: string; params: number[] } {
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

export async function searchVector(params: {
  db: DatabaseSync;
  vectorTable: string;
  providerModel: string;
  queryVec: number[];
  limit: number;
  snippetMaxChars: number;
  ensureVectorReady: (dimensions: number) => Promise<boolean>;
  sourceFilterVec: { sql: string; params: SearchSource[] };
  sourceFilterChunks: { sql: string; params: SearchSource[] };
  temporalFilter?: { sql: string; params: number[] };
}): Promise<SearchRowResult[]> {
  if (params.queryVec.length === 0 || params.limit <= 0) {
    return [];
  }
  const temporalSql = params.temporalFilter?.sql ?? "";
  const temporalParams = params.temporalFilter?.params ?? [];

  if (await params.ensureVectorReady(params.queryVec.length)) {
    const rows = params.db
      .prepare(
        `SELECT c.id, c.path, c.start_line, c.end_line, c.text,\n` +
          `       c.source,\n` +
          `       vec_distance_cosine(v.embedding, ?) AS dist\n` +
          `  FROM ${params.vectorTable} v\n` +
          `  JOIN chunks c ON c.id = v.id\n` +
          ` WHERE c.model = ?${params.sourceFilterVec.sql}${temporalSql}\n` +
          ` ORDER BY dist ASC\n` +
          ` LIMIT ?`,
      )
      .all(
        vectorToBlob(params.queryVec),
        params.providerModel,
        ...params.sourceFilterVec.params,
        ...temporalParams,
        params.limit,
      ) as Array<{
      id: string;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      source: SearchSource;
      dist: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      score: 1 - row.dist,
      snippet: truncateUtf16Safe(row.text, params.snippetMaxChars),
      source: row.source,
    }));
  }

  const candidates = listChunks({
    db: params.db,
    providerModel: params.providerModel,
    sourceFilter: params.sourceFilterChunks,
    temporalFilter: params.temporalFilter,
  });
  const scored = candidates
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(params.queryVec, chunk.embedding),
    }))
    .filter((entry) => Number.isFinite(entry.score));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit)
    .map((entry: { chunk: { id: string; path: string; startLine: number; endLine: number; text: string; source: SearchSource }; score: number }) => ({
      id: entry.chunk.id,
      path: entry.chunk.path,
      startLine: entry.chunk.startLine,
      endLine: entry.chunk.endLine,
      score: entry.score,
      snippet: truncateUtf16Safe(entry.chunk.text, params.snippetMaxChars),
      source: entry.chunk.source,
    }));
}

export function listChunks(params: {
  db: DatabaseSync;
  providerModel: string;
  sourceFilter: { sql: string; params: SearchSource[] };
  temporalFilter?: { sql: string; params: number[] };
}): Array<{
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  embedding: number[];
  source: SearchSource;
}> {
  const temporalSql = params.temporalFilter?.sql ?? "";
  const temporalParams = params.temporalFilter?.params ?? [];

  const rows = params.db
    .prepare(
      `SELECT id, path, start_line, end_line, text, embedding, source\n` +
        `  FROM chunks\n` +
        ` WHERE model = ?${params.sourceFilter.sql}${temporalSql}`,
    )
    .all(params.providerModel, ...params.sourceFilter.params, ...temporalParams) as Array<{
    id: string;
    path: string;
    start_line: number;
    end_line: number;
    text: string;
    embedding: string;
    source: SearchSource;
  }>;

  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    text: row.text,
    embedding: parseEmbedding(row.embedding),
    source: row.source,
  }));
}

export async function searchKeyword(params: {
  db: DatabaseSync;
  ftsTable: string;
  providerModel: string;
  query: string;
  limit: number;
  snippetMaxChars: number;
  sourceFilter: { sql: string; params: SearchSource[] };
  buildFtsQuery: (raw: string) => string | null;
  bm25RankToScore: (rank: number) => number;
  temporalFilter?: { sql: string; params: number[] };
}): Promise<Array<SearchRowResult & { textScore: number }>> {
  if (params.limit <= 0) {
    return [];
  }
  const ftsQuery = params.buildFtsQuery(params.query);
  if (!ftsQuery) {
    return [];
  }

  const temporalSql = params.temporalFilter?.sql ?? "";
  const temporalParams = params.temporalFilter?.params ?? [];

  // If temporal filter is set, join with chunks table to get updated_at
  // FTS5 virtual tables don't support additional columns
  const hasTemporal = temporalSql.length > 0;

  let rows: Array<{
    id: string;
    path: string;
    source: SearchSource;
    start_line: number;
    end_line: number;
    text: string;
    rank: number;
  }>;

  if (hasTemporal) {
    // Join with chunks table to filter by updated_at
    rows = params.db
      .prepare(
        `SELECT f.id, f.path, f.source, f.start_line, f.end_line, f.text,\n` +
          `       bm25(${params.ftsTable}) AS rank\n` +
          `  FROM ${params.ftsTable} f\n` +
          `  JOIN chunks c ON c.id = f.id\n` +
          ` WHERE ${params.ftsTable} MATCH ? AND f.model = ?${params.sourceFilter.sql}${temporalSql.replace(/\bupdated_at\b/g, "c.updated_at")}\n` +
          ` ORDER BY rank ASC\n` +
          ` LIMIT ?`,
      )
      .all(ftsQuery, params.providerModel, ...params.sourceFilter.params, ...temporalParams, params.limit) as typeof rows;
  } else {
    rows = params.db
      .prepare(
        `SELECT id, path, source, start_line, end_line, text,\n` +
          `       bm25(${params.ftsTable}) AS rank\n` +
          `  FROM ${params.ftsTable}\n` +
          ` WHERE ${params.ftsTable} MATCH ? AND model = ?${params.sourceFilter.sql}\n` +
          ` ORDER BY rank ASC\n` +
          ` LIMIT ?`,
      )
      .all(ftsQuery, params.providerModel, ...params.sourceFilter.params, params.limit) as typeof rows;
  }

  return rows.map((row) => {
    const textScore = params.bm25RankToScore(row.rank);
    return {
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      score: textScore,
      textScore,
      snippet: truncateUtf16Safe(row.text, params.snippetMaxChars),
      source: row.source,
    };
  });
}
