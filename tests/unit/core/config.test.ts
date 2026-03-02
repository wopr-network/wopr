import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  chmod: vi.fn(),
}));
vi.mock("../../../src/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../src/paths.js", () => ({
  WOPR_HOME: "/fake/wopr",
  CONFIG_FILE: "/fake/wopr/config.json",
}));

import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { ConfigManager } from "../../../src/core/config.js";

// Passing all top-level keys forces merge() to recurse into each nested object,
// creating fresh copies that are not the same reference as DEFAULT_CONFIG sub-objects.
// This prevents test-to-test state leakage via mutated DEFAULT_CONFIG references.
const FULL_DEFAULTS_FILE = JSON.stringify({
  daemon: {},
  anthropic: {},
  oauth: {},
  discovery: {},
  plugins: {},
  providers: {},
});

describe("ConfigManager", () => {
  let mgr: ConfigManager;
  const savedEnv: Record<string, string | undefined> = {};

  async function loadFreshDefaults() {
    (readFile as Mock).mockResolvedValue(FULL_DEFAULTS_FILE);
    (chmod as Mock).mockResolvedValue(undefined);
    await mgr.load();
  }

  beforeEach(() => {
    mgr = new ConfigManager();
    vi.clearAllMocks();
    for (const key of [
      "ANTHROPIC_API_KEY",
      "DISCORD_TOKEN",
      "DISCORD_GUILD_ID",
      "WOPR_DAEMON_PORT",
      "WOPR_DAEMON_HOST",
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  describe("load()", () => {
    it("should load and merge config from file", async () => {
      const fileConfig = {
        daemon: { port: 9999 },
        anthropic: { apiKey: "sk-test" },
      };
      (readFile as Mock).mockResolvedValue(JSON.stringify(fileConfig));
      (chmod as Mock).mockResolvedValue(undefined);

      const result = await mgr.load();

      expect(readFile).toHaveBeenCalledWith("/fake/wopr/config.json", "utf-8");
      expect(result.daemon.port).toBe(9999);
      expect(result.daemon.host).toBe("127.0.0.1");
      expect(result.daemon.autoStart).toBe(false);
      expect(result.anthropic.apiKey).toBe("sk-test");
      expect(result.plugins.autoLoad).toBe(true);
    });

    it("should apply defaults when file does not exist (ENOENT)", async () => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      (readFile as Mock).mockRejectedValue(err);

      const result = await mgr.load();

      expect(result.daemon.port).toBe(7437);
      expect(result.daemon.host).toBe("127.0.0.1");
      expect(result.plugins.autoLoad).toBe(true);
    });

    it("should log error and use defaults for non-ENOENT errors", async () => {
      const { logger } = await import("../../../src/logger.js");
      const err = new Error("Permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      (readFile as Mock).mockRejectedValue(err);

      const result = await mgr.load();

      expect(logger.error).toHaveBeenCalledWith("Failed to load config:", "Permission denied");
      expect(result.daemon.port).toBe(7437);
    });

    it("should log error for invalid JSON", async () => {
      const { logger } = await import("../../../src/logger.js");
      (readFile as Mock).mockResolvedValue("not valid json{{{");

      const result = await mgr.load();

      expect(logger.error).toHaveBeenCalled();
      expect(result.daemon.port).toBe(7437);
    });

    it("should fix permissions on existing config file", async () => {
      (readFile as Mock).mockResolvedValue(JSON.stringify({}));
      (chmod as Mock).mockResolvedValue(undefined);

      await mgr.load();

      expect(chmod).toHaveBeenCalledWith("/fake/wopr/config.json", 0o600);
    });
  });

  describe("load() environment overrides", () => {
    it("should override anthropic apiKey from env", async () => {
      (readFile as Mock).mockResolvedValue(JSON.stringify({ anthropic: { apiKey: "from-file" } }));
      (chmod as Mock).mockResolvedValue(undefined);
      process.env.ANTHROPIC_API_KEY = "from-env";

      const result = await mgr.load();

      expect(result.anthropic.apiKey).toBe("from-env");
    });

    it("should override discord token and guildId from env", async () => {
      (readFile as Mock).mockResolvedValue(FULL_DEFAULTS_FILE);
      (chmod as Mock).mockResolvedValue(undefined);
      process.env.DISCORD_TOKEN = "tok-123";
      process.env.DISCORD_GUILD_ID = "guild-456";

      const result = await mgr.load();

      expect(result.discord?.token).toBe("tok-123");
      expect(result.discord?.guildId).toBe("guild-456");
    });

    it("should override daemon port and host from env", async () => {
      (readFile as Mock).mockResolvedValue(FULL_DEFAULTS_FILE);
      (chmod as Mock).mockResolvedValue(undefined);
      process.env.WOPR_DAEMON_PORT = "8080";
      process.env.WOPR_DAEMON_HOST = "0.0.0.0";

      const result = await mgr.load();

      expect(result.daemon.port).toBe(8080);
      expect(result.daemon.host).toBe("0.0.0.0");
    });
  });

  describe("save()", () => {
    it("should create directory and write config file", async () => {
      await loadFreshDefaults();
      (mkdir as Mock).mockResolvedValue(undefined);
      (writeFile as Mock).mockResolvedValue(undefined);

      mgr.setValue("daemon.port", 1234);
      await mgr.save();

      expect(mkdir).toHaveBeenCalledWith("/fake/wopr", { recursive: true, mode: 0o700 });
      expect(writeFile).toHaveBeenCalledWith(
        "/fake/wopr/config.json",
        expect.any(String),
        { mode: 0o600 },
      );
      const written = (writeFile as Mock).mock.calls[0][1] as string;
      const parsed = JSON.parse(written);
      expect(parsed.daemon.port).toBe(1234);
    });

    it("should throw on mkdir failure", async () => {
      (mkdir as Mock).mockRejectedValue(new Error("disk full"));

      await expect(mgr.save()).rejects.toThrow("Failed to save config: disk full");
    });

    it("should throw on writeFile failure", async () => {
      (mkdir as Mock).mockResolvedValue(undefined);
      (writeFile as Mock).mockRejectedValue(new Error("read-only fs"));

      await expect(mgr.save()).rejects.toThrow("Failed to save config: read-only fs");
    });
  });

  describe("get()", () => {
    it("should return a copy of config", async () => {
      await loadFreshDefaults();

      const a = mgr.get();
      const b = mgr.get();
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe("getValue()", () => {
    it("should return nested value by dot path", async () => {
      await loadFreshDefaults();

      expect(mgr.getValue("daemon.port")).toBe(7437);
      expect(mgr.getValue("daemon.host")).toBe("127.0.0.1");
    });

    it("should return undefined for missing path", async () => {
      await loadFreshDefaults();
      expect(mgr.getValue("nonexistent.path")).toBeUndefined();
    });

    it("should return undefined for partially valid path", async () => {
      await loadFreshDefaults();
      expect(mgr.getValue("daemon.port.deep")).toBeUndefined();
    });

    it("should return top-level object", async () => {
      await loadFreshDefaults();

      const daemon = mgr.getValue("daemon");
      expect(daemon).toEqual({
        port: 7437,
        host: "127.0.0.1",
        autoStart: false,
        cronScriptsEnabled: false,
      });
    });
  });

  describe("setValue()", () => {
    it("should set nested value by dot path", async () => {
      await loadFreshDefaults();

      mgr.setValue("daemon.port", 9000);
      expect(mgr.getValue("daemon.port")).toBe(9000);
    });

    it("should create intermediate objects for deep paths", async () => {
      await loadFreshDefaults();

      mgr.setValue("agents.a2a.enabled", true);
      expect(mgr.getValue("agents.a2a.enabled")).toBe(true);
    });

    it("should overwrite existing values", async () => {
      await loadFreshDefaults();

      mgr.setValue("daemon.host", "0.0.0.0");
      expect(mgr.getValue("daemon.host")).toBe("0.0.0.0");
    });
  });

  describe("reset()", () => {
    it("should restore defaults", async () => {
      await loadFreshDefaults();

      mgr.setValue("daemon.port", 9999);
      expect(mgr.getValue("daemon.port")).toBe(9999);
      mgr.reset();
      // After reset, load fresh again to get a properly deep-cloned defaults
      await loadFreshDefaults();
      expect(mgr.getValue("daemon.port")).toBe(7437);
    });
  });

  describe("getProviderDefaults() / setProviderDefault()", () => {
    it("should return undefined for unknown provider", async () => {
      await loadFreshDefaults();
      expect(mgr.getProviderDefaults("codex")).toBeUndefined();
    });

    it("should set and get provider defaults", async () => {
      await loadFreshDefaults();

      mgr.setProviderDefault("codex", "model", "gpt-5.2");
      mgr.setProviderDefault("codex", "temperature", 0.7);

      const defaults = mgr.getProviderDefaults("codex");
      expect(defaults?.model).toBe("gpt-5.2");
      expect(defaults?.temperature).toBe(0.7);
    });

    it("should create providers object if missing", async () => {
      await loadFreshDefaults();

      mgr.setValue("providers", undefined);
      mgr.setProviderDefault("anthropic", "model", "claude-opus-4-6");
      expect(mgr.getProviderDefaults("anthropic")?.model).toBe("claude-opus-4-6");
    });
  });

  describe("merge (via load)", () => {
    it("should deep merge nested objects", async () => {
      const fileConfig = {
        daemon: { port: 8000 },
        plugins: { autoLoad: false },
      };
      (readFile as Mock).mockResolvedValue(JSON.stringify(fileConfig));
      (chmod as Mock).mockResolvedValue(undefined);

      const result = await mgr.load();

      expect(result.daemon.port).toBe(8000);
      expect(result.plugins.autoLoad).toBe(false);
      expect(result.daemon.host).toBe("127.0.0.1");
      expect(result.daemon.autoStart).toBe(false);
      expect(result.discovery.autoJoin).toBe(false);
    });

    it("should replace arrays (not merge them)", async () => {
      const fileConfig = {
        discovery: { topics: ["topicA", "topicB"] },
      };
      (readFile as Mock).mockResolvedValue(JSON.stringify(fileConfig));
      (chmod as Mock).mockResolvedValue(undefined);

      const result = await mgr.load();

      expect(result.discovery.topics).toEqual(["topicA", "topicB"]);
    });

    it("should skip prototype pollution keys", async () => {
      const fileConfig = {
        __proto__: { polluted: true },
        constructor: { polluted: true },
        prototype: { polluted: true },
        daemon: { port: 7777 },
      };
      (readFile as Mock).mockResolvedValue(JSON.stringify(fileConfig));
      (chmod as Mock).mockResolvedValue(undefined);

      const result = await mgr.load();

      expect(result.daemon.port).toBe(7777);
      expect((result as Record<string, unknown>)["polluted"]).toBeUndefined();
    });
  });

  describe("round-trip", () => {
    it("should save then load and get same values", async () => {
      await loadFreshDefaults();

      mgr.setValue("daemon.port", 5555);
      mgr.setValue("anthropic.apiKey", "sk-round-trip");
      mgr.setProviderDefault("codex", "model", "gpt-5.2");

      (mkdir as Mock).mockResolvedValue(undefined);
      (writeFile as Mock).mockResolvedValue(undefined);
      await mgr.save();
      const written = (writeFile as Mock).mock.calls[0][1] as string;

      const mgr2 = new ConfigManager();
      (readFile as Mock).mockResolvedValue(written);
      (chmod as Mock).mockResolvedValue(undefined);
      const loaded = await mgr2.load();

      expect(loaded.daemon.port).toBe(5555);
      expect(loaded.anthropic.apiKey).toBe("sk-round-trip");
      expect(loaded.providers?.["codex"]?.model).toBe("gpt-5.2");
    });
  });
});
