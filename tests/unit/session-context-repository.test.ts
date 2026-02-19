/**
 * Session Context Repository Tests (WOP-556)
 *
 * Tests for src/core/session-context-schema.ts and
 * src/core/session-context-repository.ts:
 * - Schema registration
 * - CRUD: getSessionContext, setSessionContext, listSessionContextFiles, deleteSessionContext
 * - Composite key format: "{session}:{filename}"
 * - Global vs session source distinction
 * - Daily memory filename normalization
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports
// Static string literals required for vi.mock hoisting
// ---------------------------------------------------------------------------

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: "/tmp/wopr-sctx-test",
  SESSIONS_DIR: "/tmp/wopr-sctx-test/sessions",
  GLOBAL_IDENTITY_DIR: "/tmp/wopr-sctx-test/identity",
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getStorage, resetStorage } from "../../src/storage/public.js";
import type { StorageApi } from "../../src/storage/api/plugin-storage.js";
import {
  initSessionContextStorage,
  resetSessionContextStorageInit,
  getSessionContext,
  setSessionContext,
  listSessionContextFiles,
  deleteSessionContext,
  migrateSessionContextFromFilesystem,
} from "../../src/core/session-context-repository.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const TEST_DIR = "/tmp/wopr-sctx-test";

describe("Session Context Repository (WOP-556)", () => {
  let storage: StorageApi;
  let testDbPath: string;

  beforeEach(async () => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    resetStorage();
    resetSessionContextStorageInit();
    testDbPath = join(TEST_DIR, `sctx-${Math.random().toString(36).slice(2)}.db`);
    storage = getStorage(testDbPath);
    await initSessionContextStorage();
  });

  afterEach(() => {
    resetStorage();
    resetSessionContextStorageInit();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // getSessionContext
  // -------------------------------------------------------------------------

  describe("getSessionContext", () => {
    it("returns null for missing record", async () => {
      const result = await getSessionContext("mybot", "SOUL.md");
      expect(result).toBeNull();
    });

    it("returns content after setSessionContext", async () => {
      await setSessionContext("mybot", "SOUL.md", "# Soul content", "session");
      const result = await getSessionContext("mybot", "SOUL.md");
      expect(result).toBe("# Soul content");
    });

    it("uses composite key so different sessions are independent", async () => {
      await setSessionContext("bot1", "IDENTITY.md", "bot1 identity", "session");
      await setSessionContext("bot2", "IDENTITY.md", "bot2 identity", "session");

      expect(await getSessionContext("bot1", "IDENTITY.md")).toBe("bot1 identity");
      expect(await getSessionContext("bot2", "IDENTITY.md")).toBe("bot2 identity");
    });

    it("distinguishes global vs session source for same filename", async () => {
      await setSessionContext("__global__", "IDENTITY.md", "global identity", "global");
      await setSessionContext("mybot", "IDENTITY.md", "session identity", "session");

      expect(await getSessionContext("__global__", "IDENTITY.md")).toBe("global identity");
      expect(await getSessionContext("mybot", "IDENTITY.md")).toBe("session identity");
    });

    it("handles daily memory filenames like memory/2024-01-15.md", async () => {
      await setSessionContext("mybot", "memory/2024-01-15.md", "daily entry", "session");
      const result = await getSessionContext("mybot", "memory/2024-01-15.md");
      expect(result).toBe("daily entry");
    });
  });

  // -------------------------------------------------------------------------
  // setSessionContext - upsert behavior
  // -------------------------------------------------------------------------

  describe("setSessionContext", () => {
    it("inserts a new record", async () => {
      await setSessionContext("mybot", "SOUL.md", "# Soul", "session");
      expect(await getSessionContext("mybot", "SOUL.md")).toBe("# Soul");
    });

    it("updates existing record on second write", async () => {
      await setSessionContext("mybot", "SOUL.md", "v1", "session");
      await setSessionContext("mybot", "SOUL.md", "v2", "session");
      expect(await getSessionContext("mybot", "SOUL.md")).toBe("v2");
    });

    it("stores updatedAt timestamp", async () => {
      const before = Date.now();
      await setSessionContext("mybot", "SOUL.md", "content", "session");
      const repo = storage.getRepository<{ id: string; updatedAt: number }>(
        "session_context",
        "session_context",
      );
      const record = await repo.findById("mybot:SOUL.md");
      expect(record).not.toBeNull();
      expect(record!.updatedAt).toBeGreaterThanOrEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // listSessionContextFiles
  // -------------------------------------------------------------------------

  describe("listSessionContextFiles", () => {
    it("returns empty array when no files exist", async () => {
      const result = await listSessionContextFiles("newbot");
      expect(result).toEqual([]);
    });

    it("returns filenames for a given session", async () => {
      await setSessionContext("mybot", "SOUL.md", "soul", "session");
      await setSessionContext("mybot", "IDENTITY.md", "identity", "session");
      await setSessionContext("otherbot", "SOUL.md", "other soul", "session");

      const result = await listSessionContextFiles("mybot");
      expect(result).toHaveLength(2);
      expect(result).toContain("SOUL.md");
      expect(result).toContain("IDENTITY.md");
    });

    it("includes daily memory files", async () => {
      await setSessionContext("mybot", "memory/2024-01-15.md", "daily", "session");
      const result = await listSessionContextFiles("mybot");
      expect(result).toContain("memory/2024-01-15.md");
    });
  });

  // -------------------------------------------------------------------------
  // deleteSessionContext
  // -------------------------------------------------------------------------

  describe("deleteSessionContext", () => {
    it("deletes a specific file", async () => {
      await setSessionContext("mybot", "SOUL.md", "soul", "session");
      await deleteSessionContext("mybot", "SOUL.md");
      expect(await getSessionContext("mybot", "SOUL.md")).toBeNull();
    });

    it("does not affect other files in same session", async () => {
      await setSessionContext("mybot", "SOUL.md", "soul", "session");
      await setSessionContext("mybot", "IDENTITY.md", "identity", "session");
      await deleteSessionContext("mybot", "SOUL.md");
      expect(await getSessionContext("mybot", "IDENTITY.md")).toBe("identity");
    });

    it("is a no-op for non-existent records", async () => {
      // Should not throw
      await expect(deleteSessionContext("mybot", "MISSING.md")).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // migrateSessionContextFromFilesystem
  // -------------------------------------------------------------------------

  describe("migrateSessionContextFromFilesystem", () => {
    const sessionsDir = join(TEST_DIR, "sessions");
    const globalIdentityDir = join(TEST_DIR, "identity");

    beforeEach(() => {
      mkdirSync(sessionsDir, { recursive: true });
      mkdirSync(globalIdentityDir, { recursive: true });
    });

    it("migrates session .md files into SQL", async () => {
      const botDir = join(sessionsDir, "mybot");
      mkdirSync(botDir, { recursive: true });
      writeFileSync(join(botDir, "SOUL.md"), "# Soul content");
      writeFileSync(join(botDir, "IDENTITY.md"), "# Identity content");

      await migrateSessionContextFromFilesystem(sessionsDir, globalIdentityDir);

      expect(await getSessionContext("mybot", "SOUL.md")).toBe("# Soul content");
      expect(await getSessionContext("mybot", "IDENTITY.md")).toBe("# Identity content");
    });

    it("migrates global identity files under __global__", async () => {
      writeFileSync(join(globalIdentityDir, "IDENTITY.md"), "# Global identity");

      await migrateSessionContextFromFilesystem(sessionsDir, globalIdentityDir);

      expect(await getSessionContext("__global__", "IDENTITY.md")).toBe("# Global identity");
    });

    it("migrates memory subdirectory files with memory/ prefix", async () => {
      const botDir = join(sessionsDir, "mybot");
      const memDir = join(botDir, "memory");
      mkdirSync(memDir, { recursive: true });
      writeFileSync(join(memDir, "2024-01-15.md"), "daily entry");

      await migrateSessionContextFromFilesystem(sessionsDir, globalIdentityDir);

      expect(await getSessionContext("mybot", "memory/2024-01-15.md")).toBe("daily entry");
    });

    it("is idempotent — second call does not overwrite existing SQL records", async () => {
      const botDir = join(sessionsDir, "mybot");
      mkdirSync(botDir, { recursive: true });
      writeFileSync(join(botDir, "SOUL.md"), "# Original");

      await migrateSessionContextFromFilesystem(sessionsDir, globalIdentityDir);

      // Manually update the SQL record to simulate a newer value
      await setSessionContext("mybot", "SOUL.md", "# Updated in SQL", "session");

      // Run migration again — should NOT overwrite the updated value
      await migrateSessionContextFromFilesystem(sessionsDir, globalIdentityDir);

      expect(await getSessionContext("mybot", "SOUL.md")).toBe("# Updated in SQL");
    });

    it("is a no-op when sessionsDir and globalIdentityDir do not exist", async () => {
      await expect(
        migrateSessionContextFromFilesystem("/tmp/nonexistent-sessions", "/tmp/nonexistent-identity"),
      ).resolves.toBeUndefined();
    });
  });
});
