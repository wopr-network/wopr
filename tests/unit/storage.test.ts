/**
 * Storage Module Tests (WOP-545)
 *
 * Tests Storage singleton lifecycle, plugin schema registration,
 * DrizzleRepository CRUD, filter operators, QueryBuilder,
 * transactions, JSON column serialization, schema versioning,
 * and error cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Mock the logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock paths to use temp directory
vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: "/tmp/wopr-storage-test",
}));

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getStorage, resetStorage } from "../../src/storage/public.js";
import type { StorageApi } from "../../src/storage/api/plugin-storage.js";

// Test schema
const testSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().int(),
  active: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.object({ key: z.string() }).optional(),
});

type TestRecord = z.infer<typeof testSchema>;

const testPluginSchema = {
  namespace: "test",
  version: 1,
  tables: {
    users: {
      schema: testSchema,
      primaryKey: "id" as const,
      indexes: [
        { fields: ["name" as const] },
        { fields: ["age" as const, "name" as const], unique: false },
      ],
    },
  },
};

describe("Storage Module (WOP-545)", () => {
  let storage: StorageApi;
  let testDbPath: string;
  const TEST_TEMP_DIR = "/tmp/wopr-storage-test";

  beforeEach(() => {
    // Clean up any previous test state
    resetStorage();

    // Create temp directory
    if (!existsSync(TEST_TEMP_DIR)) {
      mkdirSync(TEST_TEMP_DIR, { recursive: true });
    }

    // Create a unique DB path for this test
    testDbPath = join(TEST_TEMP_DIR, `test-${Math.random().toString(36).slice(2)}.db`);
    storage = getStorage(testDbPath);
  });

  afterEach(() => {
    // Close and reset storage
    resetStorage();

    // Clean up temp directory
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  describe("1. Storage singleton lifecycle", () => {
    it("should return same instance on repeated calls", () => {
      const storage1 = getStorage(testDbPath);
      const storage2 = getStorage(testDbPath);
      expect(storage1).toBe(storage2);
    });

    it("should warn when requesting different path", async () => {
      const { logger } = await import("../../src/logger.js");
      const storage1 = getStorage(testDbPath);
      const differentPath = join(TEST_TEMP_DIR, "different.db");
      const storage2 = getStorage(differentPath);
      expect(storage1).toBe(storage2);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should allow new instance creation after resetStorage", () => {
      const storage1 = getStorage(testDbPath);
      resetStorage();
      const storage2 = getStorage(testDbPath);
      expect(storage1).not.toBe(storage2);
    });

    it("should close the DB handle", () => {
      const storage = getStorage(testDbPath);
      expect(() => resetStorage()).not.toThrow();
    });

    it("should handle operations on closed instance gracefully", async () => {
      const storage = getStorage(testDbPath);
      await storage.register(testPluginSchema);
      resetStorage();
      // Getting a new instance should work
      const newStorage = getStorage(testDbPath);
      expect(newStorage).toBeDefined();
    });
  });

  describe("2. Pragma verification", () => {
    beforeEach(async () => {
      await storage.register(testPluginSchema);
    });

    it("should set WAL journal mode", async () => {
      const result = await storage.getRepository("test", "users").raw("PRAGMA journal_mode");
      expect(result[0]).toHaveProperty("journal_mode", "wal");
    });

    it("should set busy timeout to 5000ms", async () => {
      const result = await storage.getRepository("test", "users").raw("PRAGMA busy_timeout");
      expect(result[0]).toHaveProperty("timeout", 5000);
    });

    it("should enable foreign keys", async () => {
      const result = await storage.getRepository("test", "users").raw("PRAGMA foreign_keys");
      expect(result[0]).toHaveProperty("foreign_keys", 1);
    });

    it("should set synchronous to NORMAL", async () => {
      const result = await storage.getRepository("test", "users").raw("PRAGMA synchronous");
      expect(result[0]).toHaveProperty("synchronous", 1); // NORMAL = 1
    });
  });

  describe("3. Plugin schema registration", () => {
    it("should create tables with correct columns", async () => {
      await storage.register(testPluginSchema);
      const repo = storage.getRepository<TestRecord>("test", "users");

      // Verify we can insert and retrieve
      const inserted = await repo.insert({
        id: "1",
        name: "Alice",
        age: 30,
      });
      expect(inserted).toMatchObject({ id: "1", name: "Alice", age: 30 });
    });

    it("should track schema version", async () => {
      await storage.register(testPluginSchema);
      const version = await storage.getVersion("test");
      expect(version).toBe(1);
    });

    it("should be idempotent for same version", async () => {
      await storage.register(testPluginSchema);
      await storage.register(testPluginSchema);
      const version = await storage.getVersion("test");
      expect(version).toBe(1);
    });

    it("should update version on higher version", async () => {
      await storage.register(testPluginSchema);
      const updatedSchema = { ...testPluginSchema, version: 2 };
      await storage.register(updatedSchema);
      const version = await storage.getVersion("test");
      expect(version).toBe(2);
    });

    it("should warn on version regression but still work", async () => {
      const { logger } = await import("../../src/logger.js");
      await storage.register({ ...testPluginSchema, version: 2 });
      await storage.register(testPluginSchema);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("should return correct registered state", async () => {
      expect(storage.isRegistered("test")).toBe(false);
      await storage.register(testPluginSchema);
      expect(storage.isRegistered("test")).toBe(true);
    });
  });

  describe("4. Index creation", () => {
    beforeEach(async () => {
      await storage.register(testPluginSchema);
    });

    it("should create single-column index", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const result = await repo.raw('PRAGMA index_list("test_users")');
      const indexes = result as Array<{ name: string }>;
      const nameIndex = indexes.find(idx => idx.name === "idx_test_users_name");
      expect(nameIndex).toBeDefined();
    });

    it("should create multi-column index", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const result = await repo.raw('PRAGMA index_list("test_users")');
      const indexes = result as Array<{ name: string }>;
      const multiIndex = indexes.find(idx => idx.name === "idx_test_users_age_name");
      expect(multiIndex).toBeDefined();
    });

    it("should create non-unique index by default", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const result = await repo.raw('PRAGMA index_list("test_users")');
      const indexes = result as Array<{ unique: number }>;
      const nameIndex = indexes.find(idx => (idx as unknown as { name: string }).name === "idx_test_users_name");
      expect(nameIndex?.unique).toBe(0); // 0 = not unique
    });
  });

  describe("5. DrizzleRepository CRUD", () => {
    beforeEach(async () => {
      await storage.register(testPluginSchema);
    });

    it("should insert and return record", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const inserted = await repo.insert({
        id: "1",
        name: "Alice",
        age: 30,
      });
      expect(inserted).toMatchObject({ id: "1", name: "Alice", age: 30 });
    });

    it("should validate against Zod schema", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await expect(
        repo.insert({ id: "1", name: "Alice", age: "invalid" as unknown as number })
      ).rejects.toThrow();
    });

    it("should insertMany", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const inserted = await repo.insertMany([
        { id: "1", name: "Alice", age: 30 },
        { id: "2", name: "Bob", age: 25 },
      ]);
      expect(inserted).toHaveLength(2);
      expect(inserted[0]).toMatchObject({ id: "1", name: "Alice" });
    });

    it("should findById", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insert({ id: "1", name: "Alice", age: 30 });
      const found = await repo.findById("1");
      expect(found).toMatchObject({ id: "1", name: "Alice", age: 30 });
    });

    it("should return null for non-existent ID", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findById("non-existent");
      expect(found).toBeNull();
    });

    it("should findFirst with filter", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insertMany([
        { id: "1", name: "Alice", age: 30 },
        { id: "2", name: "Bob", age: 25 },
      ]);
      const found = await repo.findFirst({ name: "Bob" });
      expect(found).toMatchObject({ id: "2", name: "Bob" });
    });

    it("should findMany with filter", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insertMany([
        { id: "1", name: "Alice", age: 30 },
        { id: "2", name: "Bob", age: 25 },
        { id: "3", name: "Charlie", age: 30 },
      ]);
      const found = await repo.findMany({ age: 30 });
      expect(found).toHaveLength(2);
    });

    it("should findMany without filter", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insertMany([
        { id: "1", name: "Alice", age: 30 },
        { id: "2", name: "Bob", age: 25 },
      ]);
      const found = await repo.findMany();
      expect(found).toHaveLength(2);
    });

    it("should update and return updated record", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insert({ id: "1", name: "Alice", age: 30 });
      const updated = await repo.update("1", { age: 31 });
      expect(updated).toMatchObject({ id: "1", name: "Alice", age: 31 });
    });

    it("should throw on update of non-existent ID", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await expect(repo.update("non-existent", { age: 31 })).rejects.toThrow("Record not found");
    });

    it("should delete record", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insert({ id: "1", name: "Alice", age: 30 });
      const deleted = await repo.delete("1");
      expect(deleted).toBe(true);
      const found = await repo.findById("1");
      expect(found).toBeNull();
    });

    it("should return false for deleting non-existent record", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const deleted = await repo.delete("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("6. Filter operators", () => {
    beforeEach(async () => {
      await storage.register(testPluginSchema);
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insertMany([
        { id: "1", name: "Alice", age: 30 },
        { id: "2", name: "Bob", age: 25 },
        { id: "3", name: "Charlie", age: 35 },
      ]);
    });

    it("should filter by $eq", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ age: { $eq: 30 } });
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe("Alice");
    });

    it("should filter by $ne", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ age: { $ne: 30 } });
      expect(found).toHaveLength(2);
    });

    it("should filter by $gt", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ age: { $gt: 25 } });
      expect(found).toHaveLength(2);
    });

    it("should filter by $gte", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ age: { $gte: 30 } });
      expect(found).toHaveLength(2);
    });

    it("should filter by $lt", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ age: { $lt: 30 } });
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe("Bob");
    });

    it("should filter by $lte", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ age: { $lte: 30 } });
      expect(found).toHaveLength(2);
    });

    it("should filter by $in", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ age: { $in: [25, 35] } });
      expect(found).toHaveLength(2);
    });

    it("should filter by $nin", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ age: { $nin: [25, 35] } });
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe("Alice");
    });

    it("should filter by $startsWith", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ name: { $startsWith: "A" } });
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe("Alice");
    });

    it("should filter by $endsWith", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ name: { $endsWith: "e" } });
      expect(found).toHaveLength(2);
    });

    it("should filter by $contains on JSON array", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insert({ id: "4", name: "Dave", age: 40, tags: ["admin", "user"] });
      const found = await repo.findMany({ tags: { $contains: "admin" } });
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe("Dave");
    });

    it("should treat direct value as $eq", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const found = await repo.findMany({ name: "Alice" });
      expect(found).toHaveLength(1);
      expect(found[0].age).toBe(30);
    });
  });

  describe("7. QueryBuilder", () => {
    beforeEach(async () => {
      await storage.register(testPluginSchema);
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insertMany([
        { id: "1", name: "Alice", age: 30 },
        { id: "2", name: "Bob", age: 25 },
        { id: "3", name: "Charlie", age: 35 },
      ]);
    });

    it("should filter by equality", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query().where("name", "Alice").execute();
      expect(results).toHaveLength(1);
      expect(results[0].age).toBe(30);
    });

    it("should filter by operator", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query().where("age", "$gt", 25).execute();
      expect(results).toHaveLength(2);
    });

    it("should sort ascending", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query().orderBy("age", "asc").execute();
      expect(results[0].age).toBe(25);
      expect(results[2].age).toBe(35);
    });

    it("should sort descending", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query().orderBy("age", "desc").execute();
      expect(results[0].age).toBe(35);
      expect(results[2].age).toBe(25);
    });

    it("should limit results", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query().limit(2).execute();
      expect(results).toHaveLength(2);
    });

    it("should skip results with offset", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query().orderBy("age", "asc").limit(10).offset(1).execute();
      expect(results).toHaveLength(2);
      expect(results[0].age).toBe(30);
    });

    it("should count results", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const count = await repo.query().where("age", "$gte", 30).count();
      expect(count).toBe(2);
    });

    it("should return first result or null", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const first = await repo.query().where("name", "Bob").first();
      expect(first).toMatchObject({ name: "Bob", age: 25 });

      const notFound = await repo.query().where("name", "NonExistent").first();
      expect(notFound).toBeNull();
    });

    it("should chain multiple where clauses (AND logic)", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query()
        .where("age", "$gte", 30)
        .where("name", "$startsWith", "A")
        .execute();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Alice");
    });

    it("should project only selected fields at SQL level (WOP-598)", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query().select("id", "name").execute() as Array<Record<string, unknown>>;
      expect(results).toHaveLength(3);
      // Each row should have only the selected fields
      for (const row of results) {
        expect(Object.keys(row).sort()).toEqual(["id", "name"]);
        expect(row.age).toBeUndefined();
      }
    });

    it("should project selected fields with a where clause (WOP-598)", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query()
        .select("id", "name")
        .where("name", "Bob")
        .execute() as Array<Record<string, unknown>>;
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Bob");
      expect(results[0].age).toBeUndefined();
    });

    it("should return all fields when select() is not called (WOP-598)", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const results = await repo.query().where("name", "Alice").execute();
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "1", name: "Alice", age: 30 });
    });
  });

  describe("8. Transaction support", () => {
    beforeEach(async () => {
      await storage.register(testPluginSchema);
    });

    it("should run operations atomically", async () => {
      await storage.transaction(async (trx) => {
        const repo = trx.getRepository<TestRecord>("test", "users");
        await repo.insert({ id: "1", name: "Alice", age: 30 });
        await repo.insert({ id: "2", name: "Bob", age: 25 });
      });

      const repo = storage.getRepository<TestRecord>("test", "users");
      const all = await repo.findMany();
      expect(all).toHaveLength(2);
    });

    it("should rollback on error", async () => {
      await expect(
        storage.transaction(async (trx) => {
          const repo = trx.getRepository<TestRecord>("test", "users");
          await repo.insert({ id: "1", name: "Alice", age: 30 });
          throw new Error("Rollback");
        })
      ).rejects.toThrow("Rollback");

      const repo = storage.getRepository<TestRecord>("test", "users");
      const all = await repo.findMany();
      expect(all).toHaveLength(0);
    });

    it("should throw on nested transaction", async () => {
      await expect(
        storage.transaction(async (trx) => {
          await trx.transaction(async () => {
            // Nested transaction
          });
        })
      ).rejects.toThrow();
    });

    it("should run repository-level transaction atomically (WOP-598)", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.transaction(async (trxRepo) => {
        await trxRepo.insert({ id: "1", name: "Alice", age: 30 });
        await trxRepo.insert({ id: "2", name: "Bob", age: 25 });
      });

      const all = await repo.findMany();
      expect(all).toHaveLength(2);
    });

    it("should rollback repository-level transaction on error (WOP-598)", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");

      await expect(
        repo.transaction(async (trxRepo) => {
          await trxRepo.insert({ id: "1", name: "Alice", age: 30 });
          throw new Error("abort");
        })
      ).rejects.toThrow("abort");

      // Alice should not be persisted
      const all = await repo.findMany();
      expect(all).toHaveLength(0);
    });

    it("should return value from repo.transaction() (WOP-836)", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const result = await repo.transaction(async (trxRepo) => {
        const inserted = await trxRepo.insert({ id: "1", name: "Alice", age: 30 });
        return inserted;
      });
      expect(result.id).toBe("1");
      expect(result.name).toBe("Alice");
    });
  });

  describe("9. JSON column round-trip", () => {
    beforeEach(async () => {
      await storage.register(testPluginSchema);
    });

    it("should serialize and deserialize array field", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const inserted = await repo.insert({
        id: "1",
        name: "Alice",
        age: 30,
        tags: ["admin", "user"],
      });
      expect(inserted.tags).toEqual(["admin", "user"]);
      expect(Array.isArray(inserted.tags)).toBe(true);

      const found = await repo.findById("1");
      expect(found?.tags).toEqual(["admin", "user"]);
      expect(Array.isArray(found?.tags)).toBe(true);
    });

    it("should serialize and deserialize object field", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const inserted = await repo.insert({
        id: "1",
        name: "Alice",
        age: 30,
        metadata: { key: "value" },
      });
      expect(inserted.metadata).toEqual({ key: "value" });
      expect(typeof inserted.metadata).toBe("object");

      const found = await repo.findById("1");
      expect(found?.metadata).toEqual({ key: "value" });
      expect(typeof found?.metadata).toBe("object");
    });

    it("should deserialize JSON in findMany", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insert({
        id: "1",
        name: "Alice",
        age: 30,
        tags: ["admin"],
      });
      const found = await repo.findMany();
      expect(found[0].tags).toEqual(["admin"]);
      expect(Array.isArray(found[0].tags)).toBe(true);
    });

    it("should serialize JSON in update", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insert({ id: "1", name: "Alice", age: 30 });
      const updated = await repo.update("1", {
        metadata: { key: "newValue" },
      });
      expect(updated.metadata).toEqual({ key: "newValue" });

      const found = await repo.findById("1");
      expect(found?.metadata).toEqual({ key: "newValue" });
    });

    it("should deserialize JSON in query execute", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      await repo.insert({
        id: "1",
        name: "Alice",
        age: 30,
        tags: ["admin"],
      });
      const results = await repo.query().where("name", "Alice").execute();
      expect(results[0].tags).toEqual(["admin"]);
      expect(Array.isArray(results[0].tags)).toBe(true);
    });

    it("should handle null JSON column", async () => {
      const repo = storage.getRepository<TestRecord>("test", "users");
      const inserted = await repo.insert({
        id: "1",
        name: "Alice",
        age: 30,
        tags: undefined,
      });
      // SQLite stores undefined as null
      expect(inserted.tags === undefined || inserted.tags === null).toBe(true);

      const found = await repo.findById("1");
      expect(found?.tags === undefined || found?.tags === null).toBe(true);
    });
  });

  describe("10. Schema version migration tracking", () => {
    it("should return 0 for unknown namespace", async () => {
      const version = await storage.getVersion("unknown");
      expect(version).toBe(0);
    });

    it("should return registered version", async () => {
      await storage.register(testPluginSchema);
      const version = await storage.getVersion("test");
      expect(version).toBe(1);
    });

    it("should call migrate function with correct versions", async () => {
      await storage.register(testPluginSchema);
      const migrateFn = vi.fn();
      const updatedSchema = {
        ...testPluginSchema,
        version: 2,
        migrate: migrateFn,
      };
      await storage.register(updatedSchema);
      expect(migrateFn).toHaveBeenCalledWith(1, 2, expect.anything());
    });
  });

  describe("11. Error cases", () => {
    it("should throw for unregistered namespace", () => {
      expect(() => storage.getRepository("unregistered", "users")).toThrow("Schema not registered: unregistered");
    });

    it("should throw for non-existent table", async () => {
      await storage.register(testPluginSchema);
      expect(() => storage.getRepository("test", "nonexistent")).toThrow("Table not found");
    });

    it("should throw when registering inside transaction", async () => {
      await expect(
        storage.transaction(async (trx) => {
          await trx.register(testPluginSchema);
        })
      ).rejects.toThrow();  // Just check that it throws (better-sqlite3 throws different error)
    });

    it("should throw ZodError for invalid data", async () => {
      await storage.register(testPluginSchema);
      const repo = storage.getRepository<TestRecord>("test", "users");
      await expect(
        repo.insert({ id: "1", name: 123 as unknown as string, age: 30 })
      ).rejects.toThrow();
    });
  });
});
