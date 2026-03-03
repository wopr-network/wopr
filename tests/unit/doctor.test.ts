import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  chmod: vi.fn(),
  constants: { W_OK: 2 },
}));

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: "/tmp/test-wopr",
  CONFIG_FILE: "/tmp/test-wopr/config.json",
  SESSIONS_DIR: "/tmp/test-wopr/sessions",
  SKILLS_DIR: "/tmp/test-wopr/skills",
  PID_FILE: "/tmp/test-wopr/daemon.pid",
  getConfigFilePath: vi.fn(() => "/tmp/test-wopr/config.json"),
}));

vi.mock("../../src/core/config.js", () => {
  const mockConfig = {
    load: vi.fn(),
    get: vi.fn(),
  };
  return { config: mockConfig, ConfigManager: vi.fn() };
});

vi.mock("../../src/plugins/installation.js", () => ({
  getInstalledPlugins: vi.fn(),
}));

import { access, readFile } from "node:fs/promises";
import { config } from "../../src/core/config.js";
import { getInstalledPlugins } from "../../src/plugins/installation.js";
import { runChecks } from "../../src/commands/doctor.js";

let savedAnthropicKey: string | undefined;
let savedOpenAIKey: string | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  if (savedAnthropicKey !== undefined) {
    process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }
  if (savedOpenAIKey !== undefined) {
    process.env.OPENAI_API_KEY = savedOpenAIKey;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
});

describe("doctor command", () => {
  describe("runChecks", () => {
    beforeEach(() => {
      savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
      savedOpenAIKey = process.env.OPENAI_API_KEY;
      process.env.ANTHROPIC_API_KEY = "sk-test-env";
      delete process.env.OPENAI_API_KEY;

      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({ name: "test-plugin", version: "1.0.0" }) as any,
      );
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(config.load).mockResolvedValue({
        daemon: { port: 7437, host: "127.0.0.1", autoStart: false, cronScriptsEnabled: false },
        anthropic: { apiKey: "sk-test" },
        oauth: {},
        discovery: { topics: [], autoJoin: false },
        plugins: { autoLoad: true, directories: ["/tmp/test-wopr/plugins"] },
      } as any);
      vi.mocked(config.get).mockReturnValue({
        daemon: { port: 7437, host: "127.0.0.1", autoStart: false, cronScriptsEnabled: false },
        anthropic: { apiKey: "sk-test" },
        oauth: {},
        discovery: { topics: [], autoJoin: false },
        plugins: { autoLoad: true, directories: ["/tmp/test-wopr/plugins"] },
      } as any);
      vi.mocked(getInstalledPlugins).mockResolvedValue([]);
    });

    it("should return all-pass when environment is healthy", async () => {
      const results = await runChecks();
      expect(results.length).toBe(6);
      const failed = results.filter((r) => !r.pass);
      expect(failed.length).toBe(0);
    });

    it("should fail config check when config load throws", async () => {
      vi.mocked(config.load).mockRejectedValue(new Error("no config"));
      const results = await runChecks();
      const configCheck = results.find((r) => r.name === "Config file");
      expect(configCheck?.pass).toBe(false);
    });

    it("should fail config check when config is invalid", async () => {
      vi.mocked(config.load).mockRejectedValue(new Error("Invalid WOPR config"));
      const results = await runChecks();
      const configCheck = results.find((r) => r.name === "Config file");
      expect(configCheck?.pass).toBe(false);
      expect(configCheck?.fix).toContain("wopr init");
    });

    it("should fail environment variables check when no API keys in env", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const results = await runChecks();
      const envCheck = results.find((r) => r.name === "Environment variables");
      expect(envCheck?.pass).toBe(false);
    });

    it("should pass provider credentials check when config has key even without env vars", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const results = await runChecks();
      const credCheck = results.find((r) => r.name === "Provider credentials");
      expect(credCheck?.pass).toBe(true);
    });

    it("should fail provider credentials check when no env vars and no config key", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      vi.mocked(config.get).mockReturnValue({
        daemon: { port: 7437, host: "127.0.0.1", autoStart: false, cronScriptsEnabled: false },
        anthropic: {},
        oauth: {},
        discovery: { topics: [], autoJoin: false },
        plugins: { autoLoad: true, directories: ["/tmp/test-wopr/plugins"] },
      } as any);
      const results = await runChecks();
      const credCheck = results.find((r) => r.name === "Provider credentials");
      expect(credCheck?.pass).toBe(false);
    });

    it("should fail data directory check when dir is not writable", async () => {
      vi.mocked(access).mockRejectedValue(new Error("EACCES: permission denied"));
      const results = await runChecks();
      const dirCheck = results.find((r) => r.name === "Data directory");
      expect(dirCheck?.pass).toBe(false);
      expect(dirCheck?.detail).toContain("not writable");
      expect(dirCheck?.fix).toContain("chmod");
    });

    it("should fail data directory check with mkdir suggestion when dir is missing", async () => {
      const err = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
      vi.mocked(access).mockRejectedValue(err);
      const results = await runChecks();
      const dirCheck = results.find((r) => r.name === "Data directory");
      expect(dirCheck?.pass).toBe(false);
      expect(dirCheck?.detail).toContain("does not exist");
      expect(dirCheck?.fix).toContain("mkdir");
    });

    it("should pass plugin manifests check when no plugins installed", async () => {
      vi.mocked(getInstalledPlugins).mockResolvedValue([]);
      const results = await runChecks();
      const pluginCheck = results.find((r) => r.name === "Plugin manifests");
      expect(pluginCheck?.pass).toBe(true);
    });

    it("should fail plugin manifests check when a plugin has no manifest", async () => {
      vi.mocked(getInstalledPlugins).mockResolvedValue([
        { name: "test-plugin", version: "1.0.0", path: "/tmp/plugins/test", enabled: true, source: "local" },
      ] as any);
      const err = Object.assign(new Error("ENOENT: no such file or directory, open '/tmp/plugins/test/package.json'"), { code: "ENOENT" });
      vi.mocked(readFile).mockRejectedValue(err);
      const results = await runChecks();
      const pluginCheck = results.find((r) => r.name === "Plugin manifests");
      expect(pluginCheck?.pass).toBe(false);
      expect(pluginCheck?.detail).toContain("test-plugin");
    });

    it("should pass plugin manifests check when plugin has wopr-plugin.json but no package.json", async () => {
      vi.mocked(getInstalledPlugins).mockResolvedValue([
        { name: "test-plugin", version: "1.0.0", path: "/tmp/plugins/test", enabled: true, source: "local" },
      ] as any);
      vi.mocked(readFile).mockImplementation((p: any) => {
        if (String(p).includes("wopr-plugin.json")) {
          return Promise.resolve(JSON.stringify({ name: "test-plugin", version: "1.0.0" }) as any);
        }
        return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      });
      const results = await runChecks();
      const pluginCheck = results.find((r) => r.name === "Plugin manifests");
      expect(pluginCheck?.pass).toBe(true);
    });

    it("should pass environment variables check when WOPR_API_KEY is set", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      process.env.WOPR_API_KEY = "test-key";
      try {
        const results = await runChecks();
        const envCheck = results.find((r) => r.name === "Environment variables");
        expect(envCheck?.pass).toBe(true);
        expect(envCheck?.detail).toContain("WOPR_API_KEY");
      } finally {
        delete process.env.WOPR_API_KEY;
      }
    });

    it("should pass environment variables check when WOPR_CLAUDE_OAUTH_TOKEN is set", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      process.env.WOPR_CLAUDE_OAUTH_TOKEN = "oauth-token";
      try {
        const results = await runChecks();
        const envCheck = results.find((r) => r.name === "Environment variables");
        expect(envCheck?.pass).toBe(true);
        expect(envCheck?.detail).toContain("WOPR_CLAUDE_OAUTH_TOKEN");
      } finally {
        delete process.env.WOPR_CLAUDE_OAUTH_TOKEN;
      }
    });
  });
});
