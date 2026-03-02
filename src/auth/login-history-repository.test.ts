import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BetterAuthLoginHistoryRepository } from "./login-history-repository.js";

describe("BetterAuthLoginHistoryRepository", () => {
  let pool: Pool;

  beforeAll(async () => {
    const pg = await import("pg");
    pool = new pg.default.Pool({
      connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/wopr_test",
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "id" text PRIMARY KEY,
        "userId" text NOT NULL,
        "token" text NOT NULL,
        "expiresAt" timestamp NOT NULL,
        "ipAddress" text,
        "userAgent" text,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM "session"`);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "session"`);
    await pool.end();
  });

  it("returns empty array when user has no sessions", async () => {
    const repo = new BetterAuthLoginHistoryRepository(pool);
    const result = await repo.findByUserId("no-such-user");
    expect(result).toEqual([]);
  });

  it("returns sessions ordered by createdAt DESC", async () => {
    await pool.query(
      `INSERT INTO "session" ("id", "userId", "token", "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      ["s1", "user-1", "tok1", new Date("2030-01-01"), "1.2.3.4", "Mozilla/5.0", new Date("2026-01-01")],
    );
    await pool.query(
      `INSERT INTO "session" ("id", "userId", "token", "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      ["s2", "user-1", "tok2", new Date("2030-01-01"), "5.6.7.8", "Chrome/120", new Date("2026-01-02")],
    );
    const repo = new BetterAuthLoginHistoryRepository(pool);
    const result = await repo.findByUserId("user-1");
    expect(result).toHaveLength(2);
    expect(result[0].ip).toBe("5.6.7.8");
    expect(result[1].ip).toBe("1.2.3.4");
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO "session" ("id", "userId", "token", "expiresAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now())`,
        [`s${i}`, "user-1", `tok${i}`, new Date("2030-01-01")],
      );
    }
    const repo = new BetterAuthLoginHistoryRepository(pool);
    const result = await repo.findByUserId("user-1", 3);
    expect(result).toHaveLength(3);
  });

  it("does not return sessions for other users", async () => {
    await pool.query(
      `INSERT INTO "session" ("id", "userId", "token", "expiresAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, now(), now())`,
      ["s1", "other-user", "tok1", new Date("2030-01-01")],
    );
    const repo = new BetterAuthLoginHistoryRepository(pool);
    const result = await repo.findByUserId("user-1");
    expect(result).toEqual([]);
  });
});
