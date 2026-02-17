/**
 * Storage API - Plugin-extensible storage abstraction
 *
 * Hides Drizzle ORM completely. Could be replaced with:
 * - Prisma
 * - TypeORM
 * - Knex
 * - Raw SQL drivers
 * - Even a different database (MongoDB, etc.)
 *
 * Plugins never see the underlying implementation.
 */

import type { z } from "zod";

/**
 * Filter operators for queries
 */
export type FilterOperator =
  | "$eq" // Equal
  | "$ne" // Not equal
  | "$gt" // Greater than
  | "$gte" // Greater than or equal
  | "$lt" // Less than
  | "$lte" // Less than or equal
  | "$in" // In array
  | "$nin" // Not in array
  | "$contains" // Array contains (for JSON arrays)
  | "$startsWith" // String starts with
  | "$endsWith" // String ends with
  | "$regex"; // Regex match

/**
 * Filter condition for a single field
 */
export type FilterCondition<T> =
  | T
  | { $eq: T }
  | { $ne: T }
  | { $gt: T }
  | { $gte: T }
  | { $lt: T }
  | { $lte: T }
  | { $in: T[] }
  | { $nin: T[] }
  | (T extends Array<infer U> ? { $contains: U } : never)
  | (T extends string ? { $startsWith: string } | { $endsWith: string } | { $regex: string } : never);

/**
 * Filter for repository queries
 */
export type Filter<T> = {
  [K in string & keyof T]?: FilterCondition<T[K]>;
};

/**
 * Order direction
 */
export type OrderDirection = "asc" | "desc";

/**
 * Query builder interface - chainable, type-safe
 */
export interface QueryBuilder<T> {
  where<K extends keyof T>(field: K, op: FilterOperator, value: unknown): QueryBuilder<T>;
  where<K extends keyof T>(field: K, value: T[K]): QueryBuilder<T>;
  orderBy<K extends keyof T>(field: K, direction?: OrderDirection): QueryBuilder<T>;
  limit(count: number): QueryBuilder<T>;
  offset(count: number): QueryBuilder<T>;
  select<K extends keyof T>(...fields: K[]): QueryBuilder<Pick<T, K>>;
  execute(): Promise<T[]>;
  count(): Promise<number>;
  first(): Promise<T | null>;
}

/**
 * Repository interface - CRUD operations
 *
 * This is the ONLY interface plugins see for storage.
 * No Drizzle types, no SQL, no database-specific concepts.
 */
export interface Repository<T extends Record<string, unknown>> {
  /**
   * Insert a new record
   * If id not provided, one will be generated
   */
  insert(data: Omit<T, "id"> & Partial<Pick<T, "id">>): Promise<T>;

  /**
   * Insert multiple records
   */
  insertMany(data: Array<Omit<T, "id"> & Partial<Pick<T, "id">>>): Promise<T[]>;

  /**
   * Find by primary key
   */
  findById(id: string): Promise<T | null>;

  /**
   * Find first matching record
   */
  findFirst(filter: Filter<T>): Promise<T | null>;

  /**
   * Find all matching records
   */
  findMany(filter?: Filter<T>): Promise<T[]>;

  /**
   * Update a record by ID
   */
  update(id: string, data: Partial<T>): Promise<T>;

  /**
   * Update all matching records
   */
  updateMany(filter: Filter<T>, data: Partial<T>): Promise<number>;

  /**
   * Delete by ID
   */
  delete(id: string): Promise<boolean>;

  /**
   * Delete all matching records
   */
  deleteMany(filter: Filter<T>): Promise<number>;

  /**
   * Count matching records
   */
  count(filter?: Filter<T>): Promise<number>;

  /**
   * Check if record exists
   */
  exists(id: string): Promise<boolean>;

  /**
   * Start a query builder
   */
  query(): QueryBuilder<T>;

  /**
   * Execute raw SQL (plugins are trusted)
   */
  raw(sql: string, params?: unknown[]): Promise<unknown[]>;

  /**
   * Run operation in transaction
   */
  transaction<R>(fn: (repo: Repository<T>) => Promise<R>): Promise<R>;
}

/**
 * Table index definition
 */
export interface TableIndex {
  fields: string[];
  unique?: boolean;
}

/**
 * Table schema definition
 *
 * Plugin defines this with Zod schema.
 * Core generates Drizzle tables from this.
 */
export interface TableSchema {
  /** Zod schema for validation and types */
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  /** Primary key field name */
  primaryKey: string;
  /** Indexes to create */
  indexes?: TableIndex[];
}

/**
 * Plugin schema definition
 *
 * This is what plugins register with ctx.storage.register()
 */
export interface PluginSchema {
  /** Namespace for tables (e.g., 'p2p' → tables: p2p_friends, p2p_requests) */
  namespace: string;
  /** Schema version for migrations */
  version: number;
  /** Table definitions */
  tables: Record<string, TableSchema>;
  /** Optional: Custom migration function */
  migrate?: (fromVersion: number, toVersion: number, storage: StorageApi) => Promise<void>;
}

/**
 * Storage API interface
 *
 * The main interface plugins use to interact with storage.
 * Added to PluginContext as ctx.storage
 */
export interface StorageApi {
  /** Current database driver (for feature detection) */
  readonly driver: "sqlite" | "postgres";

  /**
   * Register a plugin schema
   * Core creates tables if they don't exist
   * Runs migrations if version changed
   */
  register(schema: PluginSchema): Promise<void>;

  /**
   * Get a repository for a table
   * Type parameter T should match the Zod schema type
   */
  getRepository<T extends Record<string, unknown>>(namespace: string, tableName: string): Repository<T>;

  /**
   * Check if a schema is registered
   */
  isRegistered(namespace: string): boolean;

  /**
   * Get current schema version
   */
  getVersion(namespace: string): Promise<number>;

  /**
   * Execute raw SQL across the database
   */
  raw(sql: string, params?: unknown[]): Promise<unknown[]>;

  /**
   * Run cross-table transaction
   */
  transaction<R>(fn: (storage: StorageApi) => Promise<R>): Promise<R>;
}
