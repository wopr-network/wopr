import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/paths.js", () => ({
  CONFIG_FILE: "/tmp/wopr-test-config.json",
  WOPR_HOME: "/tmp/wopr-test-home",
}));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockChmod = vi.fn();
vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
}));

describe("ConfigManager validation", () => {
  let ConfigManager: typeof import("../../../src/core/config.js").ConfigManager;

  beforeEach(async () => {
    vi.resetModules();
    mockChmod.mockResolvedValue(undefined);
    const mod = await import("../../../src/core/config.js");
    ConfigManager = mod.ConfigManager;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should load a valid config without error", async () => {
    const validConfig = {
      daemon: { port: 8080, host: "0.0.0.0", autoStart: true, cronScriptsEnabled: false },
      anthropic: { apiKey: "sk-test" },
      oauth: {},
      discovery: { topics: ["ai"], autoJoin: true },
      plugins: { autoLoad: true, directories: ["/plugins"] },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(validConfig));
    const mgr = new ConfigManager();
    const cfg = await mgr.load();
    expect(cfg.daemon.port).toBe(8080);
  });

  it("should load a partial config (relying on defaults) without error", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ daemon: { port: 9999 } }));
    const mgr = new ConfigManager();
    const cfg = await mgr.load();
    expect(cfg.daemon.port).toBe(9999);
    expect(cfg.daemon.host).toBe("127.0.0.1");
  });

  it("should throw with descriptive message when daemon.port is wrong type", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ daemon: { port: "not-a-number" } }));
    const mgr = new ConfigManager();
    await expect(mgr.load()).rejects.toThrow(/daemon/i);
    await expect(mgr.load()).rejects.toThrow(/port/i);
  });

  it("should throw when discovery.topics is wrong type", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ discovery: { topics: "not-an-array" } }));
    const mgr = new ConfigManager();
    await expect(mgr.load()).rejects.toThrow(/discovery/i);
  });

  it("should use defaults when config file does not exist (ENOENT)", async () => {
    const enoent = new Error("ENOENT") as NodeJS.ErrnoException;
    enoent.code = "ENOENT";
    mockReadFile.mockRejectedValue(enoent);
    const mgr = new ConfigManager();
    const cfg = await mgr.load();
    expect(cfg.daemon.port).toBe(7437);
  });

  it("should throw when sandbox.mode has invalid enum value", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ sandbox: { mode: "invalid-mode" } }));
    const mgr = new ConfigManager();
    await expect(mgr.load()).rejects.toThrow(/sandbox/i);
  });
});
