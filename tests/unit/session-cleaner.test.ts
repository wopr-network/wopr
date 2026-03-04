/**
 * Session Cleaner Tests (WOP-1505)
 *
 * Tests for:
 * - findExpiredSessionsAsync / countActiveSessionsAsync / findLruSessionsAsync (session-repository.ts)
 * - SessionCleaner class (session-cleaner.ts): TTL expiry, LRU eviction, pending-inject guard
 * - startSessionCleaner / stopSessionCleaner / getSessionCleanerStats (sessions.ts)
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

// vi.hoisted runs before vi.mock factories (and before module imports), so
// TEST_WOPR_HOME is available when the paths.js mock factory executes.
// Must use require() since static imports aren't available here.
const { TEST_WOPR_HOME, TEST_SESSIONS_DIR, TEST_SESSIONS_FILE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync: mktmp, join: pjoin } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync: mktmpfs } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const woprHome = mktmpfs(pjoin(td(), "wopr-session-cleaner-test-"));
  return {
    TEST_WOPR_HOME: woprHome,
    TEST_SESSIONS_DIR: pjoin(woprHome, "sessions"),
    TEST_SESSIONS_FILE: pjoin(woprHome, "sessions.json"),
  };
});

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: TEST_WOPR_HOME,
  SESSIONS_DIR: TEST_SESSIONS_DIR,
  SESSIONS_FILE: TEST_SESSIONS_FILE,
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/security/index.js", () => ({
  checkSessionAccess: vi.fn(() => ({ allowed: true })),
  clearContext: vi.fn(),
  createInjectionSource: vi.fn(() => ({ type: "cli", origin: "test" })),
  createSecurityContext: vi.fn(() => ({
    requestId: "test-req",
    recordEvent: vi.fn(),
  })),
  isEnforcementEnabled: vi.fn(() => false),
  storeContext: vi.fn(),
}));

vi.mock("../../src/core/events.js", () => ({
  emitMutableIncoming: vi.fn(async () => ({ prevented: false, message: "" })),
  emitMutableOutgoing: vi.fn(async () => ({ prevented: false, response: "" })),
  emitSessionCreate: vi.fn(async () => {}),
  emitSessionDestroy: vi.fn(async () => {}),
  emitSessionResponseChunk: vi.fn(async () => {}),
}));

vi.mock("../../src/core/context.js", () => ({
  assembleContext: vi.fn(async () => ({
    context: "",
    system: "",
    sources: [],
    warnings: [],
  })),
  initContextSystem: vi.fn(),
  updateLastTriggerTimestamp: vi.fn(),
}));

vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    listProviders: vi.fn(() => []),
    resolveProvider: vi.fn(),
  },
}));

vi.mock("../../src/core/a2a-mcp.js", () => ({
  getA2AMcpServer: vi.fn(() => null),
  isA2AEnabled: vi.fn(() => false),
  setSessionFunctions: vi.fn(),
  listA2ATools: vi.fn(() => []),
  registerA2ATool: vi.fn(),
  unregisterA2ATool: vi.fn(),
}));

const mockQueueManager = vi.hoisted(() => ({
  inject: vi.fn(),
  cancelActive: vi.fn(() => false),
  hasPending: vi.fn(() => false),
  getStats: vi.fn(() => ({ active: 0, queued: 0 })),
  getAllStats: vi.fn(() => ({})),
  setExecutor: vi.fn(),
  on: vi.fn(),
}));

vi.mock("../../src/core/queue/index.js", () => ({
  queueManager: mockQueueManager,
}));

// ---------------------------------------------------------------------------
// Import modules under test (static — mocks are hoisted above imports)
// ---------------------------------------------------------------------------
import * as storage from "../../src/storage/index.js";
import * as sessionRepository from "../../src/core/session-repository.js";
import * as sessions from "../../src/core/sessions.js";
import { SessionCleaner } from "../../src/core/session-cleaner.js";

beforeEach(async () => {
  mockQueueManager.inject.mockReset();
  mockQueueManager.cancelActive.mockReset().mockReturnValue(false);
  mockQueueManager.hasPending.mockReset().mockReturnValue(false);
  mockQueueManager.getStats.mockReset().mockReturnValue({ active: 0, queued: 0 });
  mockQueueManager.getAllStats.mockReset().mockReturnValue({});
  mockQueueManager.setExecutor.mockReset();
  mockQueueManager.on.mockReset();

  storage.resetStorage();
  sessionRepository.resetSessionStorageInit();
  storage.getStorage(":memory:");
  await sessionRepository.initSessionStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(TEST_WOPR_HOME, { recursive: true, force: true });
});

// Helper: backdate a session's lastActivityAt
async function backdateSession(name: string, ageMs: number): Promise<void> {
  const repo = storage.getStorage().getRepository("sessions", "sessions");
  const record = await repo.findFirst({ name });
  if (record) {
    await repo.update(record.id, { lastActivityAt: Date.now() - ageMs });
  }
}

// ===========================================================================
// findExpiredSessionsAsync
// ===========================================================================
describe("findExpiredSessionsAsync", () => {
  it("should return sessions with lastActivityAt older than cutoff", async () => {
    await sessions.saveSessionId("old-session", "id-old");
    await backdateSession("old-session", 48 * 60 * 60 * 1000); // 48h ago

    const expired = await sessionRepository.findExpiredSessionsAsync(24 * 60 * 60 * 1000);
    expect(expired).toHaveLength(1);
    expect(expired[0].name).toBe("old-session");
  });

  it("should not return sessions within TTL", async () => {
    await sessions.saveSessionId("fresh-session", "id-fresh");

    const expired = await sessionRepository.findExpiredSessionsAsync(24 * 60 * 60 * 1000);
    expect(expired).toHaveLength(0);
  });

  it("should return multiple expired sessions", async () => {
    await sessions.saveSessionId("s1", "id-1");
    await sessions.saveSessionId("s2", "id-2");
    await backdateSession("s1", 48 * 60 * 60 * 1000);
    await backdateSession("s2", 48 * 60 * 60 * 1000);

    const expired = await sessionRepository.findExpiredSessionsAsync(24 * 60 * 60 * 1000);
    expect(expired).toHaveLength(2);
  });
});

// ===========================================================================
// countActiveSessionsAsync
// ===========================================================================
describe("countActiveSessionsAsync", () => {
  it("should return 0 with no sessions", async () => {
    const count = await sessionRepository.countActiveSessionsAsync();
    expect(count).toBe(0);
  });

  it("should return count of active sessions", async () => {
    await sessions.saveSessionId("s1", "id-1");
    await sessions.saveSessionId("s2", "id-2");
    const count = await sessionRepository.countActiveSessionsAsync();
    expect(count).toBe(2);
  });
});

// ===========================================================================
// findLruSessionsAsync
// ===========================================================================
describe("findLruSessionsAsync", () => {
  it("should return oldest sessions by lastActivityAt", async () => {
    await sessions.saveSessionId("s1", "id-1");
    await backdateSession("s1", 10000); // oldest
    await sessions.saveSessionId("s2", "id-2");

    const lru = await sessionRepository.findLruSessionsAsync(1);
    expect(lru).toHaveLength(1);
    expect(lru[0].name).toBe("s1");
  });

  it("should return up to N candidates", async () => {
    await sessions.saveSessionId("a", "id-a");
    await backdateSession("a", 3000);
    await sessions.saveSessionId("b", "id-b");
    await backdateSession("b", 2000);
    await sessions.saveSessionId("c", "id-c");

    const lru = await sessionRepository.findLruSessionsAsync(2);
    expect(lru).toHaveLength(2);
    expect(lru[0].name).toBe("a");
    expect(lru[1].name).toBe("b");
  });
});

// ===========================================================================
// SessionCleaner
// ===========================================================================
describe("SessionCleaner", () => {
  it("should remove expired sessions on cleanup()", async () => {
    await sessions.saveSessionId("expired", "id-exp");
    await backdateSession("expired", 48 * 60 * 60 * 1000);

    const cleaner = new SessionCleaner({ ttlMs: 24 * 60 * 60 * 1000, maxCount: 1000, cleanupIntervalMs: 60000 });
    const stats = await cleaner.cleanup();

    expect(stats.expiredRemoved).toBe(1);
    const remaining = await sessions.getSessions();
    expect(remaining.expired).toBeUndefined();
  });

  it("should not remove fresh sessions", async () => {
    await sessions.saveSessionId("fresh", "id-fresh");

    const cleaner = new SessionCleaner({ ttlMs: 24 * 60 * 60 * 1000, maxCount: 1000, cleanupIntervalMs: 60000 });
    const stats = await cleaner.cleanup();

    expect(stats.expiredRemoved).toBe(0);
    const remaining = await sessions.getSessions();
    expect(remaining.fresh).toBeDefined();
  });

  it("should evict LRU sessions when over maxCount", async () => {
    for (let i = 0; i < 3; i++) {
      await sessions.saveSessionId(`s${i}`, `id-${i}`);
    }
    // Backdate s0 to be oldest
    await backdateSession("s0", 3000);
    await backdateSession("s1", 2000);

    const cleaner = new SessionCleaner({ ttlMs: 24 * 60 * 60 * 1000, maxCount: 2, cleanupIntervalMs: 60000 });
    const stats = await cleaner.cleanup();

    expect(stats.lruEvicted).toBe(1);
    const remaining = await sessions.getSessions();
    expect(remaining.s0).toBeUndefined();
  });

  it("should not delete sessions with pending injects", async () => {
    await sessions.saveSessionId("busy", "id-busy");
    await backdateSession("busy", 48 * 60 * 60 * 1000);

    // Mock hasPending to return true for "busy"
    mockQueueManager.hasPending.mockImplementation((name: string) => name === "busy");

    const cleaner = new SessionCleaner({ ttlMs: 24 * 60 * 60 * 1000, maxCount: 1000, cleanupIntervalMs: 60000 });
    const stats = await cleaner.cleanup();

    expect(stats.expiredRemoved).toBe(0);
    const remaining = await sessions.getSessions();
    expect(remaining.busy).toBeDefined();
  });

  it("should start and stop the interval", async () => {
    const cleaner = new SessionCleaner({ ttlMs: 86400000, maxCount: 1000, cleanupIntervalMs: 60000 });
    // Spy on cleanup so start()'s fire-and-forget initial cleanup doesn't race with
    // the next test's beforeEach resetting storage (which would cause a 24s hang).
    vi.spyOn(cleaner, "cleanup").mockResolvedValue({ expiredRemoved: 0, lruEvicted: 0, lastCleanupAt: 0, isRunning: false });

    cleaner.start();
    expect(cleaner.getStats().isRunning).toBe(true);

    cleaner.stop();
    expect(cleaner.getStats().isRunning).toBe(false);
  });

  it("should not start a second interval if already running", async () => {
    const cleaner = new SessionCleaner({ ttlMs: 86400000, maxCount: 1000, cleanupIntervalMs: 60000 });
    // Same guard: prevent start()'s background cleanup from racing with storage reset.
    vi.spyOn(cleaner, "cleanup").mockResolvedValue({ expiredRemoved: 0, lruEvicted: 0, lastCleanupAt: 0, isRunning: false });

    cleaner.start();
    const statsBefore = cleaner.getStats();
    cleaner.start(); // second call should be a no-op
    const statsAfter = cleaner.getStats();

    expect(statsBefore.isRunning).toBe(statsAfter.isRunning);
    cleaner.stop();
  });

  it("should accumulate expiredRemoved in getStats() across multiple cleanups", async () => {
    await sessions.saveSessionId("a", "id-a");
    await backdateSession("a", 48 * 60 * 60 * 1000);

    const cleaner = new SessionCleaner({ ttlMs: 24 * 60 * 60 * 1000, maxCount: 1000, cleanupIntervalMs: 60000 });

    await cleaner.cleanup();
    // Create another expired session
    await sessions.saveSessionId("b", "id-b");
    await backdateSession("b", 48 * 60 * 60 * 1000);
    await cleaner.cleanup();

    expect(cleaner.getStats().expiredRemoved).toBe(2);
  });

  it("should skip a concurrent cleanup if one is already in progress", async () => {
    await sessions.saveSessionId("x", "id-x");
    await backdateSession("x", 48 * 60 * 60 * 1000);

    const cleaner = new SessionCleaner({ ttlMs: 24 * 60 * 60 * 1000, maxCount: 1000, cleanupIntervalMs: 60000 });

    // Run two cleanups concurrently — only one should delete the session
    const [r1, r2] = await Promise.all([cleaner.cleanup(), cleaner.cleanup()]);
    expect(r1.expiredRemoved + r2.expiredRemoved).toBe(1);
  });

  it("should evict enough sessions even when some have pending injects", async () => {
    // Create 5 sessions, maxCount = 3 → need to evict 2
    for (let i = 0; i < 5; i++) {
      await sessions.saveSessionId(`sess${i}`, `id-${i}`);
    }
    await backdateSession("sess0", 5000); // oldest — has pending inject, should be skipped
    await backdateSession("sess1", 4000); // 2nd oldest — evicted
    await backdateSession("sess2", 3000); // 3rd oldest — evicted
    await backdateSession("sess3", 2000);
    await backdateSession("sess4", 1000);

    // Only sess0 has a pending inject
    mockQueueManager.hasPending.mockImplementation((name: string) => name === "sess0");

    const cleaner = new SessionCleaner({ ttlMs: 24 * 60 * 60 * 1000, maxCount: 3, cleanupIntervalMs: 60000 });
    const stats = await cleaner.cleanup();

    // Should evict sess1 and sess2 (not sess0 since it's busy)
    expect(stats.lruEvicted).toBe(2);
    const remaining = await sessions.getSessions();
    expect(remaining.sess0).toBeDefined(); // busy, spared
    expect(remaining.sess1).toBeUndefined(); // evicted
    expect(remaining.sess2).toBeUndefined(); // evicted
  });
});

// ===========================================================================
// sessions.ts facade: startSessionCleaner / stopSessionCleaner / getSessionCleanerStats
// ===========================================================================
describe("session cleaner facade", () => {
  it("should export startSessionCleaner, stopSessionCleaner, getSessionCleanerStats", () => {
    expect(typeof sessions.startSessionCleaner).toBe("function");
    expect(typeof sessions.stopSessionCleaner).toBe("function");
    expect(typeof sessions.getSessionCleanerStats).toBe("function");
  });

  it("should return null stats before cleaner is started", () => {
    expect(sessions.getSessionCleanerStats()).toBeNull();
  });

  it("should return stats after starting", () => {
    sessions.startSessionCleaner({ ttlMs: 86400000, maxCount: 1000, cleanupIntervalMs: 60000 });
    const stats = sessions.getSessionCleanerStats();
    expect(stats).not.toBeNull();
    expect(stats?.isRunning).toBe(true);
    sessions.stopSessionCleaner();
  });

  it("should return null after stopping", () => {
    sessions.startSessionCleaner({ ttlMs: 86400000, maxCount: 1000, cleanupIntervalMs: 60000 });
    sessions.stopSessionCleaner();
    expect(sessions.getSessionCleanerStats()).toBeNull();
  });
});
