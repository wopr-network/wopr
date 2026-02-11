import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "wopr-bundled-test");

vi.mock("../../src/plugins/state.js", () => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const dir = join(tmpdir(), "wopr-bundled-test");
  return {
    WOPR_HOME: dir,
    PLUGINS_DIR: join(dir, "plugins"),
    PLUGINS_FILE: join(dir, "plugins.json"),
    REGISTRIES_FILE: join(dir, "plugin-registries.json"),
    loadedPlugins: new Map(),
    contextProviders: new Map(),
    channelAdapters: new Map(),
    webUiExtensions: new Map(),
    uiComponents: new Map(),
    providerPlugins: new Map(),
    configSchemas: new Map(),
    pluginManifests: new Map(),
    pluginExtensions: new Map(),
    channelKey: (ch: { type: string; id: string }) => `${ch.type}:${ch.id}`,
  };
});

vi.mock("node:sqlite", () => ({
  DatabaseSync: vi.fn(),
}));

import {
  enablePlugin,
  disablePlugin,
  getInstalledPlugins,
} from "../../src/plugins/installation.js";

describe("bundled plugins", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "plugins"), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("reads plugins.json with bundled source type", () => {
    const plugins = [
      {
        name: "wopr-plugin-discord",
        version: "1.0.0",
        description: "Discord bot plugin",
        source: "bundled",
        path: "/app/bundled-plugins/wopr-plugin-discord",
        enabled: false,
        installedAt: 1700000000000,
      },
      {
        name: "wopr-plugin-slack",
        version: "0.5.0",
        description: "Slack integration",
        source: "bundled",
        path: "/app/bundled-plugins/wopr-plugin-slack",
        enabled: true,
        installedAt: 1700000000000,
      },
    ];
    writeFileSync(join(TEST_DIR, "plugins.json"), JSON.stringify(plugins, null, 2));

    const result = getInstalledPlugins();
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("bundled");
    expect(result[0].name).toBe("wopr-plugin-discord");
    expect(result[0].enabled).toBe(false);
    expect(result[1].source).toBe("bundled");
    expect(result[1].enabled).toBe(true);
  });

  it("enablePlugin works with bundled plugins", () => {
    const plugins = [
      {
        name: "wopr-plugin-discord",
        version: "1.0.0",
        description: "Discord bot plugin",
        source: "bundled",
        path: "/app/bundled-plugins/wopr-plugin-discord",
        enabled: false,
        installedAt: 1700000000000,
      },
    ];
    writeFileSync(join(TEST_DIR, "plugins.json"), JSON.stringify(plugins, null, 2));

    const result = enablePlugin("wopr-plugin-discord");
    expect(result).toBe(true);

    const updated = getInstalledPlugins();
    expect(updated[0].enabled).toBe(true);
  });

  it("disablePlugin works with bundled plugins", () => {
    const plugins = [
      {
        name: "wopr-plugin-discord",
        version: "1.0.0",
        description: "Discord bot plugin",
        source: "bundled",
        path: "/app/bundled-plugins/wopr-plugin-discord",
        enabled: true,
        installedAt: 1700000000000,
      },
    ];
    writeFileSync(join(TEST_DIR, "plugins.json"), JSON.stringify(plugins, null, 2));

    const result = disablePlugin("wopr-plugin-discord");
    expect(result).toBe(true);

    const updated = getInstalledPlugins();
    expect(updated[0].enabled).toBe(false);
  });

  it("returns empty array when plugins.json does not exist", () => {
    const pf = join(TEST_DIR, "plugins.json");
    if (existsSync(pf)) rmSync(pf);

    const result = getInstalledPlugins();
    expect(result).toEqual([]);
  });

  it("coexists with non-bundled plugins", () => {
    const plugins = [
      {
        name: "wopr-plugin-discord",
        version: "1.0.0",
        source: "bundled",
        path: "/app/bundled-plugins/wopr-plugin-discord",
        enabled: false,
        installedAt: 1700000000000,
      },
      {
        name: "my-custom-plugin",
        version: "0.1.0",
        source: "github",
        path: "/data/plugins/my-custom-plugin",
        enabled: true,
        installedAt: 1700000000000,
      },
    ];
    writeFileSync(join(TEST_DIR, "plugins.json"), JSON.stringify(plugins, null, 2));

    const result = getInstalledPlugins();
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("bundled");
    expect(result[1].source).toBe("github");
  });
});
