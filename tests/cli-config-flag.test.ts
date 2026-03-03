import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("config file path override", () => {
  afterEach(async () => {
    const { setConfigFileOverride } = await import("../src/paths.js");
    setConfigFileOverride(undefined);
  });

  it("returns default CONFIG_FILE when no override set", async () => {
    const { getConfigFilePath, CONFIG_FILE } = await import("../src/paths.js");
    expect(getConfigFilePath()).toBe(CONFIG_FILE);
  });

  it("returns override path when set", async () => {
    const { setConfigFileOverride, getConfigFilePath } = await import("../src/paths.js");
    setConfigFileOverride("/tmp/custom-wopr-config.json");
    expect(getConfigFilePath()).toBe("/tmp/custom-wopr-config.json");
  });
});

describe("ConfigManager with custom config path", () => {
  const tmpConfig = join(tmpdir(), `wopr-test-config-${Date.now()}.json`);

  afterEach(async () => {
    const { setConfigFileOverride } = await import("../src/paths.js");
    setConfigFileOverride(undefined);
    try {
      unlinkSync(tmpConfig);
    } catch {}
  });

  it("loads config from overridden path", async () => {
    writeFileSync(
      tmpConfig,
      JSON.stringify({
        daemon: { port: 9999, host: "0.0.0.0", autoStart: false, cronScriptsEnabled: false },
        anthropic: {},
        oauth: {},
        discovery: { topics: [], autoJoin: false },
        plugins: { autoLoad: true, directories: [], data: {} },
      }),
    );

    const { setConfigFileOverride } = await import("../src/paths.js");
    setConfigFileOverride(tmpConfig);

    const { ConfigManager } = await import("../src/core/config.js");
    const mgr = new ConfigManager();
    const cfg = await mgr.load();
    expect(cfg.daemon.port).toBe(9999);
    expect(cfg.daemon.host).toBe("0.0.0.0");
  });
});

describe("parseGlobalFlags", () => {
  it("extracts --config and returns remaining args", async () => {
    const { parseGlobalFlags } = await import("../src/cli-flags.js");
    const result = parseGlobalFlags(["daemon", "start", "--config", "/tmp/my.json"]);
    expect(result.configPath).toBe("/tmp/my.json");
    expect(result.remainingArgs).toEqual(["daemon", "start"]);
  });

  it("returns undefined configPath when no --config flag", async () => {
    const { parseGlobalFlags } = await import("../src/cli-flags.js");
    const result = parseGlobalFlags(["daemon", "start"]);
    expect(result.configPath).toBeUndefined();
    expect(result.remainingArgs).toEqual(["daemon", "start"]);
  });

  it("rejects --config without a value", async () => {
    const { parseGlobalFlags } = await import("../src/cli-flags.js");
    expect(() => parseGlobalFlags(["daemon", "--config"])).toThrow("--config requires a file path");
  });
});
