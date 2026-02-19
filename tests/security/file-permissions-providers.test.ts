/**
 * ProviderRegistry File Permission Tests (WOP-621)
 *
 * Verifies that providers.json is written with 0o600 (owner-only) permissions
 * and that ~/.wopr is created with 0o700.
 *
 * This is a separate file from file-permissions.test.ts because importing
 * the real ProviderRegistry requires NOT mocking "../../src/core/providers.js",
 * which is needed as a dependency mock in the combined test file.
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
    readFile: vi.fn(async (_path: string, _enc: string) => "[]"),
    mkdir: vi.fn(async (path: string, options?: unknown) => {
      createdDirs.push({ path, options: options ?? null });
    }),
    chmod: vi.fn(async (path: string, mode: number) => {
      chmodCalls.push({ path, mode });
    }),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // existsSync returns true so loadCredentials finds the file
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn((_path: string, _enc?: string) => "[]"),
  };
});

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ============================================================================
// ProviderRegistry — providers.json permissions
// ============================================================================
describe("WOP-621: ProviderRegistry file permissions", () => {
  beforeEach(() => {
    writtenFiles.length = 0;
    createdDirs.length = 0;
    chmodCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("saveCredentials()", () => {
    it("writes providers.json with mode 0o600", async () => {
      const { ProviderRegistry } = await import("../../src/core/providers.js");
      // Create a fresh instance (not the singleton) to avoid state pollution
      const registry = new ProviderRegistry();
      await registry.saveCredentials();

      // providers.json path ends with ".wopr/providers.json"
      const credWrite = writtenFiles.find((f) => f.path.endsWith("providers.json"));
      expect(credWrite, "saveCredentials() should call writeFile for providers.json").toBeDefined();
      expect(credWrite!.options, "writeFile options should be defined").not.toBeNull();
      expect((credWrite!.options as { mode: number }).mode).toBe(0o600);
    });

    it("creates ~/.wopr directory with mode 0o700", async () => {
      const { ProviderRegistry } = await import("../../src/core/providers.js");
      const registry = new ProviderRegistry();
      await registry.saveCredentials();

      // directory path ends with ".wopr"
      const dirCreate = createdDirs.find((d) => d.path.endsWith(".wopr"));
      expect(dirCreate, "saveCredentials() should call mkdir for ~/.wopr").toBeDefined();
      expect((dirCreate!.options as { mode: number }).mode).toBe(0o700);
    });
  });

  describe("loadCredentials()", () => {
    it("calls chmod 0o600 on providers.json after loading", async () => {
      const { ProviderRegistry } = await import("../../src/core/providers.js");
      const registry = new ProviderRegistry();
      // existsSync is mocked to return true, so file appears to exist
      await registry.loadCredentials();

      const chmodCall = chmodCalls.find((c) => c.path.endsWith("providers.json"));
      expect(
        chmodCall,
        "loadCredentials() should chmod providers.json to fix existing-file permissions",
      ).toBeDefined();
      expect(chmodCall!.mode).toBe(0o600);
    });
  });
});
