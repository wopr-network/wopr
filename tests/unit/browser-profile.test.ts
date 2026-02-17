/**
 * Browser Profile Persistence Tests (WOP-109)
 *
 * Tests async Storage API-backed browser profile operations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";

// Mock WOPR_HOME to a temp directory
const TEST_DB_DIR = `/tmp/wopr-test-browser-profiles-${randomBytes(4).toString("hex")}`;

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: TEST_DB_DIR,
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Browser Profile", () => {
  beforeEach(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });

    // Initialize storage
    const { getStorage, resetStorage } = await import("../../src/storage/index.js");
    resetStorage();
    getStorage(); // Trigger init

    // Initialize browser profile storage
    const { initBrowserProfileStorage } = await import("../../src/core/browser-profile-repository.js");
    await initBrowserProfileStorage();
  });

  afterEach(async () => {
    const { resetStorage } = await import("../../src/storage/index.js");
    resetStorage();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    vi.resetModules();
  });

  describe("loadProfile", () => {
    it("should return empty profile when none exists", async () => {
      const { loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");
      const profile = await loadProfile("test");
      expect(profile.name).toBe("test");
      expect(profile.cookies).toEqual([]);
      expect(profile.localStorage).toEqual({});
    });

    it("should load existing profile from storage", async () => {
      const { loadProfile, saveProfile } = await import("../../src/core/a2a-tools/browser-profile.js");

      const saved = {
        name: "myprofile",
        cookies: [{ name: "sid", value: "abc", domain: ".example.com", path: "/" }],
        localStorage: {},
        updatedAt: 1000,
      };
      await saveProfile(saved);

      const profile = await loadProfile("myprofile");
      expect(profile.name).toBe("myprofile");
      expect(profile.cookies).toHaveLength(1);
      expect(profile.cookies[0].name).toBe("sid");
    });

    it("should create profile on first access", async () => {
      const { loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");
      const profile = await loadProfile("new-profile");
      expect(profile.name).toBe("new-profile");
      expect(profile.cookies).toEqual([]);
      expect(profile.localStorage).toEqual({});
    });
  });

  describe("saveProfile", () => {
    it("should write profile to storage", async () => {
      const { saveProfile, loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");

      const profile = {
        name: "saved",
        cookies: [{ name: "token", value: "xyz", domain: ".test.com", path: "/" }],
        localStorage: {},
        updatedAt: 0,
      };
      await saveProfile(profile);

      const loaded = await loadProfile("saved");
      expect(loaded.cookies).toHaveLength(1);
      expect(loaded.cookies[0].name).toBe("token");
      expect(loaded.updatedAt).toBeGreaterThan(0);
    });

    it("should update cookies on save", async () => {
      const { saveProfile, loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");

      const profile = {
        name: "update-test",
        cookies: [{ name: "old", value: "val1", domain: ".test.com", path: "/" }],
        localStorage: {},
        updatedAt: 0,
      };
      await saveProfile(profile);

      // Update cookies
      profile.cookies = [{ name: "new", value: "val2", domain: ".test.com", path: "/" }];
      await saveProfile(profile);

      const loaded = await loadProfile("update-test");
      expect(loaded.cookies).toHaveLength(1);
      expect(loaded.cookies[0].name).toBe("new");
    });

    it("should store localStorage data", async () => {
      const { saveProfile, loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");

      const profile = {
        name: "localstorage-test",
        cookies: [],
        localStorage: {
          "https://example.com": { key1: "value1", key2: "value2" },
        },
        updatedAt: 0,
      };
      await saveProfile(profile);

      const loaded = await loadProfile("localstorage-test");
      expect(loaded.localStorage["https://example.com"]).toEqual({ key1: "value1", key2: "value2" });
    });
  });

  describe("listProfiles", () => {
    it("should return empty list when no profiles exist", async () => {
      const { listProfiles } = await import("../../src/core/a2a-tools/browser-profile.js");
      const profiles = await listProfiles();
      expect(profiles).toEqual([]);
    });

    it("should list profile names", async () => {
      const { saveProfile, listProfiles } = await import("../../src/core/a2a-tools/browser-profile.js");

      await saveProfile({
        name: "profile1",
        cookies: [],
        localStorage: {},
        updatedAt: 0,
      });
      await saveProfile({
        name: "profile2",
        cookies: [],
        localStorage: {},
        updatedAt: 0,
      });

      const profiles = await listProfiles();
      expect(profiles).toHaveLength(2);
      expect(profiles).toContain("profile1");
      expect(profiles).toContain("profile2");
    });
  });

  describe("cookie handling", () => {
    it("should preserve cookie metadata", async () => {
      const { saveProfile, loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");

      const profile = {
        name: "cookie-metadata",
        cookies: [
          {
            name: "secure-cookie",
            value: "secret",
            domain: ".example.com",
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now in seconds
            httpOnly: true,
            secure: true,
            sameSite: "Strict" as const,
          },
        ],
        localStorage: {},
        updatedAt: 0,
      };
      await saveProfile(profile);

      const loaded = await loadProfile("cookie-metadata");
      expect(loaded.cookies[0].httpOnly).toBe(true);
      expect(loaded.cookies[0].secure).toBe(true);
      expect(loaded.cookies[0].sameSite).toBe("Strict");
      expect(loaded.cookies[0].expires).toBeDefined();
    });

    it("should handle multiple cookies", async () => {
      const { saveProfile, loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");

      const profile = {
        name: "multi-cookie",
        cookies: [
          { name: "cookie1", value: "val1", domain: ".test.com", path: "/" },
          { name: "cookie2", value: "val2", domain: ".test.com", path: "/" },
          { name: "cookie3", value: "val3", domain: ".test.com", path: "/" },
        ],
        localStorage: {},
        updatedAt: 0,
      };
      await saveProfile(profile);

      const loaded = await loadProfile("multi-cookie");
      expect(loaded.cookies).toHaveLength(3);
      const names = loaded.cookies.map((c) => c.name);
      expect(names).toContain("cookie1");
      expect(names).toContain("cookie2");
      expect(names).toContain("cookie3");
    });
  });

  describe("localStorage handling", () => {
    it("should handle multiple origins", async () => {
      const { saveProfile, loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");

      const profile = {
        name: "multi-origin",
        cookies: [],
        localStorage: {
          "https://example.com": { key1: "value1" },
          "https://test.com": { key2: "value2" },
        },
        updatedAt: 0,
      };
      await saveProfile(profile);

      const loaded = await loadProfile("multi-origin");
      expect(loaded.localStorage["https://example.com"]).toEqual({ key1: "value1" });
      expect(loaded.localStorage["https://test.com"]).toEqual({ key2: "value2" });
    });

    it("should replace localStorage on update", async () => {
      const { saveProfile, loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");

      const profile = {
        name: "localstorage-replace",
        cookies: [],
        localStorage: {
          "https://example.com": { old: "data" },
        },
        updatedAt: 0,
      };
      await saveProfile(profile);

      // Update localStorage
      profile.localStorage = {
        "https://example.com": { new: "data" },
      };
      await saveProfile(profile);

      const loaded = await loadProfile("localstorage-replace");
      expect(loaded.localStorage["https://example.com"]).toEqual({ new: "data" });
      expect(loaded.localStorage["https://example.com"]).not.toHaveProperty("old");
    });
  });

  describe("profile isolation", () => {
    it("should keep profiles separate", async () => {
      const { saveProfile, loadProfile } = await import("../../src/core/a2a-tools/browser-profile.js");

      await saveProfile({
        name: "profile-a",
        cookies: [{ name: "a-cookie", value: "a-val", domain: ".a.com", path: "/" }],
        localStorage: {},
        updatedAt: 0,
      });

      await saveProfile({
        name: "profile-b",
        cookies: [{ name: "b-cookie", value: "b-val", domain: ".b.com", path: "/" }],
        localStorage: {},
        updatedAt: 0,
      });

      const profileA = await loadProfile("profile-a");
      const profileB = await loadProfile("profile-b");

      expect(profileA.cookies[0].name).toBe("a-cookie");
      expect(profileB.cookies[0].name).toBe("b-cookie");
    });
  });
});
