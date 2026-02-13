/**
 * Cross-Channel DM Pairing Tests (WOP-114)
 *
 * Tests the unified identity system: identity CRUD, platform linking,
 * pairing code generation/verification, trust level resolution,
 * and channel command handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Set up temporary WOPR_HOME for test isolation
const TEST_WOPR_HOME = join(tmpdir(), `wopr-pairing-test-${process.pid}-${Date.now()}`);

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: TEST_WOPR_HOME,
  SESSIONS_DIR: join(TEST_WOPR_HOME, "sessions"),
  SESSIONS_FILE: join(TEST_WOPR_HOME, "sessions.json"),
  REGISTRIES_FILE: join(TEST_WOPR_HOME, "registries.json"),
  CRONS_FILE: join(TEST_WOPR_HOME, "crons.json"),
  CRON_HISTORY_FILE: join(TEST_WOPR_HOME, "cron-history.json"),
  PID_FILE: join(TEST_WOPR_HOME, "daemon.pid"),
  LOG_FILE: join(TEST_WOPR_HOME, "daemon.log"),
  IDENTITY_FILE: join(TEST_WOPR_HOME, "identity.json"),
  ACCESS_FILE: join(TEST_WOPR_HOME, "access.json"),
  PEERS_FILE: join(TEST_WOPR_HOME, "peers.json"),
  AUTH_FILE: join(TEST_WOPR_HOME, "auth.json"),
  CONFIG_FILE: join(TEST_WOPR_HOME, "config.json"),
  GLOBAL_IDENTITY_DIR: join(TEST_WOPR_HOME, "global-identity"),
}));

let pairing: typeof import("../../src/core/pairing.js");
let pairingCommands: typeof import("../../src/core/pairing-commands.js");

beforeEach(async () => {
  vi.resetModules();
  // Create fresh test directory
  mkdirSync(TEST_WOPR_HOME, { recursive: true });
  pairing = await import("../../src/core/pairing.js");
  pairingCommands = await import("../../src/core/pairing-commands.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  // Clean up test directory
  if (existsSync(TEST_WOPR_HOME)) {
    rmSync(TEST_WOPR_HOME, { recursive: true, force: true });
  }
});

// ============================================================================
// Identity Management
// ============================================================================

describe("Identity Management", () => {
  it("should create a new identity with default trust level", () => {
    const identity = pairing.createIdentity("alice");
    expect(identity.name).toBe("alice");
    expect(identity.trustLevel).toBe("semi-trusted");
    expect(identity.links).toEqual([]);
    expect(identity.id).toBeTruthy();
    expect(identity.createdAt).toBeGreaterThan(0);
  });

  it("should create identity with specified trust level", () => {
    const identity = pairing.createIdentity("bob", "trusted");
    expect(identity.trustLevel).toBe("trusted");
  });

  it("should reject duplicate identity names", () => {
    pairing.createIdentity("alice");
    expect(() => pairing.createIdentity("alice")).toThrow('Identity with name "alice" already exists');
  });

  it("should get identity by ID", () => {
    const created = pairing.createIdentity("alice");
    const found = pairing.getIdentity(created.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("alice");
  });

  it("should return undefined for unknown ID", () => {
    expect(pairing.getIdentity("nonexistent")).toBeUndefined();
  });

  it("should get identity by name", () => {
    pairing.createIdentity("alice");
    const found = pairing.getIdentityByName("alice");
    expect(found).toBeDefined();
    expect(found!.name).toBe("alice");
  });

  it("should return undefined for unknown name", () => {
    expect(pairing.getIdentityByName("nobody")).toBeUndefined();
  });

  it("should list all identities", () => {
    pairing.createIdentity("alice");
    pairing.createIdentity("bob");
    const list = pairing.listIdentities();
    expect(list).toHaveLength(2);
    expect(list.map((i) => i.name).sort()).toEqual(["alice", "bob"]);
  });

  it("should update identity trust level", () => {
    const identity = pairing.createIdentity("alice", "untrusted");
    const updated = pairing.setIdentityTrustLevel(identity.id, "trusted");
    expect(updated.trustLevel).toBe("trusted");

    // Verify persistence
    const loaded = pairing.getIdentity(identity.id);
    expect(loaded!.trustLevel).toBe("trusted");
  });

  it("should throw when updating trust for nonexistent identity", () => {
    expect(() => pairing.setIdentityTrustLevel("fake-id", "trusted")).toThrow("Identity not found");
  });

  it("should remove identity", () => {
    const identity = pairing.createIdentity("alice");
    const result = pairing.removeIdentity(identity.id);
    expect(result).toBe(true);
    expect(pairing.getIdentity(identity.id)).toBeUndefined();
  });

  it("should return false when removing nonexistent identity", () => {
    expect(pairing.removeIdentity("fake-id")).toBe(false);
  });

  it("should remove pending codes when removing identity", () => {
    const code = pairing.generatePairingCode("alice", "trusted");
    const identity = pairing.getIdentityByName("alice");
    pairing.removeIdentity(identity!.id);
    expect(pairing.listPendingCodes()).toHaveLength(0);
  });
});

// ============================================================================
// Platform Linking
// ============================================================================

describe("Platform Linking", () => {
  it("should link a platform sender to an identity", () => {
    const identity = pairing.createIdentity("alice");
    const linked = pairing.linkPlatform(identity.id, "discord", "discord-user-123");
    expect(linked.links).toHaveLength(1);
    expect(linked.links[0].channelType).toBe("discord");
    expect(linked.links[0].senderId).toBe("discord-user-123");
  });

  it("should support multiple platforms on one identity", () => {
    const identity = pairing.createIdentity("alice");
    pairing.linkPlatform(identity.id, "discord", "discord-123");
    const linked = pairing.linkPlatform(identity.id, "telegram", "tg-456");
    expect(linked.links).toHaveLength(2);
  });

  it("should update existing link for same channel type", () => {
    const identity = pairing.createIdentity("alice");
    pairing.linkPlatform(identity.id, "discord", "old-id");
    const updated = pairing.linkPlatform(identity.id, "discord", "new-id");
    expect(updated.links).toHaveLength(1);
    expect(updated.links[0].senderId).toBe("new-id");
  });

  it("should reject linking sender already linked to another identity", () => {
    const alice = pairing.createIdentity("alice");
    const bob = pairing.createIdentity("bob");
    pairing.linkPlatform(alice.id, "discord", "user-123");
    expect(() => pairing.linkPlatform(bob.id, "discord", "user-123")).toThrow("already linked");
  });

  it("should throw when linking to nonexistent identity", () => {
    expect(() => pairing.linkPlatform("fake-id", "discord", "user-123")).toThrow("Identity not found");
  });

  it("should find identity by sender", () => {
    const identity = pairing.createIdentity("alice");
    pairing.linkPlatform(identity.id, "discord", "user-123");
    const found = pairing.findIdentityBySender("discord", "user-123");
    expect(found).toBeDefined();
    expect(found!.name).toBe("alice");
  });

  it("should return undefined for unknown sender", () => {
    expect(pairing.findIdentityBySender("discord", "unknown")).toBeUndefined();
  });

  it("should unlink platform from identity", () => {
    const identity = pairing.createIdentity("alice");
    pairing.linkPlatform(identity.id, "discord", "user-123");
    pairing.linkPlatform(identity.id, "telegram", "tg-456");

    const result = pairing.unlinkPlatform(identity.id, "discord");
    expect(result).toBe(true);

    const updated = pairing.getIdentity(identity.id);
    expect(updated!.links).toHaveLength(1);
    expect(updated!.links[0].channelType).toBe("telegram");
  });

  it("should return false when unlinking nonexistent platform", () => {
    const identity = pairing.createIdentity("alice");
    expect(pairing.unlinkPlatform(identity.id, "discord")).toBe(false);
  });

  it("should return false when unlinking from nonexistent identity", () => {
    expect(pairing.unlinkPlatform("fake-id", "discord")).toBe(false);
  });
});

// ============================================================================
// Pairing Code Flow
// ============================================================================

describe("Pairing Code Flow", () => {
  it("should generate a pairing code for a new identity", () => {
    const code = pairing.generatePairingCode("alice", "trusted");
    expect(code.code).toHaveLength(6);
    expect(code.trustLevel).toBe("trusted");
    expect(code.expiresAt).toBeGreaterThan(Date.now());

    // Identity should have been created
    const identity = pairing.getIdentityByName("alice");
    expect(identity).toBeDefined();
  });

  it("should generate code for existing identity", () => {
    pairing.createIdentity("alice", "untrusted");
    const code = pairing.generatePairingCode("alice", "trusted");
    expect(code.trustLevel).toBe("trusted");

    // Should still be just one identity
    expect(pairing.listIdentities()).toHaveLength(1);
  });

  it("should revoke previous code when generating new one", () => {
    const code1 = pairing.generatePairingCode("alice", "trusted");
    const code2 = pairing.generatePairingCode("alice", "trusted");
    expect(code1.code).not.toBe(code2.code);

    // Only one pending code should exist
    expect(pairing.listPendingCodes()).toHaveLength(1);
    expect(pairing.listPendingCodes()[0].code).toBe(code2.code);
  });

  it("should verify valid pairing code and link sender", () => {
    const code = pairing.generatePairingCode("alice", "trusted");
    const result = pairing.verifyPairingCode(code.code, "discord", "user-123");

    expect(result).toBeDefined();
    expect(result!.identity.name).toBe("alice");
    expect(result!.trustLevel).toBe("trusted");

    // Sender should be linked
    const identity = pairing.findIdentityBySender("discord", "user-123");
    expect(identity).toBeDefined();
    expect(identity!.name).toBe("alice");
  });

  it("should be case-insensitive for pairing codes", () => {
    const code = pairing.generatePairingCode("alice", "trusted");
    const result = pairing.verifyPairingCode(code.code.toLowerCase(), "discord", "user-123");
    expect(result).toBeDefined();
    expect(result!.identity.name).toBe("alice");
  });

  it("should consume code after verification", () => {
    const code = pairing.generatePairingCode("alice", "trusted");
    pairing.verifyPairingCode(code.code, "discord", "user-123");

    // Code should be consumed
    expect(pairing.listPendingCodes()).toHaveLength(0);

    // Second attempt should fail
    const result2 = pairing.verifyPairingCode(code.code, "telegram", "tg-456");
    expect(result2).toBeNull();
  });

  it("should reject expired pairing code", () => {
    // Generate code with 0ms expiry (already expired)
    const code = pairing.generatePairingCode("alice", "trusted", 0);
    const result = pairing.verifyPairingCode(code.code, "discord", "user-123");
    expect(result).toBeNull();
  });

  it("should reject invalid pairing code", () => {
    const result = pairing.verifyPairingCode("BADCODE", "discord", "user-123");
    expect(result).toBeNull();
  });

  it("should reject if sender already linked to another identity", () => {
    // Link user-123 to bob
    const bob = pairing.createIdentity("bob");
    pairing.linkPlatform(bob.id, "discord", "user-123");

    // Try to pair user-123 to alice via code
    const code = pairing.generatePairingCode("alice", "trusted");
    const result = pairing.verifyPairingCode(code.code, "discord", "user-123");
    expect(result).toBeNull();
  });

  it("should apply trust level from code to identity", () => {
    pairing.createIdentity("alice", "untrusted");
    const code = pairing.generatePairingCode("alice", "owner");
    pairing.verifyPairingCode(code.code, "discord", "user-123");

    const identity = pairing.getIdentityByName("alice");
    expect(identity!.trustLevel).toBe("owner");
  });

  it("should list pending codes excluding expired", () => {
    pairing.generatePairingCode("alice", "trusted");
    pairing.generatePairingCode("bob", "trusted", 0); // expired
    const codes = pairing.listPendingCodes();
    expect(codes).toHaveLength(1);
  });

  it("should revoke a pending code", () => {
    const code = pairing.generatePairingCode("alice", "trusted");
    expect(pairing.revokePairingCode(code.code)).toBe(true);
    expect(pairing.listPendingCodes()).toHaveLength(0);
  });

  it("should return false when revoking nonexistent code", () => {
    expect(pairing.revokePairingCode("ABCDEF")).toBe(false);
  });
});

// ============================================================================
// Trust Level Resolution
// ============================================================================

describe("Trust Level Resolution", () => {
  it("should return trust level for paired sender", () => {
    const identity = pairing.createIdentity("alice", "trusted");
    pairing.linkPlatform(identity.id, "discord", "user-123");
    expect(pairing.resolveTrustLevel("discord", "user-123")).toBe("trusted");
  });

  it("should return untrusted for unpaired sender", () => {
    expect(pairing.resolveTrustLevel("discord", "unknown")).toBe("untrusted");
  });

  it("should return consistent trust across channels", () => {
    const identity = pairing.createIdentity("alice", "owner");
    pairing.linkPlatform(identity.id, "discord", "discord-123");
    pairing.linkPlatform(identity.id, "telegram", "tg-456");

    expect(pairing.resolveTrustLevel("discord", "discord-123")).toBe("owner");
    expect(pairing.resolveTrustLevel("telegram", "tg-456")).toBe("owner");
  });

  it("should reflect trust level changes across all channels", () => {
    const identity = pairing.createIdentity("alice", "trusted");
    pairing.linkPlatform(identity.id, "discord", "d-1");
    pairing.linkPlatform(identity.id, "telegram", "t-1");

    pairing.setIdentityTrustLevel(identity.id, "semi-trusted");

    expect(pairing.resolveTrustLevel("discord", "d-1")).toBe("semi-trusted");
    expect(pairing.resolveTrustLevel("telegram", "t-1")).toBe("semi-trusted");
  });
});

// ============================================================================
// Cross-Channel Scenarios
// ============================================================================

describe("Cross-Channel Scenarios", () => {
  it("should pair user from Discord then recognize on Telegram", () => {
    // Admin generates code
    const code = pairing.generatePairingCode("alice", "trusted");

    // User verifies from Discord
    pairing.verifyPairingCode(code.code, "discord", "discord-alice");

    // Later, user links Telegram via direct linkPlatform (admin action)
    const identity = pairing.getIdentityByName("alice")!;
    pairing.linkPlatform(identity.id, "telegram", "tg-alice");

    // Both channels should resolve to same identity
    const fromDiscord = pairing.findIdentityBySender("discord", "discord-alice");
    const fromTelegram = pairing.findIdentityBySender("telegram", "tg-alice");
    expect(fromDiscord!.id).toBe(fromTelegram!.id);
  });

  it("should allow multiple users with different trust levels", () => {
    const codeAlice = pairing.generatePairingCode("alice", "owner");
    const codeBob = pairing.generatePairingCode("bob", "untrusted");

    pairing.verifyPairingCode(codeAlice.code, "discord", "alice-d");
    pairing.verifyPairingCode(codeBob.code, "discord", "bob-d");

    expect(pairing.resolveTrustLevel("discord", "alice-d")).toBe("owner");
    expect(pairing.resolveTrustLevel("discord", "bob-d")).toBe("untrusted");
  });

  it("should handle revoking identity and re-pairing", () => {
    const code1 = pairing.generatePairingCode("alice", "trusted");
    pairing.verifyPairingCode(code1.code, "discord", "alice-d");

    // Revoke
    const identity = pairing.getIdentityByName("alice")!;
    pairing.removeIdentity(identity.id);
    expect(pairing.resolveTrustLevel("discord", "alice-d")).toBe("untrusted");

    // Re-pair with new identity
    const code2 = pairing.generatePairingCode("alice-v2", "semi-trusted");
    pairing.verifyPairingCode(code2.code, "discord", "alice-d");
    expect(pairing.resolveTrustLevel("discord", "alice-d")).toBe("semi-trusted");
  });
});

// ============================================================================
// Channel Commands
// ============================================================================

describe("Channel Commands", () => {
  // Need the type import for the test helper
  type ChannelCommandContext = import("../../src/types.js").ChannelCommandContext;

  function makeCtx(args: string[] = [], overrides?: Partial<ChannelCommandContext>): ChannelCommandContext {
    return {
      channel: "test-channel",
      channelType: "discord",
      sender: "test-user",
      args,
      reply: vi.fn().mockResolvedValue(undefined),
      getBotUsername: () => "wopr-bot",
      ...overrides,
    };
  }

  /** Link test-user as owner so admin commands pass auth checks */
  function makeOwner(): void {
    const owner = pairing.createIdentity("test-owner", "owner");
    pairing.linkPlatform(owner.id, "discord", "test-user");
  }

  it("should show usage for empty command", async () => {
    const ctx = makeCtx([]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  });

  it("should deny generate for non-owner", async () => {
    const ctx = makeCtx(["generate", "alice", "trusted"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
  });

  it("should generate a pairing code", async () => {
    makeOwner();
    const ctx = makeCtx(["generate", "alice", "trusted"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Pairing code"));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("trusted"));
  });

  it("should require name for generate", async () => {
    makeOwner();
    const ctx = makeCtx(["generate"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  });

  it("should reject invalid trust level for generate", async () => {
    makeOwner();
    const ctx = makeCtx(["generate", "alice", "superadmin"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Invalid trust level"));
  });

  it("should verify a pairing code", async () => {
    const code = pairing.generatePairingCode("alice", "trusted");
    const ctx = makeCtx(["verify", code.code], { sender: "alice-user" });
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Paired successfully"));
  });

  it("should reject invalid pairing code", async () => {
    const ctx = makeCtx(["verify", "ZZZZZZ"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Invalid or expired"));
  });

  it("should deny list for non-owner", async () => {
    const ctx = makeCtx(["list"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
  });

  it("should list identities", async () => {
    makeOwner();
    pairing.createIdentity("alice", "trusted");
    pairing.createIdentity("bob", "untrusted");
    const ctx = makeCtx(["list"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("alice"));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("bob"));
  });

  it("should show empty list message when only owner exists", async () => {
    makeOwner();
    const ctx = makeCtx(["list"]);
    await pairingCommands.pairCommand.handler(ctx);
    // Owner identity exists, so it shows at least that
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Paired identities"));
  });

  it("should deny revoke for non-owner", async () => {
    pairing.createIdentity("alice");
    const ctx = makeCtx(["revoke", "alice"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
  });

  it("should revoke identity", async () => {
    makeOwner();
    pairing.createIdentity("alice");
    const ctx = makeCtx(["revoke", "alice"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Revoked"));
    expect(pairing.getIdentityByName("alice")).toBeUndefined();
  });

  it("should handle revoking nonexistent identity", async () => {
    makeOwner();
    const ctx = makeCtx(["revoke", "ghost"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("should show whois for paired user", async () => {
    const code = pairing.generatePairingCode("alice", "trusted");
    pairing.verifyPairingCode(code.code, "discord", "test-user");

    const ctx = makeCtx(["whois"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("alice"));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("trusted"));
  });

  it("should show whois for unpaired user", async () => {
    const ctx = makeCtx(["whois"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("not paired"));
  });

  it("should deny codes for non-owner", async () => {
    const ctx = makeCtx(["codes"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
  });

  it("should list pending codes", async () => {
    makeOwner();
    pairing.generatePairingCode("alice", "trusted");
    const ctx = makeCtx(["codes"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Pending pairing codes"));
  });

  it("should show empty codes message", async () => {
    makeOwner();
    const ctx = makeCtx(["codes"]);
    await pairingCommands.pairCommand.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("No pending pairing codes.");
  });

  it("should register commands on a channel provider", () => {
    const provider = {
      id: "discord",
      registerCommand: vi.fn(),
      unregisterCommand: vi.fn(),
      getCommands: vi.fn().mockReturnValue([]),
      addMessageParser: vi.fn(),
      removeMessageParser: vi.fn(),
      getMessageParsers: vi.fn().mockReturnValue([]),
      send: vi.fn(),
      getBotUsername: vi.fn().mockReturnValue("wopr"),
    };

    pairingCommands.registerPairingCommands(provider);
    expect(provider.registerCommand).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pair" }),
    );
  });

  it("should register on all providers", () => {
    const p1 = {
      id: "discord",
      registerCommand: vi.fn(),
      unregisterCommand: vi.fn(),
      getCommands: vi.fn().mockReturnValue([]),
      addMessageParser: vi.fn(),
      removeMessageParser: vi.fn(),
      getMessageParsers: vi.fn().mockReturnValue([]),
      send: vi.fn(),
      getBotUsername: vi.fn().mockReturnValue("wopr"),
    };
    const p2 = {
      id: "telegram",
      registerCommand: vi.fn(),
      unregisterCommand: vi.fn(),
      getCommands: vi.fn().mockReturnValue([]),
      addMessageParser: vi.fn(),
      removeMessageParser: vi.fn(),
      getMessageParsers: vi.fn().mockReturnValue([]),
      send: vi.fn(),
      getBotUsername: vi.fn().mockReturnValue("wopr"),
    };

    pairingCommands.registerPairingOnAllProviders([p1, p2]);
    expect(p1.registerCommand).toHaveBeenCalled();
    expect(p2.registerCommand).toHaveBeenCalled();
  });
});

// ============================================================================
// Persistence
// ============================================================================

describe("Persistence", () => {
  it("should persist identities across module reloads", async () => {
    pairing.createIdentity("persistent-alice", "trusted");

    // Re-import to simulate fresh load
    vi.resetModules();
    const freshPairing = await import("../../src/core/pairing.js");
    const found = freshPairing.getIdentityByName("persistent-alice");
    expect(found).toBeDefined();
    expect(found!.trustLevel).toBe("trusted");
  });

  it("should handle corrupt data file gracefully", async () => {
    // Write corrupt data
    const pairingDir = join(TEST_WOPR_HOME, "pairing");
    mkdirSync(pairingDir, { recursive: true });
    writeFileSync(join(pairingDir, "identities.json"), "not valid json{{{");

    vi.resetModules();
    const freshPairing = await import("../../src/core/pairing.js");
    // Should recover and return empty list
    expect(freshPairing.listIdentities()).toEqual([]);
  });
});
