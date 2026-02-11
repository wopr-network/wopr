/**
 * Cron Scripts Tests (WOP-90)
 *
 * Tests for script execution and output templating in cron jobs:
 * - executeCronScript: single script execution with timeout, cwd, error handling
 * - executeCronScripts: serial execution of multiple scripts
 * - resolveScriptTemplates: placeholder replacement in messages
 * - cronScriptsEnabled config gate: scripts rejected when disabled
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Must use static string for vi.mock factory (hoisted above imports)
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/paths.js")>();
  const path = require("node:path");
  const os = require("node:os");
  const dir = path.join(os.tmpdir(), "wopr-test-cron-scripts");
  return {
    ...actual,
    WOPR_HOME: dir,
    CONFIG_FILE: path.join(dir, "config.json"),
    CRONS_FILE: path.join(dir, "crons.json"),
    CRON_HISTORY_FILE: path.join(dir, "cron-history.json"),
  };
});

import {
  executeCronScript,
  executeCronScripts,
  resolveScriptTemplates,
} from "../../src/core/cron.js";
import type { CronScript, CronScriptResult } from "../../src/types.js";

const testDir = join(tmpdir(), "wopr-test-cron-scripts");

beforeEach(() => {
  if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe("executeCronScript", () => {
  it("should execute a simple command and capture stdout", async () => {
    const script: CronScript = {
      name: "greeting",
      command: "echo hello world",
    };
    const result = await executeCronScript(script);
    expect(result.name).toBe("greeting");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.stderr).toBe("");
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should capture stderr from failed commands", async () => {
    const script: CronScript = {
      name: "failing",
      command: "ls /nonexistent-path-that-should-not-exist-12345",
    };
    const result = await executeCronScript(script);
    expect(result.name).toBe("failing");
    expect(result.exitCode).not.toBe(0);
    expect(result.error).toBeDefined();
  });

  it("should respect custom cwd", async () => {
    const script: CronScript = {
      name: "cwd-test",
      command: "pwd",
      cwd: "/tmp",
    };
    const result = await executeCronScript(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("/tmp");
  });

  it("should timeout long-running scripts", async () => {
    const script: CronScript = {
      name: "slow",
      command: "sleep 60",
      timeout: 100, // 100ms timeout
    };
    const result = await executeCronScript(script);
    expect(result.error).toBeDefined();
    expect(result.durationMs).toBeLessThan(5000); // Should fail fast
  });

  it("should use default timeout of 30000ms", async () => {
    const script: CronScript = {
      name: "quick",
      command: "echo fast",
    };
    const result = await executeCronScript(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("fast");
  });

  it("should handle commands with pipes", async () => {
    const script: CronScript = {
      name: "piped",
      command: "echo 'line1\nline2\nline3' | wc -l",
    };
    const result = await executeCronScript(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/\d+/);
  });
});

describe("executeCronScripts", () => {
  it("should execute multiple scripts serially", async () => {
    const scripts: CronScript[] = [
      { name: "first", command: "echo one" },
      { name: "second", command: "echo two" },
      { name: "third", command: "echo three" },
    ];
    const results = await executeCronScripts(scripts);
    expect(results).toHaveLength(3);
    expect(results[0].name).toBe("first");
    expect(results[0].stdout.trim()).toBe("one");
    expect(results[1].name).toBe("second");
    expect(results[1].stdout.trim()).toBe("two");
    expect(results[2].name).toBe("third");
    expect(results[2].stdout.trim()).toBe("three");
  });

  it("should continue executing after a script failure", async () => {
    const scripts: CronScript[] = [
      { name: "ok", command: "echo success" },
      { name: "fail", command: "exit 1" },
      { name: "after", command: "echo still-running" },
    ];
    const results = await executeCronScripts(scripts);
    expect(results).toHaveLength(3);
    expect(results[0].exitCode).toBe(0);
    expect(results[1].exitCode).not.toBe(0);
    expect(results[2].exitCode).toBe(0);
    expect(results[2].stdout.trim()).toBe("still-running");
  });

  it("should return empty array for empty scripts", async () => {
    const results = await executeCronScripts([]);
    expect(results).toHaveLength(0);
  });
});

describe("resolveScriptTemplates", () => {
  it("should replace single placeholder", () => {
    const results: CronScriptResult[] = [
      { name: "status", exitCode: 0, stdout: "all systems go\n", stderr: "", durationMs: 10 },
    ];
    const resolved = resolveScriptTemplates("System: {{status}}", results);
    expect(resolved).toBe("System: all systems go");
  });

  it("should replace multiple placeholders", () => {
    const results: CronScriptResult[] = [
      { name: "services", exitCode: 0, stdout: "nginx: running\n", stderr: "", durationMs: 10 },
      { name: "disk", exitCode: 0, stdout: "50% used\n", stderr: "", durationMs: 10 },
    ];
    const resolved = resolveScriptTemplates(
      "Services:\n{{services}}\n\nDisk:\n{{disk}}",
      results,
    );
    expect(resolved).toBe("Services:\nnginx: running\n\nDisk:\n50% used");
  });

  it("should include error marker for failed scripts", () => {
    const results: CronScriptResult[] = [
      {
        name: "broken",
        exitCode: 1,
        stdout: "",
        stderr: "command not found",
        durationMs: 10,
        error: "exit code 1",
      },
    ];
    const resolved = resolveScriptTemplates("Output: {{broken}}", results);
    expect(resolved).toContain("[script error: exit code 1]");
  });

  it("should include partial stdout with error marker for partial failures", () => {
    const results: CronScriptResult[] = [
      {
        name: "partial",
        exitCode: 1,
        stdout: "some output\n",
        stderr: "then it failed",
        durationMs: 10,
        error: "exit code 1",
      },
    ];
    const resolved = resolveScriptTemplates("Result: {{partial}}", results);
    expect(resolved).toContain("some output");
    expect(resolved).toContain("[script error: exit code 1]");
  });

  it("should leave unmatched placeholders as-is", () => {
    const results: CronScriptResult[] = [
      { name: "known", exitCode: 0, stdout: "data\n", stderr: "", durationMs: 10 },
    ];
    const resolved = resolveScriptTemplates("{{known}} and {{unknown}}", results);
    expect(resolved).toBe("data and {{unknown}}");
  });

  it("should handle message with no placeholders", () => {
    const results: CronScriptResult[] = [
      { name: "unused", exitCode: 0, stdout: "data\n", stderr: "", durationMs: 10 },
    ];
    const resolved = resolveScriptTemplates("No placeholders here", results);
    expect(resolved).toBe("No placeholders here");
  });

  it("should replace multiple occurrences of the same placeholder", () => {
    const results: CronScriptResult[] = [
      { name: "val", exitCode: 0, stdout: "42\n", stderr: "", durationMs: 10 },
    ];
    const resolved = resolveScriptTemplates("{{val}} is {{val}}", results);
    expect(resolved).toBe("42 is 42");
  });

  it("should handle empty stdout", () => {
    const results: CronScriptResult[] = [
      { name: "empty", exitCode: 0, stdout: "", stderr: "", durationMs: 10 },
    ];
    const resolved = resolveScriptTemplates("Output: [{{empty}}]", results);
    expect(resolved).toBe("Output: []");
  });
});

describe("cronScriptsEnabled config gate", () => {
  it("should reject cron creation with scripts when cronScriptsEnabled is false", async () => {
    // Dynamically import to get the mocked version
    const { config } = await import("../../src/core/config.js");
    // Ensure cronScriptsEnabled is false (the default)
    const cfg = config.get();
    expect(cfg.daemon.cronScriptsEnabled).toBe(false);

    const { Hono } = await import("hono");
    const { cronsRouter } = await import("../../src/daemon/routes/crons.js");

    const app = new Hono();
    app.route("/crons", cronsRouter);

    const res = await app.request("/crons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-job",
        schedule: "* * * * *",
        session: "main",
        message: "Status: {{check}}",
        scripts: [{ name: "check", command: "echo ok" }],
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("disabled");
  });

  it("should allow cron creation with scripts when cronScriptsEnabled is true", async () => {
    const { config } = await import("../../src/core/config.js");
    // Enable cron scripts
    config.setValue("daemon.cronScriptsEnabled", true);

    const { Hono } = await import("hono");
    const { cronsRouter } = await import("../../src/daemon/routes/crons.js");

    const app = new Hono();
    app.route("/crons", cronsRouter);

    const res = await app.request("/crons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-job-enabled",
        schedule: "* * * * *",
        session: "main",
        message: "Status: {{check}}",
        scripts: [{ name: "check", command: "echo ok" }],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);

    // Reset to default
    config.setValue("daemon.cronScriptsEnabled", false);
  });

  it("should allow cron creation without scripts when cronScriptsEnabled is false", async () => {
    const { config } = await import("../../src/core/config.js");
    config.setValue("daemon.cronScriptsEnabled", false);
    expect(config.get().daemon.cronScriptsEnabled).toBe(false);

    const { Hono } = await import("hono");
    const { cronsRouter } = await import("../../src/daemon/routes/crons.js");

    const app = new Hono();
    app.route("/crons", cronsRouter);

    const res = await app.request("/crons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "no-script-job",
        schedule: "0 9 * * *",
        session: "main",
        message: "Good morning",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
  });
});
