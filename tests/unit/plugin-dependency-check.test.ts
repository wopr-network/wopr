/**
 * Plugin Dependency Check Tests (WOP-1461)
 *
 * Tests for src/plugins/dependency-check.ts
 */

import { describe, expect, it, vi } from "vitest";

// Mock loading.js to avoid pulling in the full plugin loading stack
vi.mock("../../src/plugins/loading.js", () => ({
  normalizeDependencyName: (dep: string) =>
    dep
      .replace(/^@wopr-network\/plugin-/, "")
      .replace(/^@wopr-network\//, "")
      .replace(/^wopr-plugin-/, "")
      .replace(/^plugin-/, ""),
}));

import { checkPluginDependencies } from "../../src/plugins/dependency-check.js";

describe("checkPluginDependencies", () => {
  it("returns ok:true when dependencies is undefined", () => {
    const result = checkPluginDependencies(undefined, []);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("returns ok:true when dependencies is empty", () => {
    const result = checkPluginDependencies([], ["some-plugin"]);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("returns ok:true when all dependencies are installed", () => {
    const result = checkPluginDependencies(["@wopr-network/plugin-discord"], ["discord"]);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("returns missing deps when required plugin is not installed", () => {
    const result = checkPluginDependencies(["@wopr-network/plugin-discord"], []);
    expect(result).toEqual({ ok: false, missing: ["discord"] });
  });

  it("normalizes installed names against dependency names", () => {
    // Installed as "@wopr-network/plugin-discord", dep declared as "discord"
    const result = checkPluginDependencies(["discord"], ["@wopr-network/plugin-discord"]);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("returns multiple missing deps", () => {
    const result = checkPluginDependencies(
      ["@wopr-network/plugin-discord", "@wopr-network/plugin-cron"],
      [],
    );
    expect(result).toEqual({ ok: false, missing: ["discord", "cron"] });
  });

  it("returns only the missing subset when some deps are installed", () => {
    const result = checkPluginDependencies(
      ["@wopr-network/plugin-discord", "@wopr-network/plugin-cron"],
      ["discord"],
    );
    expect(result).toEqual({ ok: false, missing: ["cron"] });
  });

  it("handles wopr-plugin- prefix in installed names", () => {
    const result = checkPluginDependencies(["wopr-plugin-cron"], ["cron"]);
    expect(result).toEqual({ ok: true, missing: [] });
  });
});
