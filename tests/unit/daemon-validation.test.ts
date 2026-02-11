import { describe, expect, it } from "vitest";
import { assertPathContained, validateSessionName } from "../../src/daemon/validation.js";

describe("validateSessionName", () => {
  it("accepts valid alphanumeric names", () => {
    expect(() => validateSessionName("my-session")).not.toThrow();
    expect(() => validateSessionName("session_01")).not.toThrow();
    expect(() => validateSessionName("test.session")).not.toThrow();
    expect(() => validateSessionName("MySession123")).not.toThrow();
  });

  it("rejects names with path traversal sequences", () => {
    expect(() => validateSessionName("..")).toThrow();
    expect(() => validateSessionName("../etc/passwd")).toThrow();
    expect(() => validateSessionName("foo/../bar")).toThrow();
  });

  it("rejects names with slashes", () => {
    expect(() => validateSessionName("foo/bar")).toThrow();
    expect(() => validateSessionName("/etc/passwd")).toThrow();
    expect(() => validateSessionName("foo\\bar")).toThrow();
  });

  it("rejects names with spaces or special characters", () => {
    expect(() => validateSessionName("foo bar")).toThrow();
    expect(() => validateSessionName("foo;rm -rf")).toThrow();
    expect(() => validateSessionName("session$HOME")).toThrow();
    expect(() => validateSessionName("")).toThrow();
  });
});

describe("assertPathContained", () => {
  it("allows paths within the base directory", () => {
    expect(() => assertPathContained("/tmp/sessions", "my-session")).not.toThrow();
  });

  it("rejects paths that escape the base directory", () => {
    expect(() => assertPathContained("/tmp/sessions", "../../etc")).toThrow();
  });
});
