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

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
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

import { existsSync, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { config } from "../../src/core/config.js";
import { getInstalledPlugins } from "../../src/plugins/installation.js";
import { runChecks } from "../../src/commands/doctor.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("doctor command", () => {
  describe("runChecks", () => {
    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: "test-plugin", version: "1.0.0" }));
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

    it("should warn when ANTHROPIC_API_KEY is not set", async () => {
      vi.mocked(config.get).mockReturnValue({
        daemon: { port: 7437, host: "127.0.0.1", autoStart: false, cronScriptsEnabled: false },
        anthropic: {},
        oauth: {},
        discovery: { topics: [], autoJoin: false },
        plugins: { autoLoad: true, directories: ["/tmp/test-wopr/plugins"] },
      } as any);
      vi.mocked(config.load).mockResolvedValue({
        daemon: { port: 7437, host: "127.0.0.1", autoStart: false, cronScriptsEnabled: false },
        anthropic: {},
        oauth: {},
        discovery: { topics: [], autoJoin: false },
        plugins: { autoLoad: true, directories: ["/tmp/test-wopr/plugins"] },
      } as any);
      const origKey = process.env.ANTHROPIC_API_KEY;
      const origOpenAI = process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        const results = await runChecks();
        const envCheck = results.find((r) => r.name === "Environment variables");
        expect(envCheck?.pass).toBe(false);
      } finally {
        if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
        if (origOpenAI !== undefined) process.env.OPENAI_API_KEY = origOpenAI;
      }
    });

    it("should fail data directory check when dir is not writable", async () => {
      vi.mocked(access).mockRejectedValue(new Error("EACCES"));
      const results = await runChecks();
      const dirCheck = results.find((r) => r.name === "Data directory");
      expect(dirCheck?.pass).toBe(false);
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
      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (String(p).includes("package.json")) return false;
        return true;
      });
      const results = await runChecks();
      const pluginCheck = results.find((r) => r.name === "Plugin manifests");
      expect(pluginCheck?.pass).toBe(false);
    });
  });
});
