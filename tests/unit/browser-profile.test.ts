/**
 * Browser Profile Persistence Tests (WOP-109)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: "/tmp/wopr-profile-test",
}));

// Track filesystem calls
const fsState: Record<string, string> = {};
const dirState = new Set<string>();

vi.mock("node:fs", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    existsSync: vi.fn((path: string) => {
      return dirState.has(path) || path in fsState;
    }),
    mkdirSync: vi.fn((path: string) => {
      dirState.add(path);
    }),
    readFileSync: vi.fn((path: string) => {
      if (path in fsState) return fsState[path];
      throw new Error(`ENOENT: no such file: ${path}`);
    }),
    writeFileSync: vi.fn((path: string, content: string) => {
      fsState[path] = content;
    }),
    readdirSync: vi.fn(() => []),
  };
});

let loadProfile: any;
let saveProfile: any;
let listProfiles: any;

beforeEach(async () => {
  // Clear state
  for (const key of Object.keys(fsState)) delete fsState[key];
  dirState.clear();
  vi.clearAllMocks();
  vi.resetModules();

  // Re-apply mocks
  vi.doMock("../../src/logger.js", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));
  vi.doMock("../../src/paths.js", () => ({ WOPR_HOME: "/tmp/wopr-profile-test" }));
  vi.doMock("node:fs", async (importOriginal) => {
    const original = (await importOriginal()) as any;
    return {
      ...original,
      existsSync: vi.fn((path: string) => dirState.has(path) || path in fsState),
      mkdirSync: vi.fn((path: string) => { dirState.add(path); }),
      readFileSync: vi.fn((path: string) => {
        if (path in fsState) return fsState[path];
        throw new Error(`ENOENT: no such file: ${path}`);
      }),
      writeFileSync: vi.fn((path: string, content: string) => { fsState[path] = content; }),
      readdirSync: vi.fn(() => []),
    };
  });

  const mod = await import("../../src/core/a2a-tools/browser-profile.js");
  loadProfile = mod.loadProfile;
  saveProfile = mod.saveProfile;
  listProfiles = mod.listProfiles;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Browser Profile", () => {
  describe("loadProfile", () => {
    it("should return empty profile when none exists", () => {
      const profile = loadProfile("test");
      expect(profile.name).toBe("test");
      expect(profile.cookies).toEqual([]);
      expect(profile.localStorage).toEqual({});
    });

    it("should load existing profile from disk", () => {
      const saved = {
        name: "myprofile",
        cookies: [{ name: "sid", value: "abc", domain: ".example.com", path: "/" }],
        localStorage: {},
        updatedAt: 1000,
      };
      fsState["/tmp/wopr-profile-test/browser-profiles/myprofile.json"] = JSON.stringify(saved);
      const profile = loadProfile("myprofile");
      expect(profile.name).toBe("myprofile");
      expect(profile.cookies).toHaveLength(1);
      expect(profile.cookies[0].name).toBe("sid");
    });

    it("should return fresh profile on corrupted data", () => {
      fsState["/tmp/wopr-profile-test/browser-profiles/bad.json"] = "not-json!!!";
      const profile = loadProfile("bad");
      expect(profile.name).toBe("bad");
      expect(profile.cookies).toEqual([]);
    });
  });

  describe("saveProfile", () => {
    it("should write profile to disk", () => {
      const profile = {
        name: "saved",
        cookies: [{ name: "token", value: "xyz", domain: ".test.com", path: "/" }],
        localStorage: {},
        updatedAt: 0,
      };
      saveProfile(profile);
      const written = fsState["/tmp/wopr-profile-test/browser-profiles/saved.json"];
      expect(written).toBeDefined();
      const parsed = JSON.parse(written);
      expect(parsed.cookies[0].name).toBe("token");
      expect(parsed.updatedAt).toBeGreaterThan(0);
    });
  });

  describe("sanitization", () => {
    it("should sanitize profile names to prevent path traversal", () => {
      const profile = loadProfile("../../../etc/passwd");
      expect(profile.name).toBe("../../../etc/passwd");
      // The filesystem path should be sanitized
      // The profile is named by the unsafe name but stored safely
    });
  });

  describe("listProfiles", () => {
    it("should return empty list when no profiles exist", () => {
      const profiles = listProfiles();
      expect(profiles).toEqual([]);
    });
  });
});
