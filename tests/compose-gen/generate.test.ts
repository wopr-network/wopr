import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateCompose } from "../../src/compose-gen/generate.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `wopr-compose-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("generateCompose", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty when no profiles found", () => {
    const result = generateCompose(tmpDir);
    expect(result.profiles).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.yaml).toBe("");
  });

  it("returns error for missing bots directory", () => {
    const result = generateCompose(join(tmpDir, "nonexistent"));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("not found");
  });

  it("generates compose for a valid profile", () => {
    const botDir = join(tmpDir, "test-bot");
    mkdirSync(botDir);
    writeFileSync(
      join(botDir, "profile.yaml"),
      `
name: test-bot
description: A test bot
release_channel: stable
update_policy: nightly
plugins:
  channels: [discord]
  providers: [anthropic]
  voice: []
  other: [memory-semantic]
resources:
  memory: 512m
  restart: unless-stopped
volumes:
  persist: true
health:
  check: true
  alert_on_failure: true
`,
    );

    const result = generateCompose(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].name).toBe("test-bot");
    expect(result.yaml).toContain("test-bot");
    expect(result.yaml).toContain("ghcr.io/wopr-network/wopr:latest");
    expect(result.yaml).toContain("test-bot-data:/data");
    expect(result.yaml).toContain("com.centurylinklabs.watchtower.enable");
    expect(result.yaml).toContain("bots/test-bot/.env");
    expect(result.yaml).toContain("wopr-net");
    expect(result.yaml).toContain("AUTO-GENERATED");
  });

  it("handles canary release channel", () => {
    const botDir = join(tmpDir, "canary-bot");
    mkdirSync(botDir);
    writeFileSync(
      join(botDir, "profile.yaml"),
      `
name: canary-bot
release_channel: canary
update_policy: on-merge
`,
    );

    const result = generateCompose(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.yaml).toContain("ghcr.io/wopr-network/wopr:canary");
  });

  it("handles pinned release channel", () => {
    const botDir = join(tmpDir, "pinned-bot");
    mkdirSync(botDir);
    writeFileSync(
      join(botDir, "profile.yaml"),
      `
name: pinned-bot
release_channel: "pinned:v1.2.3"
update_policy: manual
`,
    );

    const result = generateCompose(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.yaml).toContain("ghcr.io/wopr-network/wopr:v1.2.3");
    expect(result.yaml).toContain('"false"');
  });

  it("generates multiple services", () => {
    for (const name of ["bot-a", "bot-b", "bot-c"]) {
      const botDir = join(tmpDir, name);
      mkdirSync(botDir);
      writeFileSync(join(botDir, "profile.yaml"), `name: ${name}\n`);
    }

    const result = generateCompose(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.profiles).toHaveLength(3);
    expect(result.yaml).toContain("bot-a");
    expect(result.yaml).toContain("bot-b");
    expect(result.yaml).toContain("bot-c");
  });

  it("skips _templates directory", () => {
    const tplDir = join(tmpDir, "_templates");
    mkdirSync(tplDir);
    writeFileSync(join(tplDir, "profile.yaml"), "name: should-skip\n");

    const result = generateCompose(tmpDir);
    expect(result.profiles).toHaveLength(0);
  });

  it("reports validation errors for invalid profiles", () => {
    const botDir = join(tmpDir, "bad-bot");
    mkdirSync(botDir);
    writeFileSync(join(botDir, "profile.yaml"), "name: INVALID NAME!!\n");

    const result = generateCompose(tmpDir);
    expect(result.errors).toHaveLength(1);
    expect(result.profiles).toHaveLength(0);
  });

  it("reports YAML parse errors", () => {
    const botDir = join(tmpDir, "malformed");
    mkdirSync(botDir);
    writeFileSync(join(botDir, "profile.yaml"), ":\n  :\n    - [invalid yaml{{{}");

    const result = generateCompose(tmpDir);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("YAML parse error");
  });

  it("omits volumes section when persist is false", () => {
    const botDir = join(tmpDir, "no-vol");
    mkdirSync(botDir);
    writeFileSync(
      join(botDir, "profile.yaml"),
      `
name: no-vol
volumes:
  persist: false
`,
    );

    const result = generateCompose(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.yaml).not.toContain("no-vol-data");
  });

  it("omits healthcheck when check is false", () => {
    const botDir = join(tmpDir, "no-health");
    mkdirSync(botDir);
    writeFileSync(
      join(botDir, "profile.yaml"),
      `
name: no-health
health:
  check: false
`,
    );

    const result = generateCompose(tmpDir);
    expect(result.errors).toHaveLength(0);
    expect(result.yaml).not.toContain("healthcheck");
  });

  it("continues generating with mix of valid and invalid profiles", () => {
    const goodDir = join(tmpDir, "good-bot");
    mkdirSync(goodDir);
    writeFileSync(join(goodDir, "profile.yaml"), "name: good-bot\n");

    const badDir = join(tmpDir, "bad-bot");
    mkdirSync(badDir);
    writeFileSync(join(badDir, "profile.yaml"), "name: INVALID!!\n");

    const result = generateCompose(tmpDir);
    expect(result.errors).toHaveLength(1);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].name).toBe("good-bot");
  });
});
