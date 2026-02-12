import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set WOPR_HOME before importing profiles so it uses our temp dir
const TEST_DIR = join(tmpdir(), `wopr-fleet-test-${process.pid}`);
process.env.WOPR_HOME = TEST_DIR;

// Dynamic import after setting env
const { createProfile, deleteProfile, getProfile, listProfiles, updateProfile } = await import(
  "../../src/daemon/fleet/profiles.js"
);

describe("fleet profiles", () => {
  beforeEach(() => {
    mkdirSync(join(TEST_DIR, "fleet"), { recursive: true });
    // Start clean
    const profilesFile = join(TEST_DIR, "fleet", "profiles.json");
    if (existsSync(profilesFile)) {
      writeFileSync(profilesFile, "[]");
    }
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("listProfiles returns empty array when no profiles exist", () => {
    const profiles = listProfiles();
    expect(profiles).toEqual([]);
  });

  it("createProfile creates a new profile with defaults", () => {
    const profile = createProfile({ name: "test-bot" });

    expect(profile.name).toBe("test-bot");
    expect(profile.image).toBe("ghcr.io/wopr-network/wopr");
    expect(profile.releaseChannel).toBe("stable");
    expect(profile.restartPolicy).toBe("unless-stopped");
    expect(profile.env).toEqual({});
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(profile.createdAt).toBeTruthy();
    expect(profile.updatedAt).toBeTruthy();
  });

  it("createProfile persists to disk", () => {
    createProfile({ name: "persist-bot" });

    const raw = readFileSync(join(TEST_DIR, "fleet", "profiles.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("persist-bot");
  });

  it("getProfile retrieves a profile by ID", () => {
    const created = createProfile({ name: "findme" });
    const found = getProfile(created.id);

    expect(found).toBeDefined();
    expect(found!.name).toBe("findme");
  });

  it("getProfile returns undefined for unknown ID", () => {
    const found = getProfile("nonexistent-id");
    expect(found).toBeUndefined();
  });

  it("updateProfile updates fields", () => {
    const created = createProfile({ name: "original" });
    const updated = updateProfile(created.id, { name: "renamed", releaseChannel: "canary" });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe("renamed");
    expect(updated!.releaseChannel).toBe("canary");
    expect(updated!.id).toBe(created.id);
    expect(updated!.createdAt).toBe(created.createdAt);
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it("updateProfile returns undefined for unknown ID", () => {
    const result = updateProfile("nonexistent", { name: "nope" });
    expect(result).toBeUndefined();
  });

  it("deleteProfile removes a profile", () => {
    const created = createProfile({ name: "deleteme" });
    const deleted = deleteProfile(created.id);

    expect(deleted).toBe(true);
    expect(getProfile(created.id)).toBeUndefined();
    expect(listProfiles()).toHaveLength(0);
  });

  it("deleteProfile returns false for unknown ID", () => {
    const result = deleteProfile("nonexistent");
    expect(result).toBe(false);
  });

  it("handles multiple profiles", () => {
    createProfile({ name: "bot-1" });
    createProfile({ name: "bot-2" });
    createProfile({ name: "bot-3" });

    const profiles = listProfiles();
    expect(profiles).toHaveLength(3);
    expect(profiles.map((p) => p.name).sort()).toEqual(["bot-1", "bot-2", "bot-3"]);
  });

  it("createProfile respects custom fields", () => {
    const profile = createProfile({
      name: "custom-bot",
      image: "custom-image",
      releaseChannel: "canary",
      env: { TOKEN: "abc" },
      restartPolicy: "always",
      volume: "data-vol",
      labels: { tier: "production" },
    });

    expect(profile.image).toBe("custom-image");
    expect(profile.releaseChannel).toBe("canary");
    expect(profile.env).toEqual({ TOKEN: "abc" });
    expect(profile.restartPolicy).toBe("always");
    expect(profile.volume).toBe("data-vol");
    expect(profile.labels).toEqual({ tier: "production" });
  });
});
