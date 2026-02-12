import { describe, it, expect } from "vitest";
import { profileSchema } from "../../src/compose-gen/profile-schema.js";

describe("profileSchema", () => {
  it("validates a minimal profile (name only)", () => {
    const result = profileSchema.safeParse({ name: "my-bot" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("my-bot");
      expect(result.data.release_channel).toBe("stable");
      expect(result.data.update_policy).toBe("nightly");
      expect(result.data.resources.memory).toBe("512m");
      expect(result.data.volumes.persist).toBe(true);
      expect(result.data.health.check).toBe(true);
    }
  });

  it("validates a full profile", () => {
    const result = profileSchema.safeParse({
      name: "prod-bot",
      description: "Production bot",
      release_channel: "stable",
      update_policy: "nightly",
      plugins: {
        channels: ["discord", "slack"],
        providers: ["anthropic"],
        voice: ["voice-cli"],
        other: ["memory-semantic", "webhooks"],
      },
      resources: {
        memory: "1g",
        restart: "always",
      },
      volumes: { persist: true },
      health: { check: true, alert_on_failure: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plugins.channels).toEqual(["discord", "slack"]);
      expect(result.data.resources.memory).toBe("1g");
      expect(result.data.health.alert_on_failure).toBe(false);
    }
  });

  it("rejects names with uppercase", () => {
    const result = profileSchema.safeParse({ name: "MyBot" });
    expect(result.success).toBe(false);
  });

  it("rejects names with spaces", () => {
    const result = profileSchema.safeParse({ name: "my bot" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = profileSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = profileSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts pinned release channel", () => {
    const result = profileSchema.safeParse({
      name: "pinned-bot",
      release_channel: "pinned:v2.0.0",
    });
    expect(result.success).toBe(true);
  });

  it("rejects pinned release channel with empty version", () => {
    const result = profileSchema.safeParse({
      name: "pinned-bot",
      release_channel: "pinned:",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid release channel", () => {
    const result = profileSchema.safeParse({
      name: "bad-channel",
      release_channel: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid update policy", () => {
    const result = profileSchema.safeParse({
      name: "bad-policy",
      update_policy: "hourly",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid memory limit", () => {
    const result = profileSchema.safeParse({
      name: "bad-mem",
      resources: { memory: "lots" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid memory limits", () => {
    for (const mem of ["256k", "512m", "1g", "2G"]) {
      const result = profileSchema.safeParse({
        name: "mem-test",
        resources: { memory: mem },
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts names with hyphens and underscores", () => {
    const result = profileSchema.safeParse({ name: "my-cool_bot-1" });
    expect(result.success).toBe(true);
  });

  it("rejects names starting with hyphen", () => {
    const result = profileSchema.safeParse({ name: "-bad" });
    expect(result.success).toBe(false);
  });
});
