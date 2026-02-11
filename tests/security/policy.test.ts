/**
 * Security Policy Module Tests (WOP-84)
 *
 * Tests policy resolution, enforcement checks, session access,
 * capability checking, tool access, and edge cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockFs } from "../mocks/index.js";

// Mock the logger to suppress output during tests
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Set up filesystem mock before importing policy module
const mockFs = createMockFs();

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    existsSync: (p: string) => mockFs.existsSync(p),
    readFileSync: (p: string, enc?: string) => mockFs.readFileSync(p, enc),
    writeFileSync: (p: string, content: string) => mockFs.writeFileSync(p, content),
  };
});

// Import after mocks are set up
const {
  initSecurity,
  getSecurityConfig,
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

const {
  createInjectionSource,
  DEFAULT_SECURITY_CONFIG,
} = await import("../../src/security/types.js");

import type { InjectionSource, SecurityConfig } from "../../src/security/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeSource(type: InjectionSource["type"], overrides?: Partial<InjectionSource>): InjectionSource {
  return createInjectionSource(type, overrides);
}

function setSecurityConfig(config: Partial<SecurityConfig>): void {
  const full = {
    ...DEFAULT_SECURITY_CONFIG,
    ...config,
  };
  mockFs.set("/mock/wopr/security.json", JSON.stringify(full));
}

// ============================================================================
// Tests
// ============================================================================

describe("Security Policy Module", () => {
  beforeEach(() => {
    mockFs.clear();
    // Reset cached config by re-initializing
    initSecurity("/mock/wopr");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Config Loading
  // ==========================================================================
  describe("getSecurityConfig", () => {
    it("should return default config when no security.json exists", () => {
      const config = getSecurityConfig();
      expect(config.enforcement).toBe("warn");
      expect(config.defaults.minTrustLevel).toBe("semi-trusted");
    });

    it("should load and merge config from security.json", () => {
      setSecurityConfig({ enforcement: "enforce" });

      const config = getSecurityConfig();
      expect(config.enforcement).toBe("enforce");
      // Defaults should still be merged
      expect(config.defaults).toBeDefined();
    });

    it("should cache loaded config on subsequent calls", () => {
      setSecurityConfig({ enforcement: "enforce" });

      const config1 = getSecurityConfig();
      const config2 = getSecurityConfig();
      expect(config1).toBe(config2); // Same reference (cached)
    });

    it("should return default config when security.json is invalid JSON", () => {
      mockFs.set("/mock/wopr/security.json", "not valid json{{{");

      const config = getSecurityConfig();
      expect(config.enforcement).toBe("warn"); // Falls back to default
    });
  });

  describe("saveSecurityConfig", () => {
    it("should save config to security.json", () => {
      const config = { ...DEFAULT_SECURITY_CONFIG, enforcement: "enforce" as const };
      saveSecurityConfig(config);

      const saved = JSON.parse(mockFs.get("/mock/wopr/security.json")!);
      expect(saved.enforcement).toBe("enforce");
    });

    it("should write to the configured security.json path", () => {
      const config = { ...DEFAULT_SECURITY_CONFIG, enforcement: "off" as const };
      saveSecurityConfig(config);
      const saved = JSON.parse(mockFs.get("/mock/wopr/security.json")!);
      expect(saved.enforcement).toBe("off");
    });
  });

  // ==========================================================================
  // Policy Resolution
  // ==========================================================================
  describe("resolvePolicy", () => {
    it("should resolve owner trust level with wildcard capabilities", () => {
      const source = makeSource("cli"); // owner trust
      const policy = resolvePolicy(source);

      expect(policy.trustLevel).toBe("owner");
      expect(policy.capabilities).toContain("*");
    });

    it("should resolve trusted with appropriate capability set", () => {
      const source = makeSource("plugin"); // trusted
      const policy = resolvePolicy(source);

      expect(policy.trustLevel).toBe("trusted");
      expect(policy.capabilities).toContain("inject");
      expect(policy.capabilities).toContain("inject.tools");
      expect(policy.capabilities).toContain("session.spawn");
    });

    it("should resolve semi-trusted with limited capabilities", () => {
      const source = makeSource("api"); // semi-trusted
      const policy = resolvePolicy(source);

      expect(policy.trustLevel).toBe("semi-trusted");
      expect(policy.capabilities).toContain("inject");
      expect(policy.capabilities).not.toContain("config.write");
      expect(policy.capabilities).not.toContain("memory.write");
    });

    it("should resolve untrusted with minimal capabilities", () => {
      const source = makeSource("p2p"); // untrusted
      const policy = resolvePolicy(source);

      expect(policy.trustLevel).toBe("untrusted");
      expect(policy.capabilities).toEqual(["inject"]);
    });

    it("should merge granted capabilities with base capabilities", () => {
      const source = makeSource("p2p", {
        grantedCapabilities: ["memory.read", "session.history"],
      });
      const policy = resolvePolicy(source);

      expect(policy.capabilities).toContain("inject");
      expect(policy.capabilities).toContain("memory.read");
      expect(policy.capabilities).toContain("session.history");
    });

    it("should not duplicate granted capabilities already in base set", () => {
      const source = makeSource("p2p", {
        grantedCapabilities: ["inject"], // already in untrusted base
      });
      const policy = resolvePolicy(source);

      const injectCount = policy.capabilities.filter((c) => c === "inject").length;
      expect(injectCount).toBe(1);
    });

    it("should apply sandbox defaults by trust level", () => {
      const untrustedSource = makeSource("p2p");
      const untrustedPolicy = resolvePolicy(untrustedSource);
      expect(untrustedPolicy.sandbox.enabled).toBe(true);
      expect(untrustedPolicy.sandbox.network).toBe("none");

      const ownerSource = makeSource("cli");
      const ownerPolicy = resolvePolicy(ownerSource);
      expect(ownerPolicy.sandbox.enabled).toBe(false);
    });

    it("should apply rate limits from defaults", () => {
      const source = makeSource("api");
      const policy = resolvePolicy(source);

      expect(policy.rateLimit.perMinute).toBeGreaterThan(0);
      expect(policy.rateLimit.perHour).toBeGreaterThan(0);
    });

    it("should apply trust level rate limit overrides", () => {
      setSecurityConfig({
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

    it("should resolve session access from trust level policy", () => {
      setSecurityConfig({
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

    it("should default to wildcard session access when no restrictions", () => {
      const source = makeSource("cli");
      const policy = resolvePolicy(source);

      expect(policy.allowedSessions).toBe("*");
      expect(policy.blockedSessions).toEqual([]);
    });

    it("should detect gateway sessions", () => {
      setSecurityConfig({
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

    it("should set canForward when gateway and has cross.inject", () => {
      setSecurityConfig({
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

    it("should not canForward when gateway but no cross.inject", () => {
      setSecurityConfig({
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
    it("should allow owner to access any session", () => {
      const source = makeSource("cli");
      const result = checkSessionAccess(source, "any-session");

      expect(result.allowed).toBe(true);
    });

    it("should deny untrusted below minimum trust level", () => {
      setSecurityConfig({
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

    it("should deny access to blocked sessions", () => {
      setSecurityConfig({
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

    it("should deny access when session not in allowed list", () => {
      setSecurityConfig({
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

    it("should allow access when session is in allowed list and matches access patterns", () => {
      setSecurityConfig({
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

    it("should deny when source does not match session access patterns", () => {
      setSecurityConfig({
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
    it("should allow owner all capabilities via wildcard", () => {
      const source = makeSource("cli");
      const result = checkCapability(source, "config.write");

      expect(result.allowed).toBe(true);
    });

    it("should allow trusted sources their granted capabilities", () => {
      const source = makeSource("plugin");
      const result = checkCapability(source, "inject.tools");

      expect(result.allowed).toBe(true);
    });

    it("should deny untrusted sources capabilities they don't have", () => {
      const source = makeSource("p2p");
      const result = checkCapability(source, "config.write");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not granted");
    });

    it("should allow explicitly granted capabilities to override base", () => {
      const source = makeSource("p2p", {
        grantedCapabilities: ["memory.read"],
      });
      const result = checkCapability(source, "memory.read");

      expect(result.allowed).toBe(true);
    });

    it("should check parent capability (inject grants inject.tools)", () => {
      // Semi-trusted has "inject" which should grant "inject.tools" via parent check
      const source = makeSource("api");
      const result = checkCapability(source, "inject.tools");

      expect(result.allowed).toBe(true);
    });

    it("should deny capabilities with no parent match", () => {
      const source = makeSource("p2p"); // only has "inject"
      const result = checkCapability(source, "config.read");

      expect(result.allowed).toBe(false);
    });
  });

  // ==========================================================================
  // Tool Access Checks
  // ==========================================================================
  describe("checkToolAccess", () => {
    it("should allow owner access to all tools", () => {
      const source = makeSource("cli");
      const result = checkToolAccess(source, "config_set");

      expect(result.allowed).toBe(true);
    });

    it("should deny explicitly denied tools", () => {
      setSecurityConfig({
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

    it("should allow explicitly allowed tools even when wildcard deny", () => {
      setSecurityConfig({
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

    it("should return warning instead of deny in warn mode", () => {
      setSecurityConfig({
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

    it("should deny tools requiring capabilities the source lacks", () => {
      setSecurityConfig({ enforcement: "enforce" });

      const source = makeSource("p2p"); // untrusted, only has "inject"
      // http_fetch requires inject.network, but untrusted has deny: ["*"]
      // so it gets denied by tool policy first
      const result = checkToolAccess(source, "http_fetch");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("denied");
    });

    it("should warn about missing capability in warn mode", () => {
      // Default config is "warn" mode
      const source = makeSource("p2p");
      const result = checkToolAccess(source, "http_fetch");

      expect(result.allowed).toBe(true);
      expect(result.warning).toContain("warn mode");
    });

    it("should allow tools with no capability requirement", () => {
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
    it("should not require sandbox for owner", () => {
      const source = makeSource("cli");
      const result = checkSandboxRequired(source);

      expect(result).toBeNull();
    });

    it("should not require sandbox for trusted", () => {
      const source = makeSource("plugin");
      const result = checkSandboxRequired(source);

      expect(result).toBeNull();
    });

    it("should require sandbox for semi-trusted", () => {
      const source = makeSource("api");
      const result = checkSandboxRequired(source);

      expect(result).not.toBeNull();
      expect(result!.enabled).toBe(true);
      expect(result!.network).toBe("bridge");
    });

    it("should require sandbox for untrusted with stricter config", () => {
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
    it("should return all tools for owner", () => {
      const source = makeSource("cli");
      const tools = ["config_set", "http_fetch", "exec_command", "memory_write"];
      const filtered = filterToolsByPolicy(source, tools);

      expect(filtered).toEqual(tools);
    });

    it("should filter denied tools in enforce mode", () => {
      setSecurityConfig({
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

    it("should filter tools denied by wildcard even in warn mode", () => {
      // Default untrusted has tools: { deny: ["*"] }
      // filterToolsByPolicy checks deny list first - deny list is enforced
      // even in warn mode (warn mode only applies to capability checks)
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
    it("should return false for default config (warn mode)", () => {
      expect(isEnforcementEnabled()).toBe(false);
    });

    it("should return true when enforcement is 'enforce'", () => {
      setSecurityConfig({ enforcement: "enforce" });
      const result = isEnforcementEnabled();
      expect(result).toBe(true);
    });

    it("should return false when enforcement is 'off'", () => {
      setSecurityConfig({ enforcement: "off" });
      expect(isEnforcementEnabled()).toBe(false);
    });
  });

  // ==========================================================================
  // Audit Logging
  // ==========================================================================
  describe("shouldLogSecurityEvent", () => {
    it("should log denied events when audit.logDenied is true", () => {
      setSecurityConfig({
        audit: { enabled: true, logDenied: true, logSuccess: false },
      });
      expect(shouldLogSecurityEvent(false)).toBe(true);
    });

    it("should not log success events when audit.logSuccess is false", () => {
      setSecurityConfig({
        audit: { enabled: true, logDenied: true, logSuccess: false },
      });
      expect(shouldLogSecurityEvent(true)).toBe(false);
    });

    it("should log success events when audit.logSuccess is true", () => {
      setSecurityConfig({
        audit: { enabled: true, logDenied: true, logSuccess: true },
      });
      expect(shouldLogSecurityEvent(true)).toBe(true);
    });

    it("should not log anything when audit is disabled", () => {
      setSecurityConfig({
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
    it("should return true for sessions with wildcard access", () => {
      setSecurityConfig({
        sessions: {
          "open-session": { access: ["*"] },
        },
      });

      expect(sessionAllowsUntrusted("open-session")).toBe(true);
    });

    it("should return true for sessions with trust:untrusted access", () => {
      setSecurityConfig({
        sessions: {
          "public-session": { access: ["trust:untrusted"] },
        },
      });

      expect(sessionAllowsUntrusted("public-session")).toBe(true);
    });

    it("should return false for sessions with only trusted access", () => {
      setSecurityConfig({
        sessions: {
          "private-session": { access: ["trust:trusted"] },
        },
      });

      expect(sessionAllowsUntrusted("private-session")).toBe(false);
    });

    it("should return false for sessions with default access", () => {
      // Default access is trust:trusted
      expect(sessionAllowsUntrusted("default-session")).toBe(false);
    });
  });

  describe("isGatewaySession (deprecated)", () => {
    it("should return true for sessions in legacy gateways config", () => {
      setSecurityConfig({
        gateways: {
          sessions: ["discord-gw"],
        },
      });

      expect(isGatewaySession("discord-gw")).toBe(true);
    });

    it("should return true for sessions allowing untrusted access (new pattern)", () => {
      setSecurityConfig({
        sessions: {
          "public-gw": { access: ["trust:untrusted"] },
        },
      });

      expect(isGatewaySession("public-gw")).toBe(true);
    });

    it("should return false for non-gateway sessions", () => {
      expect(isGatewaySession("normal-session")).toBe(false);
    });
  });

  describe("getGatewayRules (deprecated)", () => {
    it("should return forward rules for configured gateways", () => {
      setSecurityConfig({
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

    it("should return undefined for sessions without forward rules", () => {
      expect(getGatewayRules("no-rules")).toBeUndefined();
    });
  });

  // ==========================================================================
  // Session Forwarding
  // ==========================================================================
  describe("canSessionForward", () => {
    it("should deny when source session lacks cross.inject capability", () => {
      setSecurityConfig({
        sessions: {
          "no-forward": { capabilities: ["inject"] },
        },
      });

      const source = makeSource("api");
      const result = canSessionForward("no-forward", "target", source);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("cross.inject");
    });

    it("should allow when source session has cross.inject and target is accessible", () => {
      setSecurityConfig({
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
    it("should allow forwarding based on legacy gateway rules", () => {
      setSecurityConfig({
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

    it("should deny forwarding to non-allowed targets", () => {
      setSecurityConfig({
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

    it("should deny non-allowed actions", () => {
      setSecurityConfig({
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

    it("should allow wildcard forward targets", () => {
      setSecurityConfig({
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
    it("should handle missing trust level policy gracefully", () => {
      setSecurityConfig({
        trustLevels: {}, // No trust level policies defined
      });

      const source = makeSource("p2p");
      const policy = resolvePolicy(source);

      // Should fall back to defaults
      expect(policy.trustLevel).toBe("untrusted");
      expect(policy.capabilities).toBeDefined();
    });

    it("should handle conflicting allow and deny tool lists", () => {
      setSecurityConfig({
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

    it("should handle privilege escalation attempt (untrusted trying owner caps)", () => {
      setSecurityConfig({ enforcement: "enforce" });

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

    it("should prevent untrusted from spawning sessions", () => {
      const source = makeSource("p2p");
      const result = checkCapability(source, "session.spawn");

      expect(result.allowed).toBe(false);
    });

    it("should handle multiple granted capabilities correctly", () => {
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

    it("should apply sandbox overrides from trust level policy", () => {
      setSecurityConfig({
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

    it("should apply tool policy overrides from trust level", () => {
      setSecurityConfig({
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
