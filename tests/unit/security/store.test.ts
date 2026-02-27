import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecurityStore } from "../../../src/security/store.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/security/types.js";

vi.mock("../../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

function createMockRepo() {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(undefined),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue(0),
  };
}

describe("SecurityStore", () => {
  let configRepo: ReturnType<typeof createMockRepo>;
  let rulesRepo: ReturnType<typeof createMockRepo>;
  let store: SecurityStore;

  beforeEach(() => {
    configRepo = createMockRepo();
    rulesRepo = createMockRepo();
    store = new SecurityStore(
      "/tmp/wopr-test",
      () => configRepo as any,
      () => rulesRepo as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("init", () => {
    it("should insert default config when none exists", async () => {
      configRepo.findById.mockResolvedValue(null);
      await store.init();

      expect(configRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "global",
          updatedAt: expect.any(Number),
        }),
      );
      // Config string should be valid JSON with enforcement field
      const insertArg = configRepo.insert.mock.calls[0][0];
      expect(JSON.parse(insertArg.config).enforcement).toBe("enforce");
    });

    it("should not insert when config already exists", async () => {
      configRepo.findById.mockResolvedValue({
        id: "global",
        config: JSON.stringify(DEFAULT_SECURITY_CONFIG),
        updatedAt: 1,
      });
      await store.init();
      expect(configRepo.insert).not.toHaveBeenCalled();
    });

    it("should migrate from JSON when file exists", async () => {
      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ enforcement: "warn" }));

      // findById returns the migrated row after migration
      configRepo.findById.mockResolvedValue({
        id: "global",
        config: JSON.stringify({ ...DEFAULT_SECURITY_CONFIG, enforcement: "warn" }),
        updatedAt: 1,
      });

      await store.init();

      expect(fs.readFileSync).toHaveBeenCalled();
      expect(fs.renameSync).toHaveBeenCalled();
      expect(configRepo.insert).toHaveBeenCalled();
    });

    it("should prime cache after init", async () => {
      const savedConfig = { ...DEFAULT_SECURITY_CONFIG, enforcement: "warn" as const };
      configRepo.findById.mockResolvedValue({
        id: "global",
        config: JSON.stringify(savedConfig),
        updatedAt: 1,
      });

      await store.init();
      expect(store.configCache).not.toBeNull();
    });
  });

  describe("getConfig", () => {
    it("should return cached config", async () => {
      const cached = { ...DEFAULT_SECURITY_CONFIG, enforcement: "warn" as const };
      store.configCache = cached;
      const result = await store.getConfig();
      expect(result).toBe(cached);
    });

    it("should return DEFAULT_SECURITY_CONFIG when not initialized", async () => {
      const result = await store.getConfig();
      expect(result).toEqual(DEFAULT_SECURITY_CONFIG);
    });

    it("should fetch from repo and cache when no cache", async () => {
      configRepo.findById.mockResolvedValue(null);
      await store.init();
      store.clearCache();

      const savedConfig = { ...DEFAULT_SECURITY_CONFIG, enforcement: "warn" as const };
      configRepo.findById.mockResolvedValue({
        id: "global",
        config: JSON.stringify(savedConfig),
        updatedAt: 1,
      });

      const result = await store.getConfig();
      expect(result.enforcement).toBe("warn");
      expect(store.configCache).not.toBeNull();
    });

    it("should return default on parse error", async () => {
      configRepo.findById.mockResolvedValue(null);
      await store.init();
      store.clearCache();

      configRepo.findById.mockResolvedValue({
        id: "global",
        config: "not-json",
        updatedAt: 1,
      });

      const result = await store.getConfig();
      expect(result).toEqual(DEFAULT_SECURITY_CONFIG);
    });
  });

  describe("saveConfig", () => {
    it("should save config and update cache", async () => {
      configRepo.findById.mockResolvedValue(null);
      await store.init();

      const newConfig = { ...DEFAULT_SECURITY_CONFIG, enforcement: "off" as const };
      await store.saveConfig(newConfig);

      expect(configRepo.update).toHaveBeenCalledWith("global", expect.objectContaining({ id: "global" }));
      expect(store.configCache).toBe(newConfig);
    });

    it("should warn when store not initialized and not throw", async () => {
      const freshStore = new SecurityStore("/tmp/test", () => configRepo as any, () => rulesRepo as any);
      // Should not throw, just warn
      await expect(freshStore.saveConfig(DEFAULT_SECURITY_CONFIG)).resolves.toBeUndefined();
      expect(configRepo.update).not.toHaveBeenCalled();
    });
  });

  describe("registerPluginRule", () => {
    it("should insert a rule and return an id", async () => {
      configRepo.findById.mockResolvedValue(null);
      await store.init();

      const id = await store.registerPluginRule({
        pluginName: "test-plugin",
        ruleType: "trust-override",
        ruleData: { level: "trusted" },
      });

      expect(id).toBeTypeOf("string");
      expect(id.length).toBeGreaterThan(0);
      expect(rulesRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginName: "test-plugin",
          ruleType: "trust-override",
          ruleData: '{"level":"trusted"}',
        }),
      );
    });

    it("should throw when store not initialized", async () => {
      const freshStore = new SecurityStore("/tmp/test", () => configRepo as any, () => rulesRepo as any);
      await expect(
        freshStore.registerPluginRule({ pluginName: "p", ruleType: "trust-override", ruleData: {} }),
      ).rejects.toThrow("Security store not initialized");
    });
  });

  describe("removePluginRules", () => {
    it("should delete rules by plugin name", async () => {
      configRepo.findById.mockResolvedValue(null);
      await store.init();
      rulesRepo.deleteMany.mockResolvedValue(3);

      const count = await store.removePluginRules("test-plugin");
      expect(count).toBe(3);
      expect(rulesRepo.deleteMany).toHaveBeenCalledWith({ pluginName: "test-plugin" });
    });

    it("should throw when store not initialized", async () => {
      const freshStore = new SecurityStore("/tmp/test", () => configRepo as any, () => rulesRepo as any);
      await expect(freshStore.removePluginRules("p")).rejects.toThrow("Security store not initialized");
    });
  });

  describe("getPluginRules", () => {
    it("should return parsed rules", async () => {
      configRepo.findById.mockResolvedValue(null);
      await store.init();

      rulesRepo.findMany.mockResolvedValue([
        {
          id: "r1",
          pluginName: "p1",
          ruleType: "trust-override",
          targetSession: "main",
          targetTrust: "trusted",
          ruleData: '{"custom":true}',
          createdAt: 1000,
        },
      ]);

      const rules = await store.getPluginRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].ruleData).toEqual({ custom: true });
      expect(rules[0].pluginName).toBe("p1");
    });

    it("should return empty array when not initialized", async () => {
      const freshStore = new SecurityStore("/tmp/test", () => configRepo as any, () => rulesRepo as any);
      const rules = await freshStore.getPluginRules();
      expect(rules).toEqual([]);
    });
  });

  describe("clearCache", () => {
    it("should set configCache to null", () => {
      store.configCache = DEFAULT_SECURITY_CONFIG;
      store.clearCache();
      expect(store.configCache).toBeNull();
    });
  });
});
