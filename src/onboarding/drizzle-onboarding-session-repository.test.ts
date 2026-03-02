import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DrizzleDb } from "../db/index.js";
import { createTestDb } from "../test/db.js";
import { DrizzleOnboardingSessionRepository } from "./drizzle-onboarding-session-repository.js";

describe("DrizzleOnboardingSessionRepository", () => {
  let db: DrizzleDb;
  let pool: PGlite;
  let repo: DrizzleOnboardingSessionRepository;

  beforeAll(async () => {
    const result = await createTestDb();
    db = result.db;
    pool = result.pool;
    repo = new DrizzleOnboardingSessionRepository(db);
  });

  afterAll(async () => {
    await pool.close();
  });

  it("create inserts a new session", async () => {
    const session = await repo.create({
      id: "sess-1",
      userId: null,
      anonymousId: "anon-1",
      woprSessionName: "test-session",
      status: "active",
    });
    expect(session.id).toBe("sess-1");
    expect(session.anonymousId).toBe("anon-1");
    expect(session.userId).toBeNull();
    expect(session.status).toBe("active");
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.updatedAt).toBeGreaterThan(0);
    expect(session.graduatedAt).toBeNull();
    expect(session.graduationPath).toBeNull();
    expect(session.totalPlatformCostUsd).toBeNull();
  });

  it("getById returns the created session", async () => {
    const found = await repo.getById("sess-1");
    expect(found).not.toBeNull();
    expect(found?.id).toBe("sess-1");
  });

  it("getById returns null for missing id", async () => {
    const found = await repo.getById("nonexistent");
    expect(found).toBeNull();
  });

  it("getByAnonymousId finds by anonymous id", async () => {
    const found = await repo.getByAnonymousId("anon-1");
    expect(found).not.toBeNull();
    expect(found?.anonymousId).toBe("anon-1");
  });

  it("getActiveByAnonymousId finds recent active sessions", async () => {
    const found = await repo.getActiveByAnonymousId("anon-1");
    expect(found).not.toBeNull();
    expect(found?.status).toBe("active");
  });

  it("getActiveByAnonymousId returns null for nonexistent anonymous id", async () => {
    const found = await repo.getActiveByAnonymousId("no-such-anon");
    expect(found).toBeNull();
  });

  it("upgradeAnonymousToUser sets userId", async () => {
    const upgraded = await repo.upgradeAnonymousToUser("anon-1", "user-1");
    expect(upgraded).not.toBeNull();
    expect(upgraded?.userId).toBe("user-1");
    expect(upgraded?.anonymousId).toBe("anon-1");
  });

  it("getByUserId finds by user id after upgrade", async () => {
    const found = await repo.getByUserId("user-1");
    expect(found).not.toBeNull();
    expect(found?.userId).toBe("user-1");
  });

  it("upgradeAnonymousToUser returns null for missing anonymous id", async () => {
    const result = await repo.upgradeAnonymousToUser("no-such-anon", "user-99");
    expect(result).toBeNull();
  });

  it("setStatus updates the session status", async () => {
    await repo.setStatus("sess-1", "expired");
    const found = await repo.getById("sess-1");
    expect(found?.status).toBe("expired");
  });

  it("graduate sets graduation fields and status", async () => {
    await repo.create({
      id: "sess-grad",
      userId: "user-grad",
      anonymousId: null,
      woprSessionName: "grad-session",
      status: "active",
    });

    const graduated = await repo.graduate("sess-grad", "hosted", "4.50");
    expect(graduated).not.toBeNull();
    expect(graduated?.status).toBe("graduated");
    expect(graduated?.graduationPath).toBe("hosted");
    expect(graduated?.totalPlatformCostUsd).toBe("4.50");
    expect(graduated?.graduatedAt).not.toBeNull();
  });

  it("graduate returns null on double-graduation (idempotency guard)", async () => {
    const second = await repo.graduate("sess-grad", "byok", "10.00");
    expect(second).toBeNull();
  });

  it("getGraduatedByUserId finds graduated sessions", async () => {
    const found = await repo.getGraduatedByUserId("user-grad");
    expect(found).not.toBeNull();
    expect(found?.status).toBe("graduated");
    expect(found?.graduatedAt).not.toBeNull();
  });

  it("getGraduatedByUserId returns null for non-graduated user", async () => {
    const found = await repo.getGraduatedByUserId("user-1");
    expect(found).toBeNull();
  });
});
