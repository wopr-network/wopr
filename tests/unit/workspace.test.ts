/**
 * Workspace Module Tests (WOP-83)
 *
 * Tests for src/core/workspace.ts covering:
 * - Workspace directory resolution (resolveDefaultWorkspaceDir, resolveWorkspaceDir)
 * - Workspace initialization (ensureWorkspace, isBrandNewWorkspace)
 * - Bootstrap file loading (loadBootstrapFiles, formatBootstrapContext)
 * - Identity parsing and resolution (parseIdentity, resolveIdentity)
 * - User profile parsing and resolution (parseUserProfile, resolveUserProfile)
 * - Ack reaction and message prefix (resolveAckReaction, resolveMessagePrefix)
 * - SOUL_EVIL system (decideSoulEvil, applySoulEvilOverride, time helpers)
 * - Edge cases: missing files, empty content, concurrent sessions
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock paths
const MOCK_GLOBAL_IDENTITY_DIR = "/mock/global-identity";
vi.mock("../../src/paths.js", () => ({
  GLOBAL_IDENTITY_DIR: MOCK_GLOBAL_IDENTITY_DIR,
}));

// In-memory filesystem
let mockFs: Map<string, string>;
// Track directories created
let mockDirs: Set<string>;

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(async (filePath: string) => {
      const content = mockFs.get(filePath);
      if (content === undefined) {
        const err: any = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        err.code = "ENOENT";
        throw err;
      }
      return content;
    }),
    writeFile: vi.fn(async (filePath: string, content: string, opts?: any) => {
      if (opts?.flag === "wx" && mockFs.has(filePath)) {
        const err: any = new Error(`EEXIST: file already exists, open '${filePath}'`);
        err.code = "EEXIST";
        throw err;
      }
      mockFs.set(filePath, content);
    }),
    mkdir: vi.fn(async (dirPath: string) => {
      mockDirs.add(dirPath);
    }),
    access: vi.fn(async (filePath: string) => {
      if (!mockFs.has(filePath)) {
        const err: any = new Error(`ENOENT: no such file or directory, access '${filePath}'`);
        err.code = "ENOENT";
        throw err;
      }
    }),
  },
}));

// ---------------------------------------------------------------------------
// Dynamic imports after mocks
// ---------------------------------------------------------------------------

let workspace: typeof import("../../src/core/workspace.js");

beforeEach(async () => {
  mockFs = new Map();
  mockDirs = new Set();
  vi.unstubAllEnvs();
  workspace = await import("../../src/core/workspace.js");
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

// ===========================================================================
// resolveDefaultWorkspaceDir
// ===========================================================================
describe("resolveDefaultWorkspaceDir", () => {
  it("uses WOPR_HOME env when set", () => {
    vi.stubEnv("WOPR_HOME", "/custom/wopr");
    const dir = workspace.resolveDefaultWorkspaceDir();
    expect(dir).toBe(path.join("/custom/wopr", "workspace"));
  });

  it("falls back to ~/.wopr/workspace when WOPR_HOME is not set", () => {
    vi.stubEnv("WOPR_HOME", "");
    const dir = workspace.resolveDefaultWorkspaceDir();
    expect(dir).toBe(path.join(os.homedir(), ".wopr", "workspace"));
  });
});

// ===========================================================================
// resolveWorkspaceDir
// ===========================================================================
describe("resolveWorkspaceDir", () => {
  it("returns resolved custom directory when provided", () => {
    const dir = workspace.resolveWorkspaceDir("/some/custom/dir");
    expect(dir).toBe(path.resolve("/some/custom/dir"));
  });

  it("resolves relative custom directory", () => {
    const dir = workspace.resolveWorkspaceDir("relative/dir");
    expect(dir).toBe(path.resolve("relative/dir"));
  });

  it("uses WOPR_WORKSPACE env when no custom dir given", () => {
    vi.stubEnv("WOPR_WORKSPACE", "/env/workspace");
    const dir = workspace.resolveWorkspaceDir();
    expect(dir).toBe("/env/workspace");
  });

  it("falls back to default workspace dir when no custom or env", () => {
    vi.stubEnv("WOPR_WORKSPACE", "");
    const dir = workspace.resolveWorkspaceDir();
    // Should match resolveDefaultWorkspaceDir output
    expect(dir).toBe(workspace.resolveDefaultWorkspaceDir());
  });
});

// ===========================================================================
// ensureWorkspace
// ===========================================================================
describe("ensureWorkspace", () => {
  it("creates workspace directory and all bootstrap files for brand new workspace", async () => {
    const result = await workspace.ensureWorkspace("/test/workspace");

    expect(result.dir).toBe(path.resolve("/test/workspace"));
    expect(result.created).toBe(true);

    // Check that AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md were created
    expect(mockFs.has(path.join(result.dir, "AGENTS.md"))).toBe(true);
    expect(mockFs.has(path.join(result.dir, "SOUL.md"))).toBe(true);
    expect(mockFs.has(path.join(result.dir, "TOOLS.md"))).toBe(true);
    expect(mockFs.has(path.join(result.dir, "IDENTITY.md"))).toBe(true);
    expect(mockFs.has(path.join(result.dir, "USER.md"))).toBe(true);
    expect(mockFs.has(path.join(result.dir, "HEARTBEAT.md"))).toBe(true);
    expect(mockFs.has(path.join(result.dir, "BOOTSTRAP.md"))).toBe(true);
  });

  it("creates memory subdirectory", async () => {
    const result = await workspace.ensureWorkspace("/test/workspace");
    expect(mockDirs.has(path.join(result.dir, "memory"))).toBe(true);
  });

  it("does not overwrite existing files", async () => {
    const dir = path.resolve("/test/workspace");
    const existingContent = "# My Custom AGENTS.md";
    mockFs.set(path.join(dir, "AGENTS.md"), existingContent);

    await workspace.ensureWorkspace("/test/workspace");

    expect(mockFs.get(path.join(dir, "AGENTS.md"))).toBe(existingContent);
  });

  it("does not create BOOTSTRAP.md for existing workspace", async () => {
    const dir = path.resolve("/test/workspace");
    // Pre-populate at least one file so it's not "brand new"
    mockFs.set(path.join(dir, "AGENTS.md"), "existing agents");

    const result = await workspace.ensureWorkspace("/test/workspace");
    expect(result.created).toBe(false);
    // BOOTSTRAP.md should NOT be created (not brand new)
    expect(mockFs.has(path.join(dir, "BOOTSTRAP.md"))).toBe(false);
  });

  it("reports created=false for existing workspace with some files", async () => {
    const dir = path.resolve("/test/workspace");
    mockFs.set(path.join(dir, "SOUL.md"), "existing soul");

    const result = await workspace.ensureWorkspace("/test/workspace");
    expect(result.created).toBe(false);
  });
});

// ===========================================================================
// loadBootstrapFiles
// ===========================================================================
describe("loadBootstrapFiles", () => {
  it("loads files from workspace directory", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "AGENTS.md"), "agents content");
    mockFs.set(path.join(dir, "SOUL.md"), "soul content");

    const files = await workspace.loadBootstrapFiles("/test/ws");

    const agents = files.find((f) => f.name === "AGENTS.md");
    expect(agents).toBeDefined();
    expect(agents!.content).toBe("agents content");
    expect(agents!.missing).toBe(false);

    const soul = files.find((f) => f.name === "SOUL.md");
    expect(soul).toBeDefined();
    expect(soul!.content).toBe("soul content");
    expect(soul!.missing).toBe(false);
  });

  it("marks missing files appropriately", async () => {
    const files = await workspace.loadBootstrapFiles("/test/ws");

    // All files should be missing since we didn't create any
    for (const file of files) {
      expect(file.missing).toBe(true);
    }
  });

  it("prefers global identity files over workspace files", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "IDENTITY.md"), "workspace identity");
    mockFs.set(path.join(MOCK_GLOBAL_IDENTITY_DIR, "IDENTITY.md"), "global identity");

    const files = await workspace.loadBootstrapFiles("/test/ws");
    const identity = files.find((f) => f.name === "IDENTITY.md");

    expect(identity).toBeDefined();
    expect(identity!.content).toBe("global identity");
    expect(identity!.path).toBe(path.join(MOCK_GLOBAL_IDENTITY_DIR, "IDENTITY.md"));
  });

  it("falls back to workspace files when global is missing", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "IDENTITY.md"), "workspace identity");

    const files = await workspace.loadBootstrapFiles("/test/ws");
    const identity = files.find((f) => f.name === "IDENTITY.md");

    expect(identity).toBeDefined();
    expect(identity!.content).toBe("workspace identity");
    expect(identity!.path).toBe(path.join(dir, "IDENTITY.md"));
  });

  it("returns all 7 expected bootstrap files", async () => {
    const files = await workspace.loadBootstrapFiles("/test/ws");
    expect(files).toHaveLength(7);

    const names = files.map((f) => f.name);
    expect(names).toContain("AGENTS.md");
    expect(names).toContain("SOUL.md");
    expect(names).toContain("TOOLS.md");
    expect(names).toContain("IDENTITY.md");
    expect(names).toContain("USER.md");
    expect(names).toContain("HEARTBEAT.md");
    expect(names).toContain("BOOTSTRAP.md");
  });
});

// ===========================================================================
// parseIdentity
// ===========================================================================
describe("parseIdentity", () => {
  it("parses all identity fields", () => {
    const content = `# IDENTITY.md - Agent Identity

- Name: TestBot
- Creature: Cat
- Vibe: Friendly, warm
- Emoji: 🐱`;

    const identity = workspace.parseIdentity(content);
    expect(identity.name).toBe("TestBot");
    expect(identity.creature).toBe("Cat");
    expect(identity.vibe).toBe("Friendly, warm");
    expect(identity.emoji).toBe("🐱");
  });

  it("returns empty object for content with no matching fields", () => {
    const identity = workspace.parseIdentity("# Just a heading\nSome random text");
    expect(identity).toEqual({});
  });

  it("handles partial identity", () => {
    const content = `- Name: PartialBot`;
    const identity = workspace.parseIdentity(content);
    expect(identity.name).toBe("PartialBot");
    expect(identity.creature).toBeUndefined();
    expect(identity.vibe).toBeUndefined();
    expect(identity.emoji).toBeUndefined();
  });

  it("trims whitespace from values", () => {
    const content = `- Name:   SpaceyBot   `;
    const identity = workspace.parseIdentity(content);
    expect(identity.name).toBe("SpaceyBot");
  });

  it("is case-insensitive for field labels", () => {
    const content = `- name: lower
- CREATURE: UPPER
- Vibe: Mixed
- emoji: 🎯`;
    const identity = workspace.parseIdentity(content);
    expect(identity.name).toBe("lower");
    expect(identity.creature).toBe("UPPER");
    expect(identity.vibe).toBe("Mixed");
    expect(identity.emoji).toBe("🎯");
  });

  it("handles empty content", () => {
    const identity = workspace.parseIdentity("");
    expect(identity).toEqual({});
  });
});

// ===========================================================================
// parseUserProfile
// ===========================================================================
describe("parseUserProfile", () => {
  it("parses all user profile fields", () => {
    const content = `# USER.md - User Profile

- Name: Alice
- Preferred address: Dr. Alice
- Pronouns (optional): she/her
- Timezone (optional): UTC-5
- Notes: Likes cats`;

    const profile = workspace.parseUserProfile(content);
    expect(profile.name).toBe("Alice");
    expect(profile.preferredAddress).toBe("Dr. Alice");
    expect(profile.pronouns).toBe("she/her");
    expect(profile.timezone).toBe("UTC-5");
    expect(profile.notes).toBe("Likes cats");
  });

  it("returns empty object for content with no matching fields", () => {
    const profile = workspace.parseUserProfile("# Nothing here\nfoo bar");
    expect(profile).toEqual({});
  });

  it("handles partial profile", () => {
    const content = `- Name: Bob`;
    const profile = workspace.parseUserProfile(content);
    expect(profile.name).toBe("Bob");
    expect(profile.preferredAddress).toBeUndefined();
  });

  it("handles empty content", () => {
    const profile = workspace.parseUserProfile("");
    expect(profile).toEqual({});
  });
});

// ===========================================================================
// resolveIdentity
// ===========================================================================
describe("resolveIdentity", () => {
  it("loads identity from global identity directory first", async () => {
    mockFs.set(
      path.join(MOCK_GLOBAL_IDENTITY_DIR, "IDENTITY.md"),
      `- Name: GlobalBot\n- Emoji: 🌍`,
    );

    const identity = await workspace.resolveIdentity("/test/ws");
    expect(identity.name).toBe("GlobalBot");
    expect(identity.emoji).toBe("🌍");
  });

  it("falls back to workspace identity when global is missing", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "IDENTITY.md"), `- Name: LocalBot\n- Emoji: 🏠`);

    const identity = await workspace.resolveIdentity("/test/ws");
    expect(identity.name).toBe("LocalBot");
    expect(identity.emoji).toBe("🏠");
  });

  it("returns defaults when no identity files exist", async () => {
    const identity = await workspace.resolveIdentity("/test/ws");
    expect(identity.name).toBe("WOPR");
    expect(identity.emoji).toBe("🤖");
  });
});

// ===========================================================================
// resolveUserProfile
// ===========================================================================
describe("resolveUserProfile", () => {
  it("loads user profile from global identity directory first", async () => {
    mockFs.set(
      path.join(MOCK_GLOBAL_IDENTITY_DIR, "USER.md"),
      `- Name: GlobalUser\n- Preferred address: Dr. Global`,
    );

    const profile = await workspace.resolveUserProfile("/test/ws");
    expect(profile.name).toBe("GlobalUser");
    expect(profile.preferredAddress).toBe("Dr. Global");
  });

  it("falls back to workspace user profile when global is missing", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "USER.md"), `- Name: LocalUser`);

    const profile = await workspace.resolveUserProfile("/test/ws");
    expect(profile.name).toBe("LocalUser");
  });

  it("returns empty profile when no user files exist", async () => {
    const profile = await workspace.resolveUserProfile("/test/ws");
    expect(profile).toEqual({});
  });
});

// ===========================================================================
// getDefaultAckReaction / resolveAckReaction
// ===========================================================================
describe("getDefaultAckReaction", () => {
  it("returns eyes emoji", () => {
    expect(workspace.getDefaultAckReaction()).toBe("👀");
  });
});

describe("resolveAckReaction", () => {
  it("returns identity emoji when available", async () => {
    mockFs.set(path.join(MOCK_GLOBAL_IDENTITY_DIR, "IDENTITY.md"), `- Emoji: 🐱`);
    const reaction = await workspace.resolveAckReaction("/test/ws");
    expect(reaction).toBe("🐱");
  });

  it("uses default identity emoji when no identity file exists", async () => {
    // resolveIdentity returns { name: "WOPR", emoji: "🤖" } when no files exist
    const reaction = await workspace.resolveAckReaction("/test/ws");
    expect(reaction).toBe("🤖");
  });

  it("falls back to default when identity emoji is whitespace", async () => {
    mockFs.set(path.join(MOCK_GLOBAL_IDENTITY_DIR, "IDENTITY.md"), `- Emoji:   `);
    const reaction = await workspace.resolveAckReaction("/test/ws");
    expect(reaction).toBe("👀");
  });
});

// ===========================================================================
// resolveMessagePrefix
// ===========================================================================
describe("resolveMessagePrefix", () => {
  it("returns name wrapped in brackets when identity has name", async () => {
    mockFs.set(path.join(MOCK_GLOBAL_IDENTITY_DIR, "IDENTITY.md"), `- Name: TestBot`);
    const prefix = await workspace.resolveMessagePrefix("/test/ws");
    expect(prefix).toBe("[TestBot]");
  });

  it("returns fallback when no identity name", async () => {
    const prefix = await workspace.resolveMessagePrefix("/test/ws");
    expect(prefix).toBe("[WOPR]");
  });

  it("uses custom fallback", async () => {
    // No global/workspace identity so it will use defaults (name=WOPR)
    // But since resolveIdentity returns {name: "WOPR"} as default, prefix should be [WOPR]
    const prefix = await workspace.resolveMessagePrefix("/test/ws", "[Custom]");
    // resolveIdentity returns name: "WOPR" when no files, so it uses that
    expect(prefix).toBe("[WOPR]");
  });

  it("uses custom fallback when identity name is whitespace", async () => {
    mockFs.set(path.join(MOCK_GLOBAL_IDENTITY_DIR, "IDENTITY.md"), `- Name:   `);
    const prefix = await workspace.resolveMessagePrefix("/test/ws", "[Fallback]");
    expect(prefix).toBe("[Fallback]");
  });
});

// ===========================================================================
// formatBootstrapContext
// ===========================================================================
describe("formatBootstrapContext", () => {
  it("formats files with content as XML comments + content", () => {
    const files: import("../../src/core/workspace.js").BootstrapFile[] = [
      { name: "AGENTS.md", path: "/test/AGENTS.md", content: "agents content", missing: false },
    ];

    const result = workspace.formatBootstrapContext(files);
    expect(result).toContain("<!-- AGENTS.md -->");
    expect(result).toContain("agents content");
  });

  it("marks missing files with XML comment", () => {
    const files: import("../../src/core/workspace.js").BootstrapFile[] = [
      { name: "SOUL.md", path: "/test/SOUL.md", missing: true },
    ];

    const result = workspace.formatBootstrapContext(files);
    expect(result).toContain("<!-- SOUL.md: missing -->");
  });

  it("marks empty files with XML comment", () => {
    const files: import("../../src/core/workspace.js").BootstrapFile[] = [
      { name: "TOOLS.md", path: "/test/TOOLS.md", content: "", missing: false },
    ];

    const result = workspace.formatBootstrapContext(files);
    expect(result).toContain("<!-- TOOLS.md: empty -->");
  });

  it("marks whitespace-only files as empty", () => {
    const files: import("../../src/core/workspace.js").BootstrapFile[] = [
      { name: "TOOLS.md", path: "/test/TOOLS.md", content: "   \n  ", missing: false },
    ];

    const result = workspace.formatBootstrapContext(files);
    expect(result).toContain("<!-- TOOLS.md: empty -->");
  });

  it("handles multiple files correctly", () => {
    const files: import("../../src/core/workspace.js").BootstrapFile[] = [
      { name: "AGENTS.md", path: "/test/AGENTS.md", content: "agents", missing: false },
      { name: "SOUL.md", path: "/test/SOUL.md", missing: true },
      { name: "TOOLS.md", path: "/test/TOOLS.md", content: "tools", missing: false },
    ];

    const result = workspace.formatBootstrapContext(files);
    expect(result).toContain("<!-- AGENTS.md -->");
    expect(result).toContain("agents");
    expect(result).toContain("<!-- SOUL.md: missing -->");
    expect(result).toContain("<!-- TOOLS.md -->");
    expect(result).toContain("tools");
  });

  it("returns empty string for no files", () => {
    const result = workspace.formatBootstrapContext([]);
    expect(result).toBe("");
  });
});

// ===========================================================================
// decideSoulEvil
// ===========================================================================
describe("decideSoulEvil", () => {
  it("returns useEvil=false when no config", () => {
    const decision = workspace.decideSoulEvil();
    expect(decision.useEvil).toBe(false);
    expect(decision.fileName).toBe("SOUL_EVIL.md");
  });

  it("returns useEvil=false when config has no chance and no purge", () => {
    const decision = workspace.decideSoulEvil({});
    expect(decision.useEvil).toBe(false);
  });

  it("uses custom file name", () => {
    const decision = workspace.decideSoulEvil({ file: "CUSTOM_EVIL.md" });
    expect(decision.fileName).toBe("CUSTOM_EVIL.md");
  });

  it("defaults to SOUL_EVIL.md when file not specified", () => {
    const decision = workspace.decideSoulEvil({});
    expect(decision.fileName).toBe("SOUL_EVIL.md");
  });

  describe("chance-based activation", () => {
    it("activates when chance=1 (100%)", () => {
      // With chance=1, Math.random() < 1 is always true
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const decision = workspace.decideSoulEvil({ chance: 1 });
      expect(decision.useEvil).toBe(true);
      expect(decision.reason).toBe("chance");
    });

    it("does not activate when chance=0", () => {
      const decision = workspace.decideSoulEvil({ chance: 0 });
      expect(decision.useEvil).toBe(false);
    });

    it("activates when random < chance", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.1);
      const decision = workspace.decideSoulEvil({ chance: 0.5 });
      expect(decision.useEvil).toBe(true);
      expect(decision.reason).toBe("chance");
    });

    it("does not activate when random >= chance", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.8);
      const decision = workspace.decideSoulEvil({ chance: 0.5 });
      expect(decision.useEvil).toBe(false);
    });

    it("clamps chance above 1 to 1", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      const decision = workspace.decideSoulEvil({ chance: 5 });
      expect(decision.useEvil).toBe(true);
    });

    it("clamps negative chance to 0", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.001);
      const decision = workspace.decideSoulEvil({ chance: -1 });
      expect(decision.useEvil).toBe(false);
    });
  });

  describe("purge window activation", () => {
    it("activates during purge window", () => {
      // 14:00, purge at 13:00 for 2h (13:00-15:00)
      const now = new Date("2025-01-01T14:00:00");
      const decision = workspace.decideSoulEvil({ purge: { at: "13:00", duration: "2h" } }, now);
      expect(decision.useEvil).toBe(true);
      expect(decision.reason).toBe("purge");
    });

    it("does not activate outside purge window", () => {
      // 16:00, purge at 13:00 for 2h (13:00-15:00)
      const now = new Date("2025-01-01T16:00:00");
      const decision = workspace.decideSoulEvil({ purge: { at: "13:00", duration: "2h" } }, now);
      expect(decision.useEvil).toBe(false);
    });

    it("purge takes priority over chance", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.99); // would not trigger chance
      const now = new Date("2025-01-01T14:00:00");
      const decision = workspace.decideSoulEvil(
        { chance: 0.5, purge: { at: "13:00", duration: "2h" } },
        now,
      );
      expect(decision.useEvil).toBe(true);
      expect(decision.reason).toBe("purge");
    });

    it("handles purge window wrapping past midnight", () => {
      // 01:00, purge at 23:00 for 3h (23:00-02:00)
      const now = new Date("2025-01-01T01:00:00");
      const decision = workspace.decideSoulEvil({ purge: { at: "23:00", duration: "3h" } }, now);
      expect(decision.useEvil).toBe(true);
      expect(decision.reason).toBe("purge");
    });

    it("handles purge duration >= 24h (always active)", () => {
      const now = new Date("2025-01-01T12:00:00");
      const decision = workspace.decideSoulEvil({ purge: { at: "00:00", duration: "25h" } }, now);
      expect(decision.useEvil).toBe(true);
    });

    it("handles invalid time format gracefully", () => {
      const now = new Date("2025-01-01T12:00:00");
      const decision = workspace.decideSoulEvil(
        { purge: { at: "invalid", duration: "2h" } },
        now,
      );
      expect(decision.useEvil).toBe(false);
    });

    it("handles invalid duration format gracefully", () => {
      const now = new Date("2025-01-01T12:00:00");
      const decision = workspace.decideSoulEvil(
        { purge: { at: "12:00", duration: "invalid" } },
        now,
      );
      expect(decision.useEvil).toBe(false);
    });
  });
});

// ===========================================================================
// applySoulEvilOverride
// ===========================================================================
describe("applySoulEvilOverride", () => {
  const baseSoulFiles: import("../../src/core/workspace.js").BootstrapFile[] = [
    { name: "AGENTS.md", path: "/test/AGENTS.md", content: "agents", missing: false },
    { name: "SOUL.md", path: "/test/SOUL.md", content: "good soul", missing: false },
  ];

  it("returns files unchanged when config is undefined", async () => {
    const result = await workspace.applySoulEvilOverride(baseSoulFiles, "/test/ws");
    expect(result).toEqual(baseSoulFiles);
  });

  it("returns files unchanged when soul evil is not triggered", async () => {
    const result = await workspace.applySoulEvilOverride(baseSoulFiles, "/test/ws", { chance: 0 });
    expect(result).toEqual(baseSoulFiles);
  });

  it("replaces SOUL.md content when evil is active", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "SOUL_EVIL.md"), "evil soul content");

    // Force activation
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await workspace.applySoulEvilOverride(baseSoulFiles, "/test/ws", { chance: 1 });

    const soul = result.find((f) => f.name === "SOUL.md");
    expect(soul).toBeDefined();
    expect(soul!.content).toBe("evil soul content");
    expect(soul!.missing).toBe(false);
  });

  it("does not modify non-SOUL files", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "SOUL_EVIL.md"), "evil content");

    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await workspace.applySoulEvilOverride(baseSoulFiles, "/test/ws", { chance: 1 });

    const agents = result.find((f) => f.name === "AGENTS.md");
    expect(agents!.content).toBe("agents");
  });

  it("returns original files when evil file is missing", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await workspace.applySoulEvilOverride(baseSoulFiles, "/test/ws", { chance: 1 });
    expect(result).toEqual(baseSoulFiles);
  });

  it("returns original files when evil file is empty", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "SOUL_EVIL.md"), "   ");

    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await workspace.applySoulEvilOverride(baseSoulFiles, "/test/ws", { chance: 1 });
    expect(result).toEqual(baseSoulFiles);
  });

  it("returns original files when SOUL.md is not in bootstrap files", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "SOUL_EVIL.md"), "evil content");

    const noSoulFiles: import("../../src/core/workspace.js").BootstrapFile[] = [
      { name: "AGENTS.md", path: "/test/AGENTS.md", content: "agents", missing: false },
    ];

    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await workspace.applySoulEvilOverride(noSoulFiles, "/test/ws", { chance: 1 });
    expect(result).toEqual(noSoulFiles);
  });

  it("uses custom evil file name from config", async () => {
    const dir = workspace.resolveWorkspaceDir("/test/ws");
    mockFs.set(path.join(dir, "CUSTOM_EVIL.md"), "custom evil");

    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await workspace.applySoulEvilOverride(baseSoulFiles, "/test/ws", {
      chance: 1,
      file: "CUSTOM_EVIL.md",
    });

    const soul = result.find((f) => f.name === "SOUL.md");
    expect(soul!.content).toBe("custom evil");
  });
});

// ===========================================================================
// Default constants
// ===========================================================================
describe("default constants", () => {
  it("exports expected default filenames", () => {
    expect(workspace.DEFAULT_AGENTS_FILENAME).toBe("AGENTS.md");
    expect(workspace.DEFAULT_SOUL_FILENAME).toBe("SOUL.md");
    expect(workspace.DEFAULT_TOOLS_FILENAME).toBe("TOOLS.md");
    expect(workspace.DEFAULT_IDENTITY_FILENAME).toBe("IDENTITY.md");
    expect(workspace.DEFAULT_USER_FILENAME).toBe("USER.md");
    expect(workspace.DEFAULT_HEARTBEAT_FILENAME).toBe("HEARTBEAT.md");
    expect(workspace.DEFAULT_BOOTSTRAP_FILENAME).toBe("BOOTSTRAP.md");
    expect(workspace.DEFAULT_SOUL_EVIL_FILENAME).toBe("SOUL_EVIL.md");
  });
});

// ===========================================================================
// Workspace isolation between sessions
// ===========================================================================
describe("workspace isolation", () => {
  it("different custom dirs resolve to different paths", () => {
    const dir1 = workspace.resolveWorkspaceDir("/session/one");
    const dir2 = workspace.resolveWorkspaceDir("/session/two");
    expect(dir1).not.toBe(dir2);
  });

  it("ensureWorkspace creates independent workspaces", async () => {
    const result1 = await workspace.ensureWorkspace("/session/one");
    const result2 = await workspace.ensureWorkspace("/session/two");

    expect(result1.dir).not.toBe(result2.dir);
    expect(result1.created).toBe(true);
    expect(result2.created).toBe(true);

    // Both should have their own AGENTS.md
    expect(mockFs.has(path.join(result1.dir, "AGENTS.md"))).toBe(true);
    expect(mockFs.has(path.join(result2.dir, "AGENTS.md"))).toBe(true);
  });
});
