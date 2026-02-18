/**
 * Security Context Module Tests (WOP-84)
 *
 * Tests SecurityContext class, factory functions, context isolation,
 * event recording, and context storage.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, existsSync } from "node:fs";
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
const { initSecurity, saveSecurityConfig } = await import("../../src/security/policy.js");
const {
  SecurityContext,
  createSecurityContext,
  createCliContext,
  createDaemonContext,
  createPluginContext,
  createCronContext,
  createP2PContext,
  createP2PDiscoveryContext,
  createApiContext,
  storeContext,
  getContext,
  clearContext,
  withSecurityContext,
} = await import("../../src/security/context.js");

const {
  createInjectionSource,
  DEFAULT_SECURITY_CONFIG,
} = await import("../../src/security/types.js");

import type { SecurityConfig } from "../../src/security/types.js";

// ============================================================================
// Helpers
// ============================================================================

let testDir: string;

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

describe("Security Context Module", () => {
  beforeEach(async () => {
    testDir = join(tmpdir(), `wopr-test-${randomBytes(8).toString("hex")}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    resetStorage();
    getStorage(join(testDir, "test.sqlite"));
    await initSecurity(testDir);
  });

  afterEach(() => {
    resetStorage();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // SecurityContext Class
  // ==========================================================================
  describe("SecurityContext", () => {
    it("should initialize with source, session, and request ID", () => {
      const source = createInjectionSource("cli");
      const ctx = new SecurityContext(source, "main");

      expect(ctx.source).toBe(source);
      expect(ctx.session).toBe("main");
      expect(ctx.requestId).toMatch(/^sec-/);
      expect(ctx.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("should generate unique request IDs", () => {
      const source = createInjectionSource("cli");
      const ctx1 = new SecurityContext(source, "main");
      const ctx2 = new SecurityContext(source, "main");

      expect(ctx1.requestId).not.toBe(ctx2.requestId);
    });

    it("should lazily resolve policy", () => {
      const source = createInjectionSource("cli");
      const ctx = new SecurityContext(source, "main");

      // Access policy triggers resolution
      const policy = ctx.policy;
      expect(policy.trustLevel).toBe("owner");
      expect(policy.capabilities).toContain("*");

      // Subsequent access returns same object (cached)
      expect(ctx.policy).toBe(policy);
    });

    it("should expose trust level from source", () => {
      const source = createInjectionSource("p2p");
      const ctx = new SecurityContext(source, "test");

      expect(ctx.trustLevel).toBe("untrusted");
    });

    it("should expose capabilities from resolved policy", () => {
      const source = createInjectionSource("plugin");
      const ctx = new SecurityContext(source, "test");

      expect(ctx.capabilities).toContain("inject");
      expect(ctx.capabilities).toContain("inject.tools");
    });

    it("should return resolved policy via getResolvedPolicy()", () => {
      const source = createInjectionSource("cli");
      const ctx = new SecurityContext(source, "main");

      const policy = ctx.getResolvedPolicy();
      expect(policy).toBe(ctx.policy);
    });
  });

  // ==========================================================================
  // Capability Checking
  // ==========================================================================
  describe("hasCapability", () => {
    it("should return true for owner with any capability", () => {
      const ctx = createCliContext("main");

      expect(ctx.hasCapability("config.write")).toBe(true);
      expect(ctx.hasCapability("inject.exec")).toBe(true);
      expect(ctx.hasCapability("*")).toBe(true);
    });

    it("should return false for untrusted requesting privileged capabilities", () => {
      const source = createInjectionSource("p2p");
      const ctx = new SecurityContext(source, "test");

      expect(ctx.hasCapability("config.write")).toBe(false);
      expect(ctx.hasCapability("session.spawn")).toBe(false);
      expect(ctx.hasCapability("memory.write")).toBe(false);
    });

    it("should record capability check events", () => {
      const source = createInjectionSource("p2p");
      const ctx = new SecurityContext(source, "test");

      ctx.hasCapability("config.write");

      const events = ctx.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("capability_check");
      expect(events[0].capability).toBe("config.write");
      expect(events[0].allowed).toBe(false);
    });

    it("should return true for granted capabilities", () => {
      const source = createInjectionSource("p2p", {
        grantedCapabilities: ["memory.read"],
      });
      const ctx = new SecurityContext(source, "test");

      expect(ctx.hasCapability("memory.read")).toBe(true);
    });
  });

  // ==========================================================================
  // Session Access
  // ==========================================================================
  describe("canAccessSession", () => {
    it("should allow owner to access sessions", () => {
      const ctx = createCliContext("main");
      const result = ctx.canAccessSession();

      expect(result.allowed).toBe(true);
    });

    it("should deny untrusted below minimum trust level", async () => {
      await setSecurityConfig({
        defaults: {
          ...DEFAULT_SECURITY_CONFIG.defaults,
          minTrustLevel: "trusted",
        },
      });

      const source = createInjectionSource("p2p");
      const ctx = new SecurityContext(source, "test");
      const result = ctx.canAccessSession();

      expect(result.allowed).toBe(false);
    });

    it("should record access events", () => {
      const ctx = createCliContext("main");
      ctx.canAccessSession();

      const events = ctx.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("access_granted");
    });

    it("should record denied access events", async () => {
      await setSecurityConfig({
        defaults: {
          ...DEFAULT_SECURITY_CONFIG.defaults,
          minTrustLevel: "trusted",
        },
      });

      const source = createInjectionSource("p2p");
      const ctx = new SecurityContext(source, "test");
      ctx.canAccessSession();

      const events = ctx.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("access_denied");
      expect(events[0].allowed).toBe(false);
    });
  });

  // ==========================================================================
  // Tool Access
  // ==========================================================================
  describe("canUseTool", () => {
    it("should allow owner to use any tool", () => {
      const ctx = createCliContext("main");
      const result = ctx.canUseTool("exec_command");

      expect(result.allowed).toBe(true);
    });

    it("should record tool check events", () => {
      const ctx = createCliContext("main");
      ctx.canUseTool("config_set");

      const events = ctx.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("capability_check");
      expect(events[0].tool).toBe("config_set");
    });

    it("should handle warn mode tool checks", async () => {
      await saveSecurityConfig({ ...DEFAULT_SECURITY_CONFIG, enforcement: "warn" });
      const source = createInjectionSource("p2p");
      const ctx = new SecurityContext(source, "test");

      const result = ctx.canUseTool("http_fetch");
      // In warn mode, allowed but with warning
      expect(result.allowed).toBe(true);
      expect(result.warning).toBeDefined();
    });
  });

  // ==========================================================================
  // Tool Filtering
  // ==========================================================================
  describe("filterTools", () => {
    it("should return all tools for owner context", () => {
      const ctx = createCliContext("main");
      const tools = ["config_set", "http_fetch", "exec_command"];
      const filtered = ctx.filterTools(tools);

      expect(filtered).toEqual(tools);
    });

    it("should filter based on policy in enforce mode", async () => {
      await setSecurityConfig({
        enforcement: "enforce",
        trustLevels: {
          untrusted: {
            capabilities: ["inject"],
            tools: { deny: ["*"], allow: ["security_whoami"] },
          },
        },
      });

      const source = createInjectionSource("p2p");
      const ctx = new SecurityContext(source, "test");
      const tools = ["security_whoami", "http_fetch", "exec_command"];
      const filtered = ctx.filterTools(tools);

      expect(filtered).toContain("security_whoami");
      expect(filtered).not.toContain("http_fetch");
      expect(filtered).not.toContain("exec_command");
    });
  });

  // ==========================================================================
  // Sandbox
  // ==========================================================================
  describe("requiresSandbox / getSandboxConfig", () => {
    it("should not require sandbox for owner", () => {
      const ctx = createCliContext("main");
      expect(ctx.requiresSandbox()).toBe(false);
      expect(ctx.getSandboxConfig()).toBeNull();
    });

    it("should require sandbox for untrusted", () => {
      const source = createInjectionSource("p2p");
      const ctx = new SecurityContext(source, "test");

      expect(ctx.requiresSandbox()).toBe(true);

      const sandbox = ctx.getSandboxConfig();
      expect(sandbox).not.toBeNull();
      expect(sandbox!.network).toBe("none");
    });

    it("should require sandbox for semi-trusted", () => {
      const source = createInjectionSource("api");
      const ctx = new SecurityContext(source, "test");

      expect(ctx.requiresSandbox()).toBe(true);

      const sandbox = ctx.getSandboxConfig();
      expect(sandbox).not.toBeNull();
      expect(sandbox!.network).toBe("bridge");
    });
  });

  // ==========================================================================
  // Gateway / Forward
  // ==========================================================================
  describe("isGateway / canForward / getForwardRules", () => {
    it("should detect gateway context", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["gw-session"],
          forwardRules: {
            "gw-session": {
              allowForwardTo: ["main"],
            },
          },
        },
      });

      const source = createInjectionSource("api");
      const ctx = new SecurityContext(source, "gw-session");

      expect(ctx.isGateway()).toBe(true);
      expect(ctx.getForwardRules()).toBeDefined();
      expect(ctx.getForwardRules()!.allowForwardTo).toContain("main");
    });

    it("should report canForward when gateway with cross.inject", async () => {
      await setSecurityConfig({
        gateways: {
          sessions: ["gw-session"],
        },
        trustLevels: {
          trusted: {
            capabilities: ["inject", "cross.inject"],
          },
        },
      });

      const source = createInjectionSource("plugin"); // trusted
      const ctx = new SecurityContext(source, "gw-session");

      expect(ctx.canForward()).toBe(true);
    });

    it("should not canForward without cross.inject", () => {
      setSecurityConfig({
        gateways: {
          sessions: ["gw-session"],
        },
      });

      const source = createInjectionSource("p2p"); // untrusted
      const ctx = new SecurityContext(source, "gw-session");

      expect(ctx.canForward()).toBe(false);
    });
  });

  // ==========================================================================
  // Derived Context (Forwarding)
  // ==========================================================================
  describe("deriveForForward", () => {
    it("should create a derived context for forwarding", () => {
      const source = createInjectionSource("plugin");
      const ctx = new SecurityContext(source, "gateway");

      const derived = ctx.deriveForForward("target-session");

      expect(derived.session).toBe("target-session");
      expect(derived.source.type).toBe("gateway");
      expect(derived.source.trustLevel).toBe("semi-trusted");
      expect(derived.source.identity?.gatewaySession).toBe("gateway");
    });

    it("should carry forward public key from original source", () => {
      const source = createInjectionSource("p2p", {
        identity: { publicKey: "abc123" },
      });
      const ctx = new SecurityContext(source, "gateway");

      const derived = ctx.deriveForForward("target");

      expect(derived.source.identity?.publicKey).toBe("abc123");
    });

    it("should not share events between original and derived", () => {
      const source = createInjectionSource("cli");
      const ctx = new SecurityContext(source, "gateway");
      ctx.hasCapability("inject"); // Record event on original

      const derived = ctx.deriveForForward("target");

      expect(ctx.getEvents().length).toBe(1);
      expect(derived.getEvents().length).toBe(0);
    });
  });

  // ==========================================================================
  // Event Recording
  // ==========================================================================
  describe("recordEvent / getEvents", () => {
    it("should record and return security events", () => {
      const source = createInjectionSource("api");
      const ctx = new SecurityContext(source, "test");

      ctx.recordEvent("access_granted", { allowed: true });
      ctx.recordEvent("capability_check", {
        capability: "inject",
        allowed: true,
      });

      const events = ctx.getEvents();
      expect(events.length).toBe(2);
      expect(events[0].type).toBe("access_granted");
      expect(events[1].type).toBe("capability_check");
    });

    it("should return a copy of events (not mutable reference)", () => {
      const source = createInjectionSource("cli");
      const ctx = new SecurityContext(source, "test");

      ctx.recordEvent("access_granted", { allowed: true });

      const events1 = ctx.getEvents();
      const events2 = ctx.getEvents();

      expect(events1).not.toBe(events2); // Different references
      expect(events1).toEqual(events2); // Same content
    });

    it("should include source and session in recorded events", () => {
      const source = createInjectionSource("p2p", {
        identity: { publicKey: "peer123" },
      });
      const ctx = new SecurityContext(source, "target-session");

      ctx.recordEvent("access_denied", {
        allowed: false,
        reason: "trust too low",
      });

      const events = ctx.getEvents();
      expect(events[0].source.type).toBe("p2p");
      expect(events[0].session).toBe("target-session");
      expect(events[0].reason).toBe("trust too low");
    });
  });

  // ==========================================================================
  // Serialization
  // ==========================================================================
  describe("toJSON", () => {
    it("should serialize context for logging", () => {
      const source = createInjectionSource("api", {
        identity: { apiKeyId: "key-123" },
      });
      const ctx = new SecurityContext(source, "api-session");

      const json = ctx.toJSON();

      expect(json.requestId).toBe(ctx.requestId);
      expect(json.session).toBe("api-session");
      expect((json.source as any).type).toBe("api");
      expect((json.source as any).trustLevel).toBe("semi-trusted");
      expect((json.source as any).identity.apiKeyId).toBe("key-123");
      expect(json.createdAt).toBe(ctx.createdAt);
      expect(json.eventCount).toBe(0);
    });

    it("should include event count", () => {
      const ctx = createCliContext("main");
      ctx.hasCapability("inject");
      ctx.hasCapability("config.write");

      const json = ctx.toJSON();
      expect(json.eventCount).toBe(2);
    });
  });

  // ==========================================================================
  // Factory Functions
  // ==========================================================================
  describe("Factory Functions", () => {
    it("createSecurityContext should create context with given source and session", () => {
      const source = createInjectionSource("api");
      const ctx = createSecurityContext(source, "my-session");

      expect(ctx.source).toBe(source);
      expect(ctx.session).toBe("my-session");
    });

    it("createCliContext should create owner-trust context", () => {
      const ctx = createCliContext("main");

      expect(ctx.source.type).toBe("cli");
      expect(ctx.trustLevel).toBe("owner");
    });

    it("createDaemonContext should create owner-trust context", () => {
      const ctx = createDaemonContext("main");

      expect(ctx.source.type).toBe("daemon");
      expect(ctx.trustLevel).toBe("owner");
    });

    it("createPluginContext should create trusted context with plugin name", () => {
      const ctx = createPluginContext("main", "my-plugin");

      expect(ctx.source.type).toBe("plugin");
      expect(ctx.trustLevel).toBe("trusted");
      expect(ctx.source.identity?.pluginName).toBe("my-plugin");
    });

    it("createCronContext should create owner-trust context", () => {
      const ctx = createCronContext("cron-session");

      expect(ctx.source.type).toBe("cron");
      expect(ctx.trustLevel).toBe("owner");
    });

    it("createP2PContext should create context with configurable trust", () => {
      const ctx = createP2PContext("p2p-session", "peer-key-abc", "trusted", ["memory.read"], "grant-1");

      expect(ctx.source.type).toBe("p2p");
      expect(ctx.trustLevel).toBe("trusted");
      expect(ctx.source.identity?.publicKey).toBe("peer-key-abc");
      expect(ctx.source.grantedCapabilities).toContain("memory.read");
      expect(ctx.source.grantId).toBe("grant-1");
    });

    it("createP2PContext should default to untrusted", () => {
      const ctx = createP2PContext("p2p-session", "peer-key");

      expect(ctx.trustLevel).toBe("untrusted");
    });

    it("createP2PDiscoveryContext should always be untrusted", () => {
      const ctx = createP2PDiscoveryContext("disc-session", "disc-peer-key");

      expect(ctx.source.type).toBe("p2p.discovery");
      expect(ctx.trustLevel).toBe("untrusted");
      expect(ctx.source.identity?.publicKey).toBe("disc-peer-key");
    });

    it("createApiContext should default to semi-trusted", () => {
      const ctx = createApiContext("api-session");

      expect(ctx.source.type).toBe("api");
      expect(ctx.trustLevel).toBe("semi-trusted");
    });

    it("createApiContext should allow configurable trust and API key", () => {
      const ctx = createApiContext("api-session", "api-key-456", "trusted");

      expect(ctx.trustLevel).toBe("trusted");
      expect(ctx.source.identity?.apiKeyId).toBe("api-key-456");
    });
  });

  // ==========================================================================
  // Context Storage
  // ==========================================================================
  describe("Context Storage", () => {
    it("should store and retrieve context by session", () => {
      const ctx = createCliContext("stored-session");
      storeContext(ctx);

      const retrieved = getContext("stored-session");
      expect(retrieved).toBe(ctx);
    });

    it("should return undefined for unknown sessions", () => {
      const result = getContext("nonexistent-session");
      expect(result).toBeUndefined();
    });

    it("should clear context by session", () => {
      const ctx = createCliContext("temp-session");
      storeContext(ctx);

      clearContext("temp-session");

      expect(getContext("temp-session")).toBeUndefined();
    });

    it("should overwrite existing context for same session", () => {
      const ctx1 = createCliContext("shared-session");
      const ctx2 = createApiContext("shared-session");

      storeContext(ctx1);
      storeContext(ctx2);

      const retrieved = getContext("shared-session");
      expect(retrieved).toBe(ctx2);
      expect(retrieved!.source.type).toBe("api");
    });
  });

  // ==========================================================================
  // withSecurityContext
  // ==========================================================================
  describe("withSecurityContext", () => {
    it("should store context during function execution", async () => {
      const ctx = createCliContext("with-ctx-session");

      await withSecurityContext(ctx, async () => {
        const current = getContext("with-ctx-session");
        expect(current).toBe(ctx);
      });
    });

    it("should clear context after function completes", async () => {
      const ctx = createCliContext("cleanup-session");

      await withSecurityContext(ctx, async () => {
        // Context exists during execution
        expect(getContext("cleanup-session")).toBe(ctx);
      });

      // Context cleared after
      expect(getContext("cleanup-session")).toBeUndefined();
    });

    it("should clear context even if function throws", async () => {
      const ctx = createCliContext("error-session");

      await expect(
        withSecurityContext(ctx, async () => {
          throw new Error("intentional error");
        }),
      ).rejects.toThrow("intentional error");

      // Context should still be cleared
      expect(getContext("error-session")).toBeUndefined();
    });

    it("should return the function result", async () => {
      const ctx = createCliContext("result-session");

      const result = await withSecurityContext(ctx, async () => {
        return 42;
      });

      expect(result).toBe(42);
    });
  });

  // ==========================================================================
  // Context Isolation
  // ==========================================================================
  describe("Context Isolation", () => {
    it("should isolate contexts for different sessions", () => {
      const ctx1 = createCliContext("session-a");
      const ctx2 = createApiContext("session-b");

      storeContext(ctx1);
      storeContext(ctx2);

      expect(getContext("session-a")!.trustLevel).toBe("owner");
      expect(getContext("session-b")!.trustLevel).toBe("semi-trusted");
    });

    it("should not share events between contexts", () => {
      const ctx1 = createCliContext("session-1");
      const ctx2 = createApiContext("session-2");

      ctx1.hasCapability("inject");
      ctx2.hasCapability("config.write");

      expect(ctx1.getEvents().length).toBe(1);
      expect(ctx2.getEvents().length).toBe(1);

      // Events are independent
      expect(ctx1.getEvents()[0].type).toBe("capability_check");
      expect(ctx2.getEvents()[0].type).toBe("capability_check");
    });

    it("should not share policy between contexts of different trust levels", () => {
      const ownerCtx = createCliContext("main");
      const untrustedCtx = new SecurityContext(createInjectionSource("p2p"), "public");

      expect(ownerCtx.policy.capabilities).toContain("*");
      expect(untrustedCtx.policy.capabilities).not.toContain("*");
      expect(untrustedCtx.policy.capabilities).toEqual(["inject"]);
    });

    it("should maintain separate sandbox configs per context", () => {
      const ownerCtx = createCliContext("admin");
      const p2pCtx = new SecurityContext(createInjectionSource("p2p"), "external");

      expect(ownerCtx.requiresSandbox()).toBe(false);
      expect(p2pCtx.requiresSandbox()).toBe(true);
    });

    it("should allow concurrent contexts for same session name without interference", async () => {
      const ctx1 = createCliContext("shared");
      const ctx2 = createApiContext("shared");

      // Both can exist independently
      expect(ctx1.trustLevel).toBe("owner");
      expect(ctx2.trustLevel).toBe("semi-trusted");

      // Storage overwrites, but the objects themselves are independent
      storeContext(ctx1);
      expect(getContext("shared")!.trustLevel).toBe("owner");

      storeContext(ctx2);
      expect(getContext("shared")!.trustLevel).toBe("semi-trusted");

      // ctx1 is still independently usable even though it's not stored
      expect(ctx1.trustLevel).toBe("owner");
      expect(ctx1.hasCapability("*")).toBe(true);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe("Edge Cases", () => {
    it("should handle context with no identity", () => {
      const source = createInjectionSource("internal");
      const ctx = new SecurityContext(source, "test");

      expect(ctx.source.identity).toBeUndefined();
      expect(ctx.trustLevel).toBe("owner");
    });

    it("should handle empty session name", () => {
      const ctx = createCliContext("");

      expect(ctx.session).toBe("");
      expect(ctx.policy).toBeDefined();
    });

    it("should handle P2P context with elevated trust correctly", () => {
      const ctx = createP2PContext("p2p-elevated", "key", "trusted", [
        "memory.read",
        "memory.write",
        "session.history",
      ]);

      expect(ctx.trustLevel).toBe("trusted");
      expect(ctx.hasCapability("memory.read")).toBe(true);
      expect(ctx.hasCapability("memory.write")).toBe(true);
      // Should not have owner-level capabilities
      expect(ctx.hasCapability("config.write")).toBe(false);
    });

    it("should handle multiple tool checks recording separate events", () => {
      const ctx = createApiContext("api-test");

      ctx.canUseTool("config_get");
      ctx.canUseTool("http_fetch");
      ctx.canUseTool("exec_command");

      const events = ctx.getEvents();
      expect(events.length).toBe(3);
      expect(events[0].tool).toBe("config_get");
      expect(events[1].tool).toBe("http_fetch");
      expect(events[2].tool).toBe("exec_command");
    });
  });
});
