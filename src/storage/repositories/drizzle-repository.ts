/**
 * Drizzle ORM implementation of Repository interface
 *
 * This is the ONLY file in the codebase that imports Drizzle.
 * All other code uses the abstract Repository interface.
 *
 * Currently supports SQLite only (via better-sqlite3).
 * Note: better-sqlite3 uses synchronous API, so we wrap calls in async functions.
 */

import { and, asc, desc, eq, gt, gte, inArray, like, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import type { Filter, FilterOperator, OrderDirection, QueryBuilder, Repository } from "../api/plugin-storage.js";

// Type for Drizzle database - SQLite only for now
type DrizzleDB = BetterSQLite3Database;

/**
 * Implementation of QueryBuilder using Drizzle
 */
class QueryBuilderImpl<T> implements QueryBuilder<T> {
  private conditions: ReturnType<typeof sql>[] = [];
  private orderByFields: { column: string; direction: OrderDirection }[] = [];
  private limitValue?: number;
  private offsetValue?: number;

  constructor(
    private db: DrizzleDB,
    private table: SQLiteTable,
    private columns: Record<string, SQLiteColumn>,
    private jsonColumns: Set<string> = new Set(),
    private booleanColumns: Set<string> = new Set(),
  ) {}

  where<K extends keyof T>(field: K, opOrValue: FilterOperator | T[K], value?: unknown): QueryBuilder<T> {
    const column = this.columns[field as string];
    if (!column) throw new Error(`Unknown column: ${String(field)}`);

    if (value === undefined) {
      // Direct value - treat as $eq
      this.conditions.push(eq(column, opOrValue));
    } else {
      // Operator + value
      const op = opOrValue as FilterOperator;
      switch (op) {
        case "$eq":
          this.conditions.push(eq(column, value));
          break;
        case "$ne":
          this.conditions.push(ne(column, value));
          break;
        case "$gt":
          this.conditions.push(gt(column, value));
          break;
        case "$gte":
          this.conditions.push(gte(column, value));
          break;
        case "$lt":
          this.conditions.push(lt(column, value));
          break;
        case "$lte":
          this.conditions.push(lte(column, value));
          break;
        case "$in":
          this.conditions.push(inArray(column, value as unknown[]));
          break;
        case "$nin":
          this.conditions.push(notInArray(column, value as unknown[]));
          break;
        case "$contains":
          // SQLite specific: Only works for JSON arrays of strings
          // Parameterized via SQL concatenation to prevent injection
          this.conditions.push(sql`${column} LIKE '%"' || ${String(value)} || '"%'`);
          break;
        case "$startsWith":
          this.conditions.push(like(column, `${value}%`));
          break;
        case "$endsWith":
          this.conditions.push(like(column, `%${value}`));
          break;
        case "$regex":
          // SQLite doesn't support regex natively, falls back to LIKE substring match
          // This is NOT a true regex - users expecting regex will be surprised
          this.conditions.push(like(column, `%${value}%`));
          break;
        default:
          throw new Error(`Unknown operator: ${op}`);
      }
    }
    return this;
  }

  orderBy<K extends keyof T>(field: K, direction: OrderDirection = "asc"): QueryBuilder<T> {
    this.orderByFields.push({ column: field as string, direction });
    return this;
  }

  limit(count: number): QueryBuilder<T> {
    this.limitValue = count;
    return this;
  }

  offset(count: number): QueryBuilder<T> {
    this.offsetValue = count;
    return this;
  }

  private selectedFields: string[] | null = null;

  select<K extends keyof T>(...fields: K[]): QueryBuilder<Pick<T, K>> {
    this.selectedFields = fields.map((f) => String(f));
    return this as unknown as QueryBuilder<Pick<T, K>>;
  }

  async execute(): Promise<T[]> {
    // Build query with optional SQL-level field projection
    let query = this.db.select().from(this.table);
    if (this.selectedFields !== null) {
      const sel: Record<string, SQLiteColumn> = {};
      for (const f of this.selectedFields) {
        if (this.columns[f]) sel[f] = this.columns[f];
      }
      query = this.db.select(sel).from(this.table) as unknown as typeof query;
    }

    if (this.conditions.length > 0) {
      query = query.where(and(...this.conditions)) as typeof query;
    }

    if (this.orderByFields.length > 0) {
      for (const { column, direction } of this.orderByFields) {
        const col = this.columns[column];
        if (col) {
          query = query.orderBy(direction === "asc" ? asc(col) : desc(col)) as typeof query;
        }
      }
    }

    if (this.limitValue !== undefined) {
      query = query.limit(this.limitValue) as typeof query;
    } else if (this.offsetValue !== undefined) {
      // SQLite requires LIMIT when using OFFSET; -1 means no limit
      query = query.limit(-1) as typeof query;
    }

    if (this.offsetValue !== undefined) {
      query = query.offset(this.offsetValue) as typeof query;
    }

    // Execute synchronously, wrap in Promise for async interface
    const rows = query.all() as T[];

    // Deserialize JSON columns and boolean columns
    if (this.jsonColumns.size === 0 && this.booleanColumns.size === 0) return Promise.resolve(rows);
    return Promise.resolve(
      rows.map((row) => {
        const r = { ...(row as Record<string, unknown>) };
        for (const col of this.jsonColumns) {
          if (col in r && typeof r[col] === "string") {
            try {
              r[col] = JSON.parse(r[col] as string);
            } catch {
              /* leave as-is */
            }
          }
        }
        for (const col of this.booleanColumns) {
          if (col in r && typeof r[col] === "number") {
            r[col] = r[col] !== 0;
          }
        }
        return r as T;
      }),
    );
  }

  async count(): Promise<number> {
    let query = this.db.select({ count: sql<number>`count(*)` }).from(this.table);

    if (this.conditions.length > 0) {
      query = query.where(and(...this.conditions)) as typeof query;
    }

    const result = query.all();
    return Promise.resolve(result[0]?.count ?? 0);
  }

  async first(): Promise<T | null> {
    this.limit(1);
    const results = await this.execute();
    return results[0] ?? null;
  }
}

/**
 * Drizzle implementation of Repository interface
 */
export class DrizzleRepository<T extends Record<string, unknown>, PK extends keyof T = "id", PKType = T[PK]>
  implements Repository<T, PK, PKType>
{
  private columns: Record<string, SQLiteColumn>;
  private jsonColumns: Set<string>;
  private booleanColumns: Set<string>;

  constructor(
    private db: DrizzleDB,
    private table: SQLiteTable,
    private primaryKey: PK,
    private zodSchema: z.ZodObject<Record<string, z.ZodTypeAny>>,
    private sqliteRaw?: unknown,
  ) {
    // Extract columns from table definition
    const tableInternal = table as unknown as { _: { columns: Record<string, SQLiteColumn> } };
    if (!tableInternal._) {
      // Fallback: table might have columns at a different path
      // Try to extract columns directly from table definition keys
      const tableAny = table as unknown as Record<string, unknown>;
      this.columns = {};
      for (const key of Object.keys(zodSchema.shape)) {
        if (tableAny[key]) {
          this.columns[key] = tableAny[key] as SQLiteColumn;
        }
      }
      if (Object.keys(this.columns).length === 0) {
        throw new Error(`Invalid table structure: cannot extract columns`);
      }
    } else if (!tableInternal._.columns) {
      throw new Error(`Invalid table structure: _.columns is undefined`);
    } else {
      this.columns = tableInternal._.columns;
    }

    // Identify columns that store JSON (arrays/objects stored as TEXT)
    this.jsonColumns = new Set<string>();
    // Identify boolean columns (stored as INTEGER 0/1 in SQLite)
    this.booleanColumns = new Set<string>();
    for (const [fieldName, zodType] of Object.entries(zodSchema.shape)) {
      const inner = zodType instanceof z.ZodOptional ? zodType.unwrap() : zodType;
      if (inner instanceof z.ZodArray || inner instanceof z.ZodObject) {
        this.jsonColumns.add(fieldName);
      }
      if (inner instanceof z.ZodBoolean) {
        this.booleanColumns.add(fieldName);
      }
    }
  }

  /** Serialize values for SQLite: coerce booleans to 0/1, JSON columns to strings */
  private serializeJson(data: Record<string, unknown>): Record<string, unknown> {
    const result = { ...data };
    // SQLite cannot bind booleans — coerce to 0/1
    for (const key of Object.keys(result)) {
      if (typeof result[key] === "boolean") {
        result[key] = result[key] ? 1 : 0;
      }
    }
    if (this.jsonColumns.size === 0) return result;
    for (const col of this.jsonColumns) {
      if (col in result && result[col] !== null && result[col] !== undefined) {
        if (typeof result[col] !== "string") {
          result[col] = JSON.stringify(result[col]);
        }
      }
    }
    return result;
  }

  /** Deserialize values from SQLite: JSON strings to objects, integers to booleans */
  private deserializeJson<R>(row: R): R {
    if (this.jsonColumns.size === 0 && this.booleanColumns.size === 0) return row;
    const result = { ...(row as Record<string, unknown>) };
    for (const col of this.jsonColumns) {
      if (col in result && typeof result[col] === "string") {
        try {
          result[col] = JSON.parse(result[col] as string);
        } catch {
          // Leave as string if not valid JSON
        }
      }
    }
    // Coerce SQLite INTEGER 0/1 back to boolean
    for (const col of this.booleanColumns) {
      if (col in result && typeof result[col] === "number") {
        result[col] = result[col] !== 0;
      }
    }
    return result as R;
  }

  async insert(data: Omit<T, PK> & Partial<Pick<T, PK>>): Promise<T> {
    // Validate with Zod
    const validated = this.zodSchema.parse(data) as T;
    const serialized = this.serializeJson(validated as Record<string, unknown>);

    // better-sqlite3 uses synchronous API
    const stmt = this.db.insert(this.table).values(serialized);
    const result = stmt.returning().all();
    return Promise.resolve(this.deserializeJson(result[0] as T));
  }

  async insertMany(data: Array<Omit<T, PK> & Partial<Pick<T, PK>>>): Promise<T[]> {
    // Validate all
    const validated = data.map((d) => this.zodSchema.parse(d)) as T[];
    const serialized = validated.map((v) => this.serializeJson(v as Record<string, unknown>));

    const stmt = this.db.insert(this.table).values(serialized);
    const result = stmt.returning().all();
    return Promise.resolve((result as T[]).map((r) => this.deserializeJson(r)));
  }

  async findById(id: PKType): Promise<T | null> {
    const pkColumn = this.columns[this.primaryKey as string];
    if (!pkColumn) throw new Error(`Primary key column not found: ${String(this.primaryKey)}`);

    const result = this.db.select().from(this.table).where(eq(pkColumn, id)).limit(1).all();

    return Promise.resolve(result[0] ? this.deserializeJson(result[0] as T) : null);
  }

  async findFirst(filter: Filter<T>): Promise<T | null> {
    const conditions = this.buildFilterConditions(filter);
    let query = this.db.select().from(this.table);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const result = query.limit(1).all();
    return Promise.resolve(result[0] ? this.deserializeJson(result[0] as T) : null);
  }

  async findMany(filter?: Filter<T>): Promise<T[]> {
    let query = this.db.select().from(this.table);

    if (filter) {
      const conditions = this.buildFilterConditions(filter);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }
    }

    return Promise.resolve((query.all() as T[]).map((r) => this.deserializeJson(r)));
  }

  async update(id: PKType, data: Partial<T>): Promise<T> {
    const pkColumn = this.columns[this.primaryKey as string];
    if (!pkColumn) throw new Error(`Primary key column not found: ${String(this.primaryKey)}`);

    // Partial validation - only validate provided fields
    const partialSchema = this.zodSchema.partial();
    const validated = partialSchema.parse(data);
    const serialized = this.serializeJson(validated as Record<string, unknown>);

    const result = this.db.update(this.table).set(serialized).where(eq(pkColumn, id)).returning().all();

    if (result.length === 0) {
      throw new Error(`Record not found: ${id}`);
    }

    return Promise.resolve(this.deserializeJson(result[0] as T));
  }

  async updateMany(filter: Filter<T>, data: Partial<T>): Promise<number> {
    const conditions = this.buildFilterConditions(filter);

    // Partial validation
    const partialSchema = this.zodSchema.partial();
    const validated = partialSchema.parse(data);
    const serialized = this.serializeJson(validated as Record<string, unknown>);

    const result = this.db
      .update(this.table)
      .set(serialized)
      .where(and(...conditions))
      .run();

    // better-sqlite3 RunResult has changes property
    return Promise.resolve(result.changes ?? 0);
  }

  async delete(id: PKType): Promise<boolean> {
    const pkColumn = this.columns[this.primaryKey as string];
    if (!pkColumn) throw new Error(`Primary key column not found: ${String(this.primaryKey)}`);

    const result = this.db.delete(this.table).where(eq(pkColumn, id)).run();
    return Promise.resolve(result.changes > 0);
  }

  async deleteMany(filter: Filter<T>): Promise<number> {
    const conditions = this.buildFilterConditions(filter);
    const result = this.db
      .delete(this.table)
      .where(and(...conditions))
      .run();
    return Promise.resolve(result.changes ?? 0);
  }

  async count(filter?: Filter<T>): Promise<number> {
    let query = this.db.select({ count: sql<number>`count(*)` }).from(this.table);

    if (filter) {
      const conditions = this.buildFilterConditions(filter);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }
    }

    const result = query.all();
    return Promise.resolve(result[0]?.count ?? 0);
  }

  async exists(id: PKType): Promise<boolean> {
    const count = await this.count({ [this.primaryKey]: id } as Filter<T>);
    return count > 0;
  }

  query(): QueryBuilder<T> {
    return new QueryBuilderImpl(this.db, this.table, this.columns, this.jsonColumns, this.booleanColumns);
  }

  async raw(sqlStr: string, params?: unknown[]): Promise<unknown[]> {
    // Use raw better-sqlite3 if provided
    if (!this.sqliteRaw) {
      throw new Error("Raw SQL requires sqliteRaw to be provided to the repository");
    }

    const db = this.sqliteRaw as {
      prepare: (sql: string) => {
        all: (...params: unknown[]) => unknown[];
        run: (...params: unknown[]) => { changes: number };
      };
    };

    // Check if it's a row-returning query or modification query
    const trimmed = sqlStr.trim().toUpperCase();
    const isSelect = trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("EXPLAIN");

    if (isSelect) {
      const stmt = db.prepare(sqlStr);
      const result = stmt.all(...(params ?? []));
      return Array.isArray(result) ? result : [result];
    } else {
      const stmt = db.prepare(sqlStr);
      const result = stmt.run(...(params ?? []));
      return [{ changes: result.changes }];
    }
  }

  async transaction<R>(fn: (repo: Repository<T>) => Promise<R>): Promise<R> {
    if (!this.sqliteRaw) {
      return fn(this as unknown as Repository<T>);
    }
    const raw = this.sqliteRaw as { exec: (sql: string) => void };
    raw.exec("BEGIN");
    try {
      const result = await fn(this as unknown as Repository<T>);
      raw.exec("COMMIT");
      return result;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Build Drizzle conditions from filter object
   */
  private buildFilterConditions(filter: Filter<T>): ReturnType<typeof sql>[] {
    const conditions: ReturnType<typeof sql>[] = [];

    for (const [field, condition] of Object.entries(filter)) {
      const column = this.columns[field];
      if (!column) continue;

      if (condition === null || condition === undefined) {
        continue;
      }

      // Check if it's a condition object or direct value
      if (typeof condition === "object" && !Array.isArray(condition) && condition !== null) {
        // It's a condition object like { $eq: value }
        const entries = Object.entries(condition);
        if (entries.length === 1) {
          const [op, value] = entries[0];
          switch (op) {
            case "$eq":
              conditions.push(eq(column, value));
              break;
            case "$ne":
              conditions.push(ne(column, value));
              break;
            case "$gt":
              conditions.push(gt(column, value));
              break;
            case "$gte":
              conditions.push(gte(column, value));
              break;
            case "$lt":
              conditions.push(lt(column, value));
              break;
            case "$lte":
              conditions.push(lte(column, value));
              break;
            case "$in":
              conditions.push(inArray(column, value as unknown[]));
              break;
            case "$nin":
              conditions.push(notInArray(column, value as unknown[]));
              break;
            case "$contains":
              conditions.push(sql`${column} LIKE ${`%"${value}"%`}`);
              break;
            case "$startsWith":
              conditions.push(like(column, `${value}%`));
              break;
            case "$endsWith":
              conditions.push(like(column, `%${value}`));
              break;
            case "$regex":
              conditions.push(like(column, `%${value}%`));
              break;
          }
        }
      } else {
        // Direct value - treat as $eq
        conditions.push(eq(column, condition));
      }
    }

    return conditions;
  }
}
