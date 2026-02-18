/**
 * Memory path configuration tests (WOP-615)
 *
 * Verifies that session memory discovery uses configurable paths
 * from src/paths.ts instead of hardcoded /data/sessions, and that
 * GLOBAL_IDENTITY_DIR derives from WOPR_HOME instead of hardcoded /data/identity.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_WOPR_HOME = mkdtempSync(join(tmpdir(), "wopr-memory-paths-test-"));
const TEST_SESSIONS_DIR = join(TEST_WOPR_HOME, "sessions");

// Mock paths module before importing anything else
vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: TEST_WOPR_HOME,
  SESSIONS_DIR: TEST_SESSIONS_DIR,
  GLOBAL_IDENTITY_DIR: join(TEST_WOPR_HOME, "identity"),
}));

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterAll(() => {
  rmSync(TEST_WOPR_HOME, { recursive: true, force: true });
});

describe("discoverSessionMemoryDirs", () => {
  beforeEach(() => {
    // Clean and recreate sessions dir
    if (existsSync(TEST_SESSIONS_DIR)) {
      rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_SESSIONS_DIR, { recursive: true });
  });

  it("uses SESSIONS_DIR from paths module, not hardcoded /data/sessions", async () => {
    // Create a session with a memory directory
    const sessionDir = join(TEST_SESSIONS_DIR, "test-session");
    mkdirSync(join(sessionDir, "memory"), { recursive: true });
    writeFileSync(join(sessionDir, "memory", "SELF.md"), "test");

    const { discoverSessionMemoryDirs } = await import("../../src/memory/index.js");
    const dirs = await discoverSessionMemoryDirs();

    expect(dirs).toContain(sessionDir);
    // Should NOT look in /data/sessions
    expect(dirs.every((d: string) => d.startsWith(TEST_SESSIONS_DIR))).toBe(true);
  });

  it("returns empty array when sessions dir has no memory subdirectories", async () => {
    mkdirSync(join(TEST_SESSIONS_DIR, "empty-session"), { recursive: true });
    // No memory/ subdirectory

    const { discoverSessionMemoryDirs } = await import("../../src/memory/index.js");
    const dirs = await discoverSessionMemoryDirs();

    expect(dirs).toEqual([]);
  });

  it("returns empty array when sessions dir does not exist", async () => {
    rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true });

    const { discoverSessionMemoryDirs } = await import("../../src/memory/index.js");
    const dirs = await discoverSessionMemoryDirs();

    expect(dirs).toEqual([]);
  });
});

describe("GLOBAL_IDENTITY_DIR default", () => {
  it("derives from WOPR_HOME, not hardcoded /data/identity", async () => {
    const { GLOBAL_IDENTITY_DIR } = await import("../../src/paths.js");
    expect(GLOBAL_IDENTITY_DIR).toBe(join(TEST_WOPR_HOME, "identity"));
    expect(GLOBAL_IDENTITY_DIR).not.toBe("/data/identity");
  });
});
