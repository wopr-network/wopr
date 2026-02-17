/**
 * Storage implementation - hides Drizzle completely
 *
 * This is the main StorageApi implementation that plugins receive via ctx.storage
 * All Drizzle-specific code is encapsulated here.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { type blob, integer, type real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { logger } from "../logger.js";
import { WOPR_HOME } from "../paths.js";
import type { PluginSchema, Repository, StorageApi, TableSchema } from "./api/plugin-storage.js";
import { DrizzleRepository } from "./repositories/drizzle-repository.js";

/**
 * Registry of loaded repositories
 */
interface RepositoryEntry {
  schema: PluginSchema;
  tables: Map<string, ReturnType<typeof sqliteTable>>;
  repositories: Map<string, Repository<Record<string, unknown>>>;
}

/**
 * Internal table to track plugin schema versions
 */
const schemaVersionsTable = sqliteTable("_plugin_schema_versions", {
  namespace: text("namespace").primaryKey(),
  version: integer("version").notNull(),
  installedAt: integer("installed_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Maps Zod types to SQLite column types
 */
function zodToSqliteColumn(
  name: string,
  zodType: z.ZodTypeAny,
  primaryKey?: string,
): ReturnType<typeof text> | ReturnType<typeof integer> | ReturnType<typeof real> | ReturnType<typeof blob> {
  // Handle optional types
  const innerType = zodType instanceof z.ZodOptional ? zodType.unwrap() : zodType;

  // Check for primary key - use actual primaryKey field name from schema
  const isPrimary = name === primaryKey;

  // Map Zod types to SQLite columns
  if (innerType instanceof z.ZodString) {
    if (isPrimary) {
      return text(name).primaryKey();
    }
    return text(name);
  }

  if (innerType instanceof z.ZodNumber) {
    if (isPrimary) {
      return integer(name).primaryKey();
    }
    return integer(name);
  }

  if (innerType instanceof z.ZodBoolean) {
    return integer(name); // SQLite stores booleans as 0/1
  }

  if (innerType instanceof z.ZodDate) {
    return integer(name); // Store as timestamp
  }

  if (innerType instanceof z.ZodArray || innerType instanceof z.ZodObject) {
    // JSON for arrays and objects
    return text(name);
  }

  if (innerType instanceof z.ZodEnum || innerType instanceof z.ZodUnion) {
    return text(name);
  }

  // Default to text for unknown types
  return text(name);
}

/**
 * Generate Drizzle table from schema definition
 */
function generateTable(namespace: string, tableName: string, tableSchema: TableSchema): ReturnType<typeof sqliteTable> {
  // Create table with full name (namespace_tableName)
  const fullTableName = `${namespace}_${tableName}`;

  // Build columns dynamically
  const columns: Record<
    string,
    ReturnType<typeof text> | ReturnType<typeof integer> | ReturnType<typeof real> | ReturnType<typeof blob>
  > = {};
  for (const [fieldName, zodType] of Object.entries(tableSchema.schema.shape)) {
    columns[fieldName] = zodToSqliteColumn(fieldName, zodType, tableSchema.primaryKey);
  }

  // Create table without indexes first (simpler type)
  return sqliteTable(fullTableName, columns);
}

/**
 * Generate CREATE TABLE SQL from table schema
 */
function generateCreateTableSQL(namespace: string, tableName: string, tableSchema: TableSchema): string {
  const fullTableName = `${namespace}_${tableName}`;
  const primaryKey = tableSchema.primaryKey;
  const columns: string[] = [];

  for (const [fieldName, zodType] of Object.entries(tableSchema.schema.shape)) {
    const innerType = zodType instanceof z.ZodOptional ? zodType.unwrap() : zodType;
    const isPrimary = fieldName === primaryKey;

    let sqlType: string;
    if (innerType instanceof z.ZodString) {
      sqlType = "TEXT";
    } else if (innerType instanceof z.ZodNumber) {
      sqlType = innerType.isInt ? "INTEGER" : "REAL";
    } else if (innerType instanceof z.ZodBoolean) {
      sqlType = "INTEGER";
    } else if (innerType instanceof z.ZodDate) {
      sqlType = "INTEGER";
    } else if (innerType instanceof z.ZodArray || innerType instanceof z.ZodObject) {
      sqlType = "TEXT";
    } else if (innerType instanceof z.ZodEnum || innerType instanceof z.ZodUnion) {
      sqlType = "TEXT";
    } else {
      sqlType = "TEXT";
    }

    let colDef = `"${fieldName}" ${sqlType}`;
    if (isPrimary) {
      colDef += " PRIMARY KEY";
    }
    if (zodType instanceof z.ZodOptional) {
      colDef += " NULL";
    } else {
      colDef += " NOT NULL";
    }
    columns.push(colDef);
  }

  return `CREATE TABLE IF NOT EXISTS "${fullTableName}" (${columns.join(", ")})`;
}

/**
 * Storage implementation
 */
export class Storage implements StorageApi {
  readonly driver: "sqlite" | "postgres" = "sqlite";
  readonly dbPath: string;
  private db: BetterSQLite3Database;
  private sqliteRaw: DatabaseType;
  private repositories = new Map<string, RepositoryEntry>();

  getDb(): BetterSQLite3Database {
    return this.db;
  }

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? join(WOPR_HOME, "wopr.sqlite");

    // Ensure directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Initialize SQLite connection - store both raw and Drizzle-wrapped
    this.sqliteRaw = new Database(this.dbPath);

    // SQLite pragmas for production hardening
    this.sqliteRaw.pragma("journal_mode = WAL");
    this.sqliteRaw.pragma("busy_timeout = 5000");
    this.sqliteRaw.pragma("foreign_keys = ON");
    this.sqliteRaw.pragma("synchronous = NORMAL");

    this.db = drizzle(this.sqliteRaw);

    // Initialize schema versions table
    this.initSchemaVersions();

    logger.info(`[storage] Initialized SQLite at ${this.dbPath}`);
  }

  /**
   * Initialize schema versions tracking table
   */
  private initSchemaVersions(): void {
    // Use the raw SQLite handle for schema initialization
    this.sqliteRaw.exec(`
      CREATE TABLE IF NOT EXISTS _plugin_schema_versions (
        namespace TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * Get current schema version for a namespace
   */
  private async getCurrentVersion(namespace: string): Promise<number> {
    const result = await this.db
      .select({ version: schemaVersionsTable.version })
      .from(schemaVersionsTable)
      .where(eq(schemaVersionsTable.namespace, namespace))
      .limit(1);

    return result[0]?.version ?? 0;
  }

  /**
   * Update schema version
   */
  private async updateVersion(namespace: string, version: number): Promise<void> {
    const now = Date.now();
    const existing = await this.getCurrentVersion(namespace);

    if (existing === 0) {
      // Insert new
      await this.db.insert(schemaVersionsTable).values({
        namespace,
        version,
        installedAt: now,
        updatedAt: now,
      });
    } else {
      // Update existing
      await this.db
        .update(schemaVersionsTable)
        .set({ version, updatedAt: now })
        .where(eq(schemaVersionsTable.namespace, namespace));
    }
  }

  async register(schema: PluginSchema): Promise<void> {
    const { namespace, version } = schema;

    // Check current version
    const currentVersion = await this.getCurrentVersion(namespace);

    if (currentVersion === version) {
      // Already up to date, just ensure repositories exist
      if (!this.repositories.has(namespace)) {
        await this.createRepositories(schema);
      }
      return;
    }

    if (currentVersion > version) {
      logger.warn(`[storage] Schema version regression detected for ${namespace}: ${currentVersion} → ${version}`);
      // Continue anyway - might be intentional rollback
    }

    logger.info(`[storage] Registering schema for ${namespace} v${version} (was v${currentVersion})`);

    // Run custom migration if provided and version changed
    if (schema.migrate && currentVersion > 0) {
      await schema.migrate(currentVersion, version, this);
    }

    // Generate and create tables
    await this.createRepositories(schema);

    // Update version
    await this.updateVersion(namespace, version);

    logger.info(`[storage] Schema registered for ${namespace} v${version}`);
  }

  /**
   * Create Drizzle tables and repositories for a schema
   */
  private async createRepositories(schema: PluginSchema): Promise<void> {
    const tables = new Map<string, ReturnType<typeof sqliteTable>>();
    const repositories = new Map<string, Repository<Record<string, unknown>>>();

    for (const [tableName, tableSchema] of Object.entries(schema.tables)) {
      // Generate Drizzle table
      const table = generateTable(schema.namespace, tableName, tableSchema);
      tables.set(tableName, table);

      // Explicitly create the table in SQLite
      const createTableSQL = generateCreateTableSQL(schema.namespace, tableName, tableSchema);
      this.sqliteRaw.exec(createTableSQL);

      // Create indexes if defined
      if (tableSchema.indexes) {
        const fullTableName = `${schema.namespace}_${tableName}`;
        for (let i = 0; i < tableSchema.indexes.length; i++) {
          const idx = tableSchema.indexes[i];
          const unique = idx.unique ? "UNIQUE " : "";
          const indexName = `idx_${fullTableName}_${idx.fields.join("_")}`;
          const columns = idx.fields.map((f) => `"${f}"`).join(", ");
          this.sqliteRaw.exec(`CREATE ${unique}INDEX IF NOT EXISTS "${indexName}" ON "${fullTableName}" (${columns})`);
        }
      }

      // Create repository
      const repo = new DrizzleRepository(this.db, table, tableSchema.primaryKey, tableSchema.schema, this.sqliteRaw);
      repositories.set(tableName, repo);
    }

    this.repositories.set(schema.namespace, {
      schema,
      tables,
      repositories,
    });
  }

  getRepository<T extends Record<string, unknown>>(namespace: string, tableName: string): Repository<T> {
    const entry = this.repositories.get(namespace);
    if (!entry) {
      throw new Error(`Schema not registered: ${namespace}. Call storage.register() first.`);
    }

    const repo = entry.repositories.get(tableName);
    if (!repo) {
      throw new Error(`Table not found: ${namespace}.${tableName}`);
    }

    return repo as Repository<T>;
  }

  isRegistered(namespace: string): boolean {
    return this.repositories.has(namespace);
  }

  async getVersion(namespace: string): Promise<number> {
    return this.getCurrentVersion(namespace);
  }

  async raw(sql: string, params?: unknown[]): Promise<unknown[]> {
    // Use the raw better-sqlite3 database for raw queries
    const stmt = this.sqliteRaw.prepare(sql);
    const result = params ? stmt.all(...params) : stmt.all();
    return Array.isArray(result) ? result : [result];
  }

  async transaction<R>(fn: (storage: StorageApi) => Promise<R>): Promise<R> {
    // Use manual BEGIN/COMMIT/ROLLBACK to support async callbacks.
    // better-sqlite3's .transaction() wrapper is synchronous and cannot
    // handle async callbacks (await yields to microtask queue, causing
    // the transaction to commit prematurely).
    const trxStorage = new TransactionStorage(this.sqliteRaw, this);
    this.sqliteRaw.exec("BEGIN");
    try {
      const result = await fn(trxStorage);
      this.sqliteRaw.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqliteRaw.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.sqliteRaw.close();
  }
}

/**
 * Transaction-aware storage wrapper
 */
class TransactionStorage implements StorageApi {
  readonly driver: "sqlite" | "postgres" = "sqlite";

  constructor(
    private sqliteRaw: DatabaseType,
    private parent: Storage,
  ) {}

  async register(_schema: PluginSchema): Promise<void> {
    throw new Error("Cannot register schemas inside a transaction");
  }

  getRepository<T extends Record<string, unknown>>(namespace: string, tableName: string): Repository<T> {
    // Get the table info from parent
    const entry = (this.parent as unknown as { repositories: Map<string, RepositoryEntry> }).repositories.get(
      namespace,
    );
    if (!entry) {
      throw new Error(`Schema not registered: ${namespace}`);
    }

    const table = entry.tables.get(tableName);
    if (!table) {
      throw new Error(`Table not found: ${namespace}.${tableName}`);
    }

    const tableSchema = entry.schema.tables[tableName];

    return new DrizzleRepository(
      this.parent.getDb(),
      table,
      tableSchema.primaryKey,
      tableSchema.schema,
      this.sqliteRaw,
    ) as Repository<T>;
  }

  isRegistered(namespace: string): boolean {
    return this.parent.isRegistered(namespace);
  }

  async getVersion(namespace: string): Promise<number> {
    return this.parent.getVersion(namespace);
  }

  async raw(sqlStr: string, params?: unknown[]): Promise<unknown[]> {
    const stmt = this.sqliteRaw.prepare(sqlStr);
    const result = params ? stmt.all(...params) : stmt.all();
    return Array.isArray(result) ? result : [result];
  }

  async transaction<R>(_fn: (storage: StorageApi) => Promise<R>): Promise<R> {
    throw new Error("Nested transactions not supported");
  }
}

// Singleton instance
let storageInstance: Storage | null = null;

/**
 * Get or create the storage singleton
 */
export function getStorage(dbPath?: string): Storage {
  if (!storageInstance) {
    storageInstance = new Storage(dbPath);
  } else if (dbPath && storageInstance.dbPath !== dbPath) {
    logger.warn(
      `[storage] Storage singleton already initialized with path ${storageInstance.dbPath}. Ignoring request for ${dbPath}. Call resetStorage() first.`,
    );
  }
  return storageInstance;
}

/**
 * Reset storage (for testing)
 */
export function resetStorage(): void {
  if (storageInstance) {
    try {
      storageInstance.close();
    } catch {
      // DB may already be closed
    }
  }
  storageInstance = null;
}
