/**
 * File Permission Hardening Tests (WOP-621)
 *
 * Verifies that config.json and auth.json (fallback path) are written
 * with 0o600 (owner-only) permissions, and that WOPR_HOME is created
 * with 0o700.
 *
 * ProviderRegistry permission tests live in file-permissions-providers.test.ts
 * because vi.mock("../../src/core/providers.js") conflicts with importing the
 * real ProviderRegistry class in the same test module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture all fs/promises calls with their options
const writtenFiles: Array<{ path: string; options: unknown }> = [];
const createdDirs: Array<{ path: string; options: unknown }> = [];
const chmodCalls: Array<{ path: string; mode: number }> = [];

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeFile: vi.fn(async (path: string, _data: unknown, options?: unknown) => {
      writtenFiles.push({ path, options: options ?? null });
    }),
    readFile: vi.fn(async (_path: string, _enc: string) => '{"daemon":{"port":7437}}'),
    mkdir: vi.fn(async (path: string, options?: unknown) => {
      createdDirs.push({ path, options: options ?? null });
    }),
    chmod: vi.fn(async (path: string, mode: number) => {
      chmodCalls.push({ path, mode });
    }),
  };
});

// Capture writeFileSync calls with options (for auth.ts fallback path)
const syncWrittenFiles: Array<{ path: string; options: unknown }> = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn((_path: string, _enc?: string) => "{}"),
    writeFileSync: vi.fn((path: string, _data: unknown, options?: unknown) => {
      syncWrittenFiles.push({ path, options: options ?? null });
    }),
  };
});

// Mock paths to predictable values — MUST be declared before module imports
vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: "/mock/wopr",
  CONFIG_FILE: "/mock/wopr/config.json",
  AUTH_FILE: "/mock/wopr/auth.json",
  SESSIONS_DIR: "/mock/wopr/sessions",
  SESSIONS_FILE: "/mock/wopr/sessions.json",
  REGISTRIES_FILE: "/mock/wopr/registries.json",
  SKILLS_DIR: "/mock/wopr/skills",
  PROJECT_SKILLS_DIR: "/mock/.wopr/skills",
  PID_FILE: "/mock/wopr/daemon.pid",
  LOG_FILE: "/mock/wopr/daemon.log",
  IDENTITY_FILE: "/mock/wopr/identity.json",
  ACCESS_FILE: "/mock/wopr/access.json",
  PEERS_FILE: "/mock/wopr/peers.json",
  CRONS_FILE: "/mock/wopr/crons.json",
  CRON_HISTORY_FILE: "/mock/wopr/cron-history.json",
  GLOBAL_IDENTITY_DIR: "/data/identity",
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock providers to avoid transitive deps in config.ts and auth.ts
vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    loadCredentials: vi.fn(),
    setCredential: vi.fn(),
    getCredential: vi.fn(),
  },
}));

// Mock auth-store to avoid SQLite deps
vi.mock("../../src/auth/auth-store.js", () => ({
  AuthStore: class {
    async init() {}
  },
}));

// ============================================================================
// ConfigManager — config.json permissions
// ============================================================================
describe("WOP-621: ConfigManager file permissions", () => {
  beforeEach(() => {
    writtenFiles.length = 0;
    createdDirs.length = 0;
    chmodCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("save()", () => {
    it("writes config.json with mode 0o600", async () => {
      const { ConfigManager } = await import("../../src/core/config.js");
      const mgr = new ConfigManager();
      await mgr.save();

      const configWrite = writtenFiles.find((f) => f.path === "/mock/wopr/config.json");
      expect(configWrite, "save() should call writeFile for config.json").toBeDefined();
      expect(configWrite!.options, "writeFile options should be defined").not.toBeNull();
      expect((configWrite!.options as { mode: number }).mode).toBe(0o600);
    });

    it("creates WOPR_HOME directory with mode 0o700", async () => {
      const { ConfigManager } = await import("../../src/core/config.js");
      const mgr = new ConfigManager();
      await mgr.save();

      const dirCreate = createdDirs.find((d) => d.path === "/mock/wopr");
      expect(dirCreate, "save() should call mkdir for WOPR_HOME").toBeDefined();
      expect((dirCreate!.options as { mode: number }).mode).toBe(0o700);
    });
  });

  describe("load()", () => {
    it("calls chmod 0o600 on config.json after loading", async () => {
      const { ConfigManager } = await import("../../src/core/config.js");
      const mgr = new ConfigManager();
      await mgr.load();

      const chmodCall = chmodCalls.find((c) => c.path === "/mock/wopr/config.json");
      expect(chmodCall, "load() should chmod config.json to fix existing-file permissions").toBeDefined();
      expect(chmodCall!.mode).toBe(0o600);
    });
  });
});

// ============================================================================
// auth.ts — auth.json fallback path permissions
// ============================================================================
describe("WOP-621: auth.ts fallback file permissions", () => {
  beforeEach(() => {
    writtenFiles.length = 0;
    createdDirs.length = 0;
    chmodCalls.length = 0;
    syncWrittenFiles.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("saveAuth() fallback", () => {
    it("writes auth.json with mode 0o600 when authStore is null", async () => {
      // authStore is null by default (initAuthStorage not called)
      const { saveAuth } = await import("../../src/auth.js");
      await saveAuth({ type: "api_key", apiKey: "sk-test", updatedAt: Date.now() });

      const authWrite = syncWrittenFiles.find((f) => f.path === "/mock/wopr/auth.json");
      expect(authWrite, "saveAuth() fallback should call writeFileSync for auth.json").toBeDefined();
      expect(authWrite!.options, "writeFileSync options should include mode").not.toBeNull();
      expect((authWrite!.options as { mode: number }).mode).toBe(0o600);
    });
  });

  describe("clearAuth() fallback", () => {
    it("writes empty auth.json with mode 0o600 when authStore is null", async () => {
      const { clearAuth } = await import("../../src/auth.js");
      await clearAuth();

      const authWrite = syncWrittenFiles.find((f) => f.path === "/mock/wopr/auth.json");
      expect(authWrite, "clearAuth() fallback should call writeFileSync for auth.json").toBeDefined();
      expect(authWrite!.options, "writeFileSync options should include mode").not.toBeNull();
      expect((authWrite!.options as { mode: number }).mode).toBe(0o600);
    });
  });
});
