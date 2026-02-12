/**
 * Plugin Requirements Tests (WOP-102)
 *
 * Tests for src/plugins/requirements.ts covering:
 * - hasBinary / whichBinary (binary lookup in PATH)
 * - hasEnv (environment variable checking)
 * - hasDocker / dockerImageExists (Docker availability)
 * - resolveConfigPath / isConfigPathTruthy (config path resolution)
 * - checkOsRequirement / checkNodeRequirement (platform checks)
 * - checkRequirements (comprehensive requirement checking)
 * - formatMissingRequirements (display formatting)
 * - canMethodHelp / runInstall (install method matching and execution)
 * - ensureRequirements (auto-install orchestration)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  hasBinary,
  whichBinary,
  hasEnv,
  hasDocker,
  resolveConfigPath,
  isConfigPathTruthy,
  checkOsRequirement,
  checkNodeRequirement,
  checkRequirements,
  formatMissingRequirements,
  runInstall,
  ensureRequirements,
} from "../../src/plugins/requirements.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// hasBinary
// ============================================================================

describe("hasBinary", () => {
  it("should return true for a binary that exists (node)", () => {
    expect(hasBinary("node")).toBe(true);
  });

  it("should return false for a nonexistent binary", () => {
    expect(hasBinary("nonexistent-binary-xyz-abc-123")).toBe(false);
  });

  it("should return false when PATH is empty", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      expect(hasBinary("node")).toBe(false);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("should return false when PATH is undefined", () => {
    const originalPath = process.env.PATH;
    delete process.env.PATH;
    try {
      expect(hasBinary("node")).toBe(false);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

// ============================================================================
// whichBinary
// ============================================================================

describe("whichBinary", () => {
  it("should return path for a binary that exists", () => {
    const result = whichBinary("node");
    expect(result).not.toBeNull();
    expect(result).toContain("node");
  });

  it("should return null for a nonexistent binary", () => {
    expect(whichBinary("nonexistent-binary-xyz-abc-123")).toBeNull();
  });

  it("should return null when PATH is empty", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      expect(whichBinary("node")).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

// ============================================================================
// hasEnv
// ============================================================================

describe("hasEnv", () => {
  it("should return true for a set non-empty env var", () => {
    process.env.WOPR_TEST_VAR = "hello";
    expect(hasEnv("WOPR_TEST_VAR")).toBe(true);
    delete process.env.WOPR_TEST_VAR;
  });

  it("should return false for an unset env var", () => {
    delete process.env.WOPR_NONEXISTENT_VAR;
    expect(hasEnv("WOPR_NONEXISTENT_VAR")).toBe(false);
  });

  it("should return false for an empty env var", () => {
    process.env.WOPR_EMPTY_VAR = "";
    expect(hasEnv("WOPR_EMPTY_VAR")).toBe(false);
    delete process.env.WOPR_EMPTY_VAR;
  });

  it("should return false for a whitespace-only env var", () => {
    process.env.WOPR_WHITESPACE_VAR = "   ";
    expect(hasEnv("WOPR_WHITESPACE_VAR")).toBe(false);
    delete process.env.WOPR_WHITESPACE_VAR;
  });

  it("should return true for PATH (always set)", () => {
    expect(hasEnv("PATH")).toBe(true);
  });
});

// ============================================================================
// hasDocker
// ============================================================================

describe("hasDocker", () => {
  it("should return a boolean based on docker binary availability", () => {
    const result = hasDocker();
    // We can't guarantee docker is installed, so just verify it returns boolean
    expect(typeof result).toBe("boolean");
  });
});

// ============================================================================
// resolveConfigPath
// ============================================================================

describe("resolveConfigPath", () => {
  it("should resolve a simple top-level key", () => {
    expect(resolveConfigPath({ key: "value" }, "key")).toBe("value");
  });

  it("should resolve a nested dot-notation path", () => {
    const config = { a: { b: { c: "deep" } } };
    expect(resolveConfigPath(config, "a.b.c")).toBe("deep");
  });

  it("should return undefined for missing path", () => {
    expect(resolveConfigPath({ a: 1 }, "b")).toBeUndefined();
  });

  it("should return undefined when config is undefined", () => {
    expect(resolveConfigPath(undefined, "a.b")).toBeUndefined();
  });

  it("should return undefined when path traverses through a non-object", () => {
    const config = { a: "string" };
    expect(resolveConfigPath(config, "a.b")).toBeUndefined();
  });

  it("should return undefined when path traverses through null", () => {
    const config = { a: null } as any;
    expect(resolveConfigPath(config, "a.b")).toBeUndefined();
  });

  it("should handle empty path parts from leading/trailing dots", () => {
    const config = { a: "value" };
    // filter(Boolean) strips empty parts from "a."
    expect(resolveConfigPath(config, "a.")).toBe("value");
  });

  it("should resolve to nested object", () => {
    const config = { a: { b: 42 } };
    expect(resolveConfigPath(config, "a")).toEqual({ b: 42 });
  });
});

// ============================================================================
// isConfigPathTruthy
// ============================================================================

describe("isConfigPathTruthy", () => {
  it("should return true for a truthy string", () => {
    expect(isConfigPathTruthy({ key: "hello" }, "key")).toBe(true);
  });

  it("should return false for an empty string", () => {
    expect(isConfigPathTruthy({ key: "" }, "key")).toBe(false);
  });

  it("should return false for a whitespace-only string", () => {
    expect(isConfigPathTruthy({ key: "   " }, "key")).toBe(false);
  });

  it("should return true for boolean true", () => {
    expect(isConfigPathTruthy({ key: true }, "key")).toBe(true);
  });

  it("should return false for boolean false", () => {
    expect(isConfigPathTruthy({ key: false }, "key")).toBe(false);
  });

  it("should return true for non-zero number", () => {
    expect(isConfigPathTruthy({ key: 42 }, "key")).toBe(true);
  });

  it("should return false for zero", () => {
    expect(isConfigPathTruthy({ key: 0 }, "key")).toBe(false);
  });

  it("should return false for undefined config", () => {
    expect(isConfigPathTruthy(undefined, "key")).toBe(false);
  });

  it("should return false for null value", () => {
    expect(isConfigPathTruthy({ key: null } as any, "key")).toBe(false);
  });

  it("should return false for missing key", () => {
    expect(isConfigPathTruthy({ other: "value" }, "key")).toBe(false);
  });

  it("should return true for an object value (truthy)", () => {
    expect(isConfigPathTruthy({ key: { nested: true } }, "key")).toBe(true);
  });

  it("should return true for an array value (truthy)", () => {
    expect(isConfigPathTruthy({ key: [1, 2, 3] } as any, "key")).toBe(true);
  });
});

// ============================================================================
// checkOsRequirement
// ============================================================================

describe("checkOsRequirement", () => {
  it("should return true when os is undefined", () => {
    expect(checkOsRequirement(undefined)).toBe(true);
  });

  it("should return true when os is empty array", () => {
    expect(checkOsRequirement([])).toBe(true);
  });

  it("should return true when current platform is in the list", () => {
    expect(checkOsRequirement([process.platform as "linux" | "darwin" | "win32"])).toBe(true);
  });

  it("should return false when current platform is not in the list", () => {
    // Use a platform that is definitely not the current one
    const otherPlatforms: Array<"linux" | "darwin" | "win32"> =
      process.platform === "linux" ? ["darwin", "win32"] : ["linux"];
    expect(checkOsRequirement(otherPlatforms)).toBe(false);
  });
});

// ============================================================================
// checkNodeRequirement
// ============================================================================

describe("checkNodeRequirement", () => {
  it("should return true when range is undefined", () => {
    expect(checkNodeRequirement(undefined)).toBe(true);
  });

  it("should return true when range is not parseable", () => {
    expect(checkNodeRequirement(">>>invalid")).toBe(true);
  });

  it("should return true when current node satisfies >=0.0.0", () => {
    expect(checkNodeRequirement(">=0.0.0")).toBe(true);
  });

  it("should return false when requiring a very high version", () => {
    expect(checkNodeRequirement(">=999.0.0")).toBe(false);
  });

  it("should handle current node version correctly", () => {
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    // Current version should satisfy itself
    expect(checkNodeRequirement(`>=${major}.${minor}.${patch}`)).toBe(true);
    // Current version should not satisfy next major
    expect(checkNodeRequirement(`>=${major + 1}.0.0`)).toBe(false);
  });
});

// ============================================================================
// checkRequirements
// ============================================================================

describe("checkRequirements", () => {
  it("should return satisfied when no requirements", async () => {
    const result = await checkRequirements(undefined);
    expect(result.satisfied).toBe(true);
    expect(result.missing.bins).toEqual([]);
    expect(result.missing.env).toEqual([]);
    expect(result.missing.docker).toEqual([]);
    expect(result.missing.config).toEqual([]);
  });

  it("should check binaries correctly", async () => {
    const result = await checkRequirements({
      bins: ["node", "nonexistent-binary-xyz-abc-123"],
    });

    expect(result.available.bins).toContain("node");
    expect(result.missing.bins).toContain("nonexistent-binary-xyz-abc-123");
    expect(result.satisfied).toBe(false);
  });

  it("should check environment variables", async () => {
    process.env.WOPR_CHECK_TEST = "value";
    try {
      const result = await checkRequirements({
        env: ["WOPR_CHECK_TEST", "WOPR_NONEXISTENT_CHECK"],
      });

      expect(result.available.env).toContain("WOPR_CHECK_TEST");
      expect(result.missing.env).toContain("WOPR_NONEXISTENT_CHECK");
      expect(result.satisfied).toBe(false);
    } finally {
      delete process.env.WOPR_CHECK_TEST;
    }
  });

  it("should check config paths with provided config", async () => {
    const config = { api: { key: "secret" }, empty: "" };
    const result = await checkRequirements(
      { config: ["api.key", "missing.path"] },
      config,
    );

    expect(result.available.config).toContain("api.key");
    expect(result.missing.config).toContain("missing.path");
    expect(result.satisfied).toBe(false);
  });

  it("should be satisfied when all requirements met", async () => {
    process.env.WOPR_ALL_MET_TEST = "yes";
    try {
      const result = await checkRequirements({
        bins: ["node"],
        env: ["WOPR_ALL_MET_TEST"],
      });

      expect(result.satisfied).toBe(true);
      expect(result.missing.bins).toEqual([]);
      expect(result.missing.env).toEqual([]);
    } finally {
      delete process.env.WOPR_ALL_MET_TEST;
    }
  });

  it("should handle empty requirement arrays", async () => {
    const result = await checkRequirements({
      bins: [],
      env: [],
      docker: [],
      config: [],
    });

    expect(result.satisfied).toBe(true);
  });
});

// ============================================================================
// formatMissingRequirements
// ============================================================================

describe("formatMissingRequirements", () => {
  it("should return 'All requirements satisfied' when nothing missing", () => {
    const result = formatMissingRequirements({
      satisfied: true,
      missing: { bins: [], env: [], docker: [], config: [] },
      available: { bins: ["node"], env: ["PATH"], docker: [], config: [] },
    });

    expect(result).toBe("All requirements satisfied");
  });

  it("should format missing binaries", () => {
    const result = formatMissingRequirements({
      satisfied: false,
      missing: { bins: ["ffmpeg", "sox"], env: [], docker: [], config: [] },
      available: { bins: [], env: [], docker: [], config: [] },
    });

    expect(result).toContain("Binaries: ffmpeg, sox");
  });

  it("should format missing environment variables", () => {
    const result = formatMissingRequirements({
      satisfied: false,
      missing: { bins: [], env: ["API_KEY"], docker: [], config: [] },
      available: { bins: [], env: [], docker: [], config: [] },
    });

    expect(result).toContain("Environment: API_KEY");
  });

  it("should format missing docker images", () => {
    const result = formatMissingRequirements({
      satisfied: false,
      missing: { bins: [], env: [], docker: ["redis:7"], config: [] },
      available: { bins: [], env: [], docker: [], config: [] },
    });

    expect(result).toContain("Docker images: redis:7");
  });

  it("should format missing config paths", () => {
    const result = formatMissingRequirements({
      satisfied: false,
      missing: { bins: [], env: [], docker: [], config: ["api.token"] },
      available: { bins: [], env: [], docker: [], config: [] },
    });

    expect(result).toContain("Config: api.token");
  });

  it("should format multiple categories together", () => {
    const result = formatMissingRequirements({
      satisfied: false,
      missing: { bins: ["ffmpeg"], env: ["KEY"], docker: ["redis:7"], config: ["x.y"] },
      available: { bins: [], env: [], docker: [], config: [] },
    });

    expect(result).toContain("Missing requirements:");
    expect(result).toContain("Binaries: ffmpeg");
    expect(result).toContain("Environment: KEY");
    expect(result).toContain("Docker images: redis:7");
    expect(result).toContain("Config: x.y");
  });
});

// ============================================================================
// runInstall
// ============================================================================

describe("runInstall", () => {
  it("should return failure for script install method (requires approval)", async () => {
    const result = await runInstall({ kind: "script", url: "https://example.com/install.sh" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("manual approval");
  });

  it("should return failure for manual install method", async () => {
    const result = await runInstall({ kind: "manual", instructions: "Follow the guide" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Manual installation required");
    expect(result.message).toContain("Follow the guide");
  });

  it("should return failure for unknown install method", async () => {
    const result = await runInstall({ kind: "unknown" } as any);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Unknown install method");
  });
});

// ============================================================================
// ensureRequirements
// ============================================================================

describe("ensureRequirements", () => {
  it("should return satisfied immediately when all requirements met", async () => {
    process.env.WOPR_ENSURE_TEST = "yes";
    try {
      const result = await ensureRequirements(
        { bins: ["node"], env: ["WOPR_ENSURE_TEST"] },
        undefined,
      );

      expect(result.satisfied).toBe(true);
      expect(result.installed).toEqual([]);
      expect(result.errors).toEqual([]);
    } finally {
      delete process.env.WOPR_ENSURE_TEST;
    }
  });

  it("should return unsatisfied with error when no install methods provided", async () => {
    const result = await ensureRequirements(
      { bins: ["nonexistent-binary-xyz-abc-123"] },
      undefined,
    );

    expect(result.satisfied).toBe(false);
    expect(result.errors).toContain("No install methods provided for missing dependencies");
  });

  it("should return unsatisfied with error when install methods is empty array", async () => {
    const result = await ensureRequirements(
      { bins: ["nonexistent-binary-xyz-abc-123"] },
      [],
    );

    expect(result.satisfied).toBe(false);
    expect(result.errors).toContain("No install methods provided for missing dependencies");
  });

  it("should return satisfied for undefined requirements", async () => {
    const result = await ensureRequirements(undefined, undefined);
    expect(result.satisfied).toBe(true);
  });
});
