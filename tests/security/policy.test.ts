/**
 * Security Policy Module Tests (WOP-84)
 *
 * Tests policy resolution, enforcement checks, session access,
 * capability checking, tool access, and edge cases.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the logger to suppress output during tests
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import storage functions
const { getStorage, resetStorage } = await import("../../src/storage/index.js");

// Import after mocks are set up
const {
  initSecurity,
  getSecurityConfig,
  getSecurityConfigAsync,
  saveSecurityConfig,
  resolvePolicy,
  checkSessionAccess,
  checkCapability,
  checkToolAccess,
  checkSandboxRequired,
  filterToolsByPolicy,
  isEnforcementEnabled,
  shouldLogSecurityEvent,
  sessionAllowsUntrusted,
  isGatewaySession,
  getGatewayRules,
  canSessionForward,
  canGatewayForward,
} = await import("../../src/security/policy.js");

const { createInjectionSource, DEFAULT_SECURITY_CONFIG } = await import(
  "../../src/security/types.js"
);

import type { InjectionSource, SecurityConfig } from "../../src/security/types.js";

// ============================================================================
// Helpers
// ============================================================================

let testDir: string;

function makeSource(
  type: InjectionSource["type"],
  overrides?: Partial<InjectionSource>,
): InjectionSource {
  return createInjectionSource(type, overrides);
}

async function setSecurityConfig(config: Partial<SecurityConfig>): Promise<void> {
  const full = {
    ...DEFAULT_SECURITY_CONFIG,
    ...config,
  };
  await saveSecurityConfig(full);
}

// ============================================================================
// Tests
// ============================================================================

describe("Security Policy Module", () => {
  beforeEach(async () => {
    // Create temp directory for test database
    testDir = join(tmpdir(), `wopr-test-${randomBytes(8).toString("hex")}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Reset storage and initialize security
    resetStorage();
    const storage = getStorage(join(testDir, "test.sqlite"));
    await initSecurity(testDir);
  });

  afterEach(() => {
    resetStorage();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Config Loading
  // ==========================================================================
  describe("getSecurityConfig", () => {
    it("should return default config when no security.json exists", async () => {
      const config = getSecurityConfig();
      expect(config.enforcement).toBe("enforce");
      expect(config.defaults.minTrustLevel).toBe("semi-trusted");
    });

    it("should load and merge config from security.json", async () => {
      await setSecurityConfig({ enforcement: "enforce" });

      const config = await getSecurityConfigAsync();
      expect(config.enforcement).toBe("enforce");
      // Defaults should still be merged
      expect(config.defaults).toBeDefined();
    });

    it("should cache loaded config on subsequent calls", async () => {
      await setSecurityConfig({ enforcement: "enforce" });

      const config1 = getSecurityConfig();
      const config2 = getSecurityConfig();
      expect(config1).toBe(config2); // Same reference (cached)
    });

    it("should return default config when not initialized", async () => {
      // Before init, should return defaults
      const config = getSecurityConfig();
      expect(config.enforcement).toBe("enforce"); // Falls back to default
    });
  });

  describe("saveSecurityConfig", () => {
    it("should save config to SQL", async () => {
      const config = { ...DEFAULT_SECURITY_CONFIG, enforcement: "enforce" as const };
      await saveSecurityConfig(config);

      const saved = await getSecurityConfigAsync();
      expect(saved.enforcement).toBe("enforce");
    });

    it("should update the cached config", async () => {
      const config = { ...DEFAULT_SECURITY_CONFIG, enforcement: "off" as const };
      await saveSecurityConfig(config);
      const saved = getSecurityConfig();
      expect(saved.enforcement).toBe("off");
    });
  });

  // ==========================================================================
  // Policy Resolution
  // ==========================================================================
  describe("resolvePolicy", () => {
    it("should resolve owner trust level with wildcard capabilities", async () => {
      const source = makeSource("cli"); // owner trust
      const policy = resolvePolicy(source);

      expect(policy.trustLevel).toBe("owner");
      expect(policy.capabilities).toContain("*");
    });

    it("should resolve trusted with appropriate capability set", async () => {
      const source = makeSource("plugin"); // trusted
      const policy = resolvePolicy(source);

      expect(policy.trustLevel).toBe("trusted");
      expect(policy.capabilities).toContain("inject");
      expect(policy.capabilities).toContain("inject.tools");
      expect(policy.capabilities).toContain("session.spawn");
    });

    it("should resolve semi-trusted with limited capabilities", async () => {
      const source = makeSource("api"); // semi-trusted
      const policy = resolvePolicy(source);

      expect(policy.trustLevel).toBe("semi-trusted");
      expect(policy.capabilities).toContain("inject");
      expect(policy.capabilities).not.toContain("config.write");
      expect(policy.capabilities).not.toContain("memory.write");
    });

    it("should resolve untrusted with minimal capabilities", async () => {
      const source = makeSource("p2p"); // untrusted
      const policy = resolvePolicy(source);

      expect(policy.trustLevel).toBe("untrusted");
      expect(policy.capabilities).toEqual(["inject"]);
    });

    it("should merge granted capabilities with base capabilities", async () => {
      const source = makeSource("p2p", {
        grantedCapabilities: ["memory.read", "session.history"],
      });
      const policy = resolvePolicy(source);

      expect(policy.capabilities).toContain("inject");
      expect(policy.capabilities).toContain("memory.read");
      expect(policy.capabilities).toContain("session.history");
    });

    it("should not duplicate granted capabilities already in base set", async () => {
      const source = makeSource("p2p", {
        grantedCapabilities: ["inject"], // already in untrusted base
      });
      const policy = resolvePolicy(source);

      const injectCount = policy.capabilities.filter((c) => c === "inject").length;
      expect(injectCount).toBe(1);
    });

    it("should apply sandbox defaults by trust level", async () => {
      const untrustedSource = makeSource("p2p");
      const untrustedPolicy = resolvePolicy(untrustedSource);
      expect(untrustedPolicy.sandbox.enabled).toBe(true);
      expect(untrustedPolicy.sandbox.network).toBe("none");

      const ownerSource = makeSource("cli");
      const ownerPolicy = resolvePolicy(ownerSource);
      expect(ownerPolicy.sandbox.enabled).toBe(false);
    });

    it("should apply rate limits from defaults", async () => {
      const source = makeSource("api");
      const policy = resolvePolicy(source);

      expect(policy.rateLimit.perMinute).toBeGreaterThan(0);
      expect(policy.rateLimit.perHour).toBeGreaterThan(0);
    });

    it("should apply trust level rate limit overrides", async () => {
      await setSecurityConfig({
        trustLevels: {
          "semi-trusted": {
            capabilities: ["inject"],
            rateLimit: { perMinute: 10, perHour: 100 },
          },
        },
      });

      const source = makeSource("api");
      const policy = resolvePolicy(source);

      expect(policy.rateLimit.perMinute).toBe(10);
      expect(policy.rateLimit.perHour).toBe(100);
    });

    it("should resolve session access from trust level policy", async () => {
      await setSecurityConfig({
        trustLevels: {
          untrusted: {
            capabilities: ["inject"],
            sessions: {
              allowed: ["public-session"],
              blocked: ["admin-session"],
            },
          },
        },
      });

      const source = makeSource("p2p");
      const policy = resolvePolicy(source);

      expect(policy.allowedSessions).toEqual(["public-session"]);
      expect(policy.blockedSessions).toEqual(["admin-session"]);
    });

    it("should default to wildcard session access when no restrictions", async () => {
      const source = makeSource("cli");
      const policy = resolvePolicy(source);

      expect(policy.allowedSessions).toBe("*");
      expect(policy.blockedSessions).toEqual([]);
    });

    it("should detect gateway sessions", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["discord-gateway"],
          forwardRules: {
            "discord-gateway": {
              allowForwardTo: ["main"],
              allowActions: ["inject"],
            },
          },
        },
      });

      const source = makeSource("api");
      const policy = resolvePolicy(source, "discord-gateway");

      expect(policy.isGateway).toBe(true);
      expect(policy.forwardRules).toBeDefined();
      expect(policy.forwardRules!.allowForwardTo).toContain("main");
    });

    it("should set canForward when gateway and has cross.inject", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["gateway-session"],
        },
        trustLevels: {
          trusted: {
            capabilities: ["inject", "cross.inject"],
          },
        },
      });

      const source = makeSource("plugin"); // trusted
      const policy = resolvePolicy(source, "gateway-session");

      expect(policy.isGateway).toBe(true);
      expect(policy.canForward).toBe(true);
    });

    it("should not canForward when gateway but no cross.inject", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["gateway-session"],
        },
      });

      const source = makeSource("p2p"); // untrusted - no cross.inject
      const policy = resolvePolicy(source, "gateway-session");

      expect(policy.isGateway).toBe(true);
      expect(policy.canForward).toBe(false);
    });
  });

  // ==========================================================================
  // Session Access Checks
  // ==========================================================================
  describe("checkSessionAccess", () => {
    it("should allow owner to access any session", async () => {
      const source = makeSource("cli");
      const result = checkSessionAccess(source, "any-session");

      expect(result.allowed).toBe(true);
    });

    it("should deny untrusted below minimum trust level", async () => {
      await setSecurityConfig({
        defaults: {
          ...DEFAULT_SECURITY_CONFIG.defaults,
          minTrustLevel: "trusted",
        },
      });

      const source = makeSource("p2p"); // untrusted
      const result = checkSessionAccess(source, "any-session");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Trust level");
      expect(result.reason).toContain("below minimum");
    });

    it("should deny access to blocked sessions", async () => {
      await setSecurityConfig({
        trustLevels: {
          untrusted: {
            capabilities: ["inject"],
            sessions: {
              blocked: ["private-session"],
            },
          },
        },
        defaults: {
          ...DEFAULT_SECURITY_CONFIG.defaults,
          minTrustLevel: "untrusted",
        },
        defaultAccess: ["trust:untrusted"],
      });

      const source = makeSource("p2p");
      const result = checkSessionAccess(source, "private-session");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("blocked");
    });

    it("should deny access when session not in allowed list", async () => {
      await setSecurityConfig({
        trustLevels: {
          untrusted: {
            capabilities: ["inject"],
            sessions: {
              allowed: ["public-only"],
            },
          },
        },
        defaults: {
          ...DEFAULT_SECURITY_CONFIG.defaults,
          minTrustLevel: "untrusted",
        },
        defaultAccess: ["trust:untrusted"],
      });

      const source = makeSource("p2p");
      const result = checkSessionAccess(source, "not-in-list");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not in allowed list");
    });

    it("should allow access when session is in allowed list and matches access patterns", async () => {
      await setSecurityConfig({
        trustLevels: {
          "semi-trusted": {
            capabilities: ["inject"],
            sessions: {
              allowed: ["api-session"],
            },
          },
        },
        defaults: {
          ...DEFAULT_SECURITY_CONFIG.defaults,
          minTrustLevel: "semi-trusted",
        },
        sessions: {
          "api-session": {
            access: ["trust:semi-trusted"],
          },
        },
      });

      const source = makeSource("api");
      const result = checkSessionAccess(source, "api-session");

      expect(result.allowed).toBe(true);
    });

    it("should deny when source does not match session access patterns", async () => {
      await setSecurityConfig({
        defaults: {
          ...DEFAULT_SECURITY_CONFIG.defaults,
          minTrustLevel: "untrusted",
        },
        sessions: {
          "owner-only": {
            access: ["trust:owner"],
          },
        },
      });

      const source = makeSource("api"); // semi-trusted, not owner
      const result = checkSessionAccess(source, "owner-only");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("does not match access rules");
    });
  });

  // ==========================================================================
  // Capability Checks
  // ==========================================================================
  describe("checkCapability", () => {
    it("should allow owner all capabilities via wildcard", async () => {
      const source = makeSource("cli");
      const result = checkCapability(source, "config.write");

      expect(result.allowed).toBe(true);
    });

    it("should allow trusted sources their granted capabilities", async () => {
      const source = makeSource("plugin");
      const result = checkCapability(source, "inject.tools");

      expect(result.allowed).toBe(true);
    });

    it("should deny untrusted sources capabilities they don't have", async () => {
      const source = makeSource("p2p");
      const result = checkCapability(source, "config.write");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not granted");
    });

    it("should allow explicitly granted capabilities to override base", async () => {
      const source = makeSource("p2p", {
        grantedCapabilities: ["memory.read"],
      });
      const result = checkCapability(source, "memory.read");

      expect(result.allowed).toBe(true);
    });

    it("should check parent capability (inject grants inject.tools)", async () => {
      // Semi-trusted has "inject" which should grant "inject.tools" via parent check
      const source = makeSource("api");
      const result = checkCapability(source, "inject.tools");

      expect(result.allowed).toBe(true);
    });

    it("should deny capabilities with no parent match", async () => {
      const source = makeSource("p2p"); // only has "inject"
      const result = checkCapability(source, "config.read");

      expect(result.allowed).toBe(false);
    });
  });

  // ==========================================================================
  // Tool Access Checks
  // ==========================================================================
  describe("checkToolAccess", () => {
    it("should allow owner access to all tools", async () => {
      const source = makeSource("cli");
      const result = checkToolAccess(source, "config_set");

      expect(result.allowed).toBe(true);
    });

    it("should deny explicitly denied tools", async () => {
      await setSecurityConfig({
        enforcement: "enforce",
        trustLevels: {
          "semi-trusted": {
            capabilities: ["inject"],
            tools: { deny: ["dangerous_tool"] },
          },
        },
      });

      const source = makeSource("api");
      const result = checkToolAccess(source, "dangerous_tool");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("denied");
    });

    it("should allow explicitly allowed tools even when wildcard deny", async () => {
      await setSecurityConfig({
        enforcement: "enforce",
        trustLevels: {
          untrusted: {
            capabilities: ["inject"],
            tools: { deny: ["*"], allow: ["security_whoami"] },
          },
        },
      });

      const source = makeSource("p2p");
      const result = checkToolAccess(source, "security_whoami");

      expect(result.allowed).toBe(true);
    });

    it("should return warning instead of deny in warn mode", async () => {
      await setSecurityConfig({
        enforcement: "warn",
        trustLevels: {
          untrusted: {
            capabilities: ["inject"],
            tools: { deny: ["dangerous_tool"] },
          },
        },
      });

      const source = makeSource("p2p");
      const result = checkToolAccess(source, "dangerous_tool");

      expect(result.allowed).toBe(true);
      expect(result.warning).toContain("warn mode");
    });

    it("should deny tools requiring capabilities the source lacks", async () => {
      await setSecurityConfig({ enforcement: "enforce" });

      const source = makeSource("p2p"); // untrusted, only has "inject"
      // http_fetch requires inject.network, but untrusted has deny: ["*"]
      // so it gets denied by tool policy first
      const result = checkToolAccess(source, "http_fetch");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("denied");
    });

    it("should warn about missing capability in warn mode", async () => {
      await setSecurityConfig({ enforcement: "warn" });
      const source = makeSource("p2p");
      const result = checkToolAccess(source, "http_fetch");

      expect(result.allowed).toBe(true);
      expect(result.warning).toContain("warn mode");
    });

    it("should allow tools with no capability requirement", async () => {
      await setSecurityConfig({ enforcement: "warn" });
      const source = makeSource("p2p");
      // A tool not in the TOOL_CAPABILITY_MAP has no requirement
      const result = checkToolAccess(source, "unknown_tool");

      // Not in deny list for untrusted? Check default config
      // Default untrusted has tools: { deny: ["*"] }
      // With warn mode, this should warn
      expect(result.allowed).toBe(true); // warn mode
      expect(result.warning).toBeDefined();
    });
  });

  // ==========================================================================
  // Sandbox Checks
  // ==========================================================================
  describe("checkSandboxRequired", () => {
    it("should not require sandbox for owner", async () => {
      const source = makeSource("cli");
      const result = checkSandboxRequired(source);

      expect(result).toBeNull();
    });

    it("should not require sandbox for trusted", async () => {
      const source = makeSource("plugin");
      const result = checkSandboxRequired(source);

      expect(result).toBeNull();
    });

    it("should require sandbox for semi-trusted", async () => {
      const source = makeSource("api");
      const result = checkSandboxRequired(source);

      expect(result).not.toBeNull();
      expect(result!.enabled).toBe(true);
      expect(result!.network).toBe("bridge");
    });

    it("should require sandbox for untrusted with stricter config", async () => {
      const source = makeSource("p2p");
      const result = checkSandboxRequired(source);

      expect(result).not.toBeNull();
      expect(result!.enabled).toBe(true);
      expect(result!.network).toBe("none");
    });
  });

  // ==========================================================================
  // Tool Filtering
  // ==========================================================================
  describe("filterToolsByPolicy", () => {
    it("should return all tools for owner", async () => {
      const source = makeSource("cli");
      const tools = ["config_set", "http_fetch", "exec_command", "memory_write"];
      const filtered = filterToolsByPolicy(source, tools);

      expect(filtered).toEqual(tools);
    });

    it("should filter denied tools in enforce mode", async () => {
      await setSecurityConfig({
        enforcement: "enforce",
        trustLevels: {
          untrusted: {
            capabilities: ["inject"],
            tools: { deny: ["*"], allow: ["security_whoami"] },
          },
        },
      });

      const source = makeSource("p2p");
      const tools = ["security_whoami", "config_set", "http_fetch"];
      const filtered = filterToolsByPolicy(source, tools);

      expect(filtered).toContain("security_whoami");
      expect(filtered).not.toContain("config_set");
      expect(filtered).not.toContain("http_fetch");
    });

    it("should filter tools denied by wildcard even in warn mode", async () => {
      // Default untrusted has tools: { deny: ["*"] }
      // filterToolsByPolicy checks deny list first - deny list is enforced
      // even in warn mode (warn mode only applies to capability checks)
      await setSecurityConfig({ enforcement: "warn" });
      const source = makeSource("p2p");
      const tools = ["http_fetch", "security_whoami"];
      const filtered = filterToolsByPolicy(source, tools);

      // Untrusted has deny: ["*"] with no allow list, so all filtered out
      expect(filtered).toEqual([]);
    });
  });

  // ==========================================================================
  // Enforcement Mode
  // ==========================================================================
  describe("isEnforcementEnabled", () => {
    it("should return true for default config (enforce mode)", async () => {
      expect(isEnforcementEnabled()).toBe(true);
    });

    it("should return true when enforcement is 'enforce'", async () => {
      await setSecurityConfig({ enforcement: "enforce" });
      const result = isEnforcementEnabled();
      expect(result).toBe(true);
    });

    it("should return false when enforcement is 'off'", async () => {
      await setSecurityConfig({ enforcement: "off" });
      expect(isEnforcementEnabled()).toBe(false);
    });
  });

  // ==========================================================================
  // WOPR_SECURITY_ENFORCEMENT env var override
  // ==========================================================================
  describe("WOPR_SECURITY_ENFORCEMENT env var override", () => {
    afterEach(() => {
      delete process.env.WOPR_SECURITY_ENFORCEMENT;
    });

    it("should override stored config enforcement to 'warn' via env var", async () => {
      // Default is now 'enforce', override to 'warn'
      process.env.WOPR_SECURITY_ENFORCEMENT = "warn";
      const config = getSecurityConfig();
      expect(config.enforcement).toBe("warn");
    });

    it("should override stored config enforcement to 'off' via env var", async () => {
      process.env.WOPR_SECURITY_ENFORCEMENT = "off";
      const config = getSecurityConfig();
      expect(config.enforcement).toBe("off");
    });

    it("should override stored config enforcement to 'enforce' via env var", async () => {
      // Save config as 'warn', then override to 'enforce'
      await setSecurityConfig({ enforcement: "warn" });
      process.env.WOPR_SECURITY_ENFORCEMENT = "enforce";
      const config = getSecurityConfig();
      expect(config.enforcement).toBe("enforce");
    });

    it("should ignore invalid env var values", async () => {
      process.env.WOPR_SECURITY_ENFORCEMENT = "invalid";
      const config = getSecurityConfig();
      // Should return the stored/default value, not the invalid one
      expect(config.enforcement).toBe("enforce"); // new default
    });

    it("should not persist env var override to async config", async () => {
      process.env.WOPR_SECURITY_ENFORCEMENT = "warn";
      const asyncConfig = await getSecurityConfigAsync();
      // Async config should NOT have the env override applied
      expect(asyncConfig.enforcement).toBe("enforce"); // stored default
    });
  });

  // ==========================================================================
  // Audit Logging
  // ==========================================================================
  describe("shouldLogSecurityEvent", () => {
    it("should log denied events when audit.logDenied is true", async () => {
      await setSecurityConfig({
        audit: { enabled: true, logDenied: true, logSuccess: false },
      });
      expect(shouldLogSecurityEvent(false)).toBe(true);
    });

    it("should not log success events when audit.logSuccess is false", async () => {
      await setSecurityConfig({
        audit: { enabled: true, logDenied: true, logSuccess: false },
      });
      expect(shouldLogSecurityEvent(true)).toBe(false);
    });

    it("should log success events when audit.logSuccess is true", async () => {
      await setSecurityConfig({
        audit: { enabled: true, logDenied: true, logSuccess: true },
      });
      expect(shouldLogSecurityEvent(true)).toBe(true);
    });

    it("should not log anything when audit is disabled", async () => {
      await setSecurityConfig({
        audit: { enabled: false, logDenied: true, logSuccess: true },
      });
      expect(shouldLogSecurityEvent(true)).toBe(false);
      expect(shouldLogSecurityEvent(false)).toBe(false);
    });
  });

  // ==========================================================================
  // Session Access Helpers
  // ==========================================================================
  describe("sessionAllowsUntrusted", () => {
    it("should return true for sessions with wildcard access", async () => {
      await setSecurityConfig({
        sessions: {
          "open-session": { access: ["*"] },
        },
      });

      expect(sessionAllowsUntrusted("open-session")).toBe(true);
    });

    it("should return true for sessions with trust:untrusted access", async () => {
      await setSecurityConfig({
        sessions: {
          "public-session": { access: ["trust:untrusted"] },
        },
      });

      expect(sessionAllowsUntrusted("public-session")).toBe(true);
    });

    it("should return false for sessions with only trusted access", async () => {
      await setSecurityConfig({
        sessions: {
          "private-session": { access: ["trust:trusted"] },
        },
      });

      expect(sessionAllowsUntrusted("private-session")).toBe(false);
    });

    it("should return false for sessions with default access", async () => {
      // Default access is trust:trusted
      expect(sessionAllowsUntrusted("default-session")).toBe(false);
    });
  });

  describe("isGatewaySession (deprecated)", () => {
    it("should return true for sessions in legacy gateways config", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["discord-gw"],
        },
      });

      expect(isGatewaySession("discord-gw")).toBe(true);
    });

    it("should return true for sessions allowing untrusted access (new pattern)", async () => {
      await setSecurityConfig({
        sessions: {
          "public-gw": { access: ["trust:untrusted"] },
        },
      });

      expect(isGatewaySession("public-gw")).toBe(true);
    });

    it("should return false for non-gateway sessions", async () => {
      expect(isGatewaySession("normal-session")).toBe(false);
    });
  });

  describe("getGatewayRules (deprecated)", () => {
    it("should return forward rules for configured gateways", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["my-gw"],
          forwardRules: {
            "my-gw": {
              allowForwardTo: ["main", "backup"],
              allowActions: ["inject"],
              requireApproval: true,
            },
          },
        },
      });

      const rules = getGatewayRules("my-gw");
      expect(rules).toBeDefined();
      expect(rules!.allowForwardTo).toEqual(["main", "backup"]);
      expect(rules!.requireApproval).toBe(true);
    });

    it("should return undefined for sessions without forward rules", async () => {
      expect(getGatewayRules("no-rules")).toBeUndefined();
    });
  });

  // ==========================================================================
  // Session Forwarding
  // ==========================================================================
  describe("canSessionForward", () => {
    it("should deny when source session lacks cross.inject capability", async () => {
      await setSecurityConfig({
        sessions: {
          "no-forward": { capabilities: ["inject"] },
        },
      });

      const source = makeSource("api");
      const result = canSessionForward("no-forward", "target", source);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cross.inject");
    });

    it("should allow when source session has cross.inject and target is accessible", async () => {
      await setSecurityConfig({
        defaults: {
          ...DEFAULT_SECURITY_CONFIG.defaults,
          minTrustLevel: "untrusted",
        },
        sessions: {
          "gateway-session": { capabilities: ["inject", "cross.inject"] },
          "target-session": { access: ["trust:semi-trusted"] },
        },
      });

      const source = makeSource("api"); // semi-trusted
      const result = canSessionForward("gateway-session", "target-session", source);

      expect(result.allowed).toBe(true);
    });
  });

  describe("canGatewayForward (deprecated)", () => {
    it("should allow forwarding based on legacy gateway rules", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["legacy-gw"],
          forwardRules: {
            "legacy-gw": {
              allowForwardTo: ["main-session"],
              allowActions: ["inject"],
            },
          },
        },
      });

      const result = canGatewayForward("legacy-gw", "main-session");
      expect(result.allowed).toBe(true);
    });

    it("should deny forwarding to non-allowed targets", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["legacy-gw"],
          forwardRules: {
            "legacy-gw": {
              allowForwardTo: ["main-session"],
            },
          },
        },
      });

      const result = canGatewayForward("legacy-gw", "secret-session");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cannot forward");
    });

    it("should deny non-allowed actions", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["legacy-gw"],
          forwardRules: {
            "legacy-gw": {
              allowForwardTo: ["main-session"],
              allowActions: ["inject"],
            },
          },
        },
      });

      const result = canGatewayForward("legacy-gw", "main-session", "exec_command");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not allowed");
    });

    it("should allow wildcard forward targets", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["wildcard-gw"],
          forwardRules: {
            "wildcard-gw": {
              allowForwardTo: ["*"],
            },
          },
        },
      });

      const result = canGatewayForward("wildcard-gw", "any-session");
      expect(result.allowed).toBe(true);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe("Edge Cases", () => {
    it("should handle missing trust level policy gracefully", async () => {
      await setSecurityConfig({
        trustLevels: {}, // No trust level policies defined
      });

      const source = makeSource("p2p");
      const policy = resolvePolicy(source);

      // Should fall back to defaults
      expect(policy.trustLevel).toBe("untrusted");
      expect(policy.capabilities).toBeDefined();
    });

    it("should handle conflicting allow and deny tool lists", async () => {
      await setSecurityConfig({
        enforcement: "enforce",
        trustLevels: {
          "semi-trusted": {
            capabilities: ["inject", "inject.network"],
            tools: {
              deny: ["http_fetch"],
              allow: ["http_fetch"], // Explicitly allowed overrides deny
            },
          },
        },
      });

      const source = makeSource("api");
      const result = checkToolAccess(source, "http_fetch");

      expect(result.allowed).toBe(true);
    });

    it("should handle privilege escalation attempt (untrusted trying owner caps)", async () => {
      await setSecurityConfig({ enforcement: "enforce" });

      const source = makeSource("p2p"); // untrusted, only has "inject"
      const configWrite = checkCapability(source, "config.write");
      const crossInject = checkCapability(source, "cross.inject");
      const sessionSpawn = checkCapability(source, "session.spawn");
      const memoryWrite = checkCapability(source, "memory.write");

      expect(configWrite.allowed).toBe(false);
      expect(crossInject.allowed).toBe(false);
      expect(sessionSpawn.allowed).toBe(false);
      expect(memoryWrite.allowed).toBe(false);

      // Note: inject.exec IS allowed because "inject" parent grants inject.*
      // This is by design - the parent capability model means "inject" grants all inject sub-caps
      const execCmd = checkCapability(source, "inject.exec");
      expect(execCmd.allowed).toBe(true);
    });

    it("should prevent untrusted from spawning sessions", async () => {
      const source = makeSource("p2p");
      const result = checkCapability(source, "session.spawn");

      expect(result.allowed).toBe(false);
    });

    it("should handle multiple granted capabilities correctly", async () => {
      const source = makeSource("p2p", {
        grantedCapabilities: ["memory.read", "session.history", "config.read"],
      });

      const policy = resolvePolicy(source);
      expect(policy.capabilities).toContain("memory.read");
      expect(policy.capabilities).toContain("session.history");
      expect(policy.capabilities).toContain("config.read");
      expect(policy.capabilities).toContain("inject"); // base
      // Should NOT have escalated capabilities
      expect(policy.capabilities).not.toContain("config.write");
      expect(policy.capabilities).not.toContain("*");
    });

    it("should apply sandbox overrides from trust level policy", async () => {
      await setSecurityConfig({
        trustLevels: {
          "semi-trusted": {
            capabilities: ["inject"],
            sandbox: {
              enabled: true,
              network: "none", // Override default "bridge"
              memoryLimit: "128m",
            },
          },
        },
      });

      const source = makeSource("api");
      const policy = resolvePolicy(source);

      expect(policy.sandbox.network).toBe("none");
      expect(policy.sandbox.memoryLimit).toBe("128m");
    });

    it("should apply tool policy overrides from trust level", async () => {
      await setSecurityConfig({
        enforcement: "enforce",
        trustLevels: {
          trusted: {
            capabilities: ["inject", "inject.tools", "config.read"],
            tools: {
              deny: ["exec_command"],
              allow: ["config_get"],
            },
          },
        },
      });

      const source = makeSource("plugin"); // trusted
      const denied = checkToolAccess(source, "exec_command");
      expect(denied.allowed).toBe(false);

      // config_get requires config.read capability (included above) and is in allow list
      const allowed = checkToolAccess(source, "config_get");
      expect(allowed.allowed).toBe(true);
    });
  });
});
