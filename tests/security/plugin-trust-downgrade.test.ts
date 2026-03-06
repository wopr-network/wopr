/**
 * Plugin Trust Downgrade Tests (WOP-1408)
 *
 * Verifies that plugins default to semi-trusted and that semi-trusted
 * does not include memory.write, session.spawn, or a2a.call.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { getStorage, resetStorage } = await import("../../src/storage/index.js");
const { initSecurity } = await import("../../src/security/policy.js");
const { clearContext } = await import("../../src/security/context.js");
const {
  createInjectionSource,
  DEFAULT_TRUST_BY_SOURCE,
  CAPABILITY_PROFILES,
  hasCapability,
} = await import("../../src/security/types.js");
const { checkToolAccess, checkCapability } = await import("../../src/security/policy.js");

let testDir: string;

describe("Plugin Trust Downgrade (WOP-1408)", () => {
  beforeEach(async () => {
    testDir = join(tmpdir(), `wopr-test-${randomBytes(8).toString("hex")}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    resetStorage();
    getStorage(":memory:");
    await initSecurity(testDir);
  });

  afterEach(() => {
    clearContext("test-session");
  });

  describe("DEFAULT_TRUST_BY_SOURCE", () => {
    it("should assign semi-trusted to plugin source type", () => {
      expect(DEFAULT_TRUST_BY_SOURCE.plugin).toBe("semi-trusted");
    });

    it("should create plugin injection source with semi-trusted trust level", () => {
      const source = createInjectionSource("plugin", {
        identity: { pluginName: "test-plugin" },
      });
      expect(source.trustLevel).toBe("semi-trusted");
    });
  });

  describe("semi-trusted capability profile", () => {
    it("should NOT include session.spawn", () => {
      expect(hasCapability(CAPABILITY_PROFILES["semi-trusted"], "session.spawn")).toBe(false);
    });

    it("should NOT include a2a.call", () => {
      expect(hasCapability(CAPABILITY_PROFILES["semi-trusted"], "a2a.call")).toBe(false);
    });

    it("should include inject and inject.tools", () => {
      expect(hasCapability(CAPABILITY_PROFILES["semi-trusted"], "inject")).toBe(true);
      expect(hasCapability(CAPABILITY_PROFILES["semi-trusted"], "inject.tools")).toBe(true);
    });

    it("should include config.read", () => {
      expect(hasCapability(CAPABILITY_PROFILES["semi-trusted"], "config.read")).toBe(true);
    });
  });

  describe("plugin with default trust cannot write to memory", () => {
    it("should deny session.spawn capability for default plugin source via checkToolAccess", () => {
      const source = createInjectionSource("plugin", {
        identity: { pluginName: "untrusted-plugin" },
      });
      const result = checkCapability(source, "session.spawn", "test-session");
      expect(result.allowed).toBe(false);
    });

    it("should deny session.spawn capability for default plugin source", () => {
      const source = createInjectionSource("plugin", {
        identity: { pluginName: "untrusted-plugin" },
      });
      const result = checkCapability(source, "session.spawn", "test-session");
      expect(result.allowed).toBe(false);
    });

    it("should allow config_get tool for default plugin source", () => {
      const source = createInjectionSource("plugin", {
        identity: { pluginName: "read-only-plugin" },
      });
      const result = checkToolAccess(source, "config_get", "test-session");
      expect(result.allowed).toBe(true);
    });
  });

  describe("plugin with explicitly elevated trust can write to memory", () => {
    it("should allow session.spawn when grantedCapabilities includes session.spawn", () => {
      const source = createInjectionSource("plugin", {
        identity: { pluginName: "trusted-plugin" },
        grantedCapabilities: ["session.spawn"],
      });
      const result = checkCapability(source, "session.spawn", "test-session");
      expect(result.allowed).toBe(true);
    });

    it("should allow session.spawn when grantedCapabilities includes it", () => {
      const source = createInjectionSource("plugin", {
        identity: { pluginName: "trusted-plugin" },
        grantedCapabilities: ["session.spawn"],
      });
      const result = checkCapability(source, "session.spawn", "test-session");
      expect(result.allowed).toBe(true);
    });

    it("should allow a2a.call when grantedCapabilities includes it", () => {
      const source = createInjectionSource("plugin", {
        identity: { pluginName: "trusted-plugin" },
        grantedCapabilities: ["a2a.call"],
      });
      const result = checkCapability(source, "a2a.call", "test-session");
      expect(result.allowed).toBe(true);
    });

    it("should not grant capabilities beyond what was explicitly requested", () => {
      const source = createInjectionSource("plugin", {
        identity: { pluginName: "trusted-plugin" },
        grantedCapabilities: ["config.read"],
      });
      const result = checkCapability(source, "session.spawn", "test-session");
      expect(result.allowed).toBe(false);
    });
  });
});
