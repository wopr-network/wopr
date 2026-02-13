/**
 * Tests for redactSensitive utility (WOP-234)
 */
import { describe, expect, it } from "vitest";
import { redactSensitive } from "../../src/security/redact.js";

describe("redactSensitive", () => {
  it("returns null/undefined unchanged", () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
  });

  it("returns non-sensitive primitives unchanged", () => {
    expect(redactSensitive("hello", "name")).toBe("hello");
    expect(redactSensitive(42, "port")).toBe(42);
    expect(redactSensitive(true, "enabled")).toBe(true);
  });

  it("redacts values whose key contains 'apikey'", () => {
    expect(redactSensitive("sk-abc123", "anthropic.apiKey")).toBe("[REDACTED]");
  });

  it("redacts values whose key contains 'api_key'", () => {
    expect(redactSensitive("sk-abc123", "anthropic.api_key")).toBe("[REDACTED]");
  });

  it("redacts values whose key contains 'secret'", () => {
    expect(redactSensitive("s3cr3t", "oauth.clientSecret")).toBe("[REDACTED]");
  });

  it("redacts values whose key contains 'token'", () => {
    expect(redactSensitive("discord-token", "discord.token")).toBe("[REDACTED]");
  });

  it("redacts values whose key contains 'password'", () => {
    expect(redactSensitive("p@ss", "db.password")).toBe("[REDACTED]");
  });

  it("redacts values whose key contains 'private'", () => {
    expect(redactSensitive("key-data", "ssh.privateKey")).toBe("[REDACTED]");
    expect(redactSensitive("key-data", "ssh.private_key")).toBe("[REDACTED]");
  });

  it("recursively redacts nested objects", () => {
    const input = {
      anthropic: { apiKey: "sk-real-key" },
      daemon: { port: 7437, host: "127.0.0.1" },
      oauth: { clientId: "id123", clientSecret: "secret456" },
      discord: { token: "bot-token", guildId: "12345" },
    };
    const result = redactSensitive(input);

    expect(result.anthropic.apiKey).toBe("[REDACTED]");
    expect(result.daemon.port).toBe(7437);
    expect(result.daemon.host).toBe("127.0.0.1");
    expect(result.oauth.clientId).toBe("id123");
    expect(result.oauth.clientSecret).toBe("[REDACTED]");
    expect(result.discord.token).toBe("[REDACTED]");
    expect(result.discord.guildId).toBe("12345");
  });

  it("handles arrays", () => {
    const input = [{ token: "abc" }, { name: "safe" }];
    const result = redactSensitive(input);
    expect(result[0].token).toBe("[REDACTED]");
    expect(result[1].name).toBe("safe");
  });

  it("does not mutate the original object", () => {
    const input = { anthropic: { apiKey: "sk-real-key" } };
    redactSensitive(input);
    expect(input.anthropic.apiKey).toBe("sk-real-key");
  });
});
