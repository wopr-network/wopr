/**
 * Cron job management - pure functions and script execution
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CronJob, CronScript, CronScriptResult } from "../../../src/types.js";

const execAsync = promisify(exec);

export function parseCronSchedule(schedule: string): {
  minute: number[];
  hour: number[];
  day: number[];
  month: number[];
  weekday: number[];
} {
  const parts = schedule.split(" ");
  if (parts.length !== 5) throw new Error("Invalid cron schedule");

  const parse = (part: string, min: number, max: number): number[] => {
    if (part === "*") return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2), 10);
      if (!Number.isFinite(step) || step <= 0) throw new Error(`Invalid step: ${part}`);
      return Array.from({ length: max - min + 1 }, (_, i) => min + i).filter((v) => (v - min) % step === 0);
    }
    if (part.includes(",")) {
      const values = part.split(",").map(Number);
      for (const v of values) {
        if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Value out of range: ${v}`);
      }
      return values;
    }
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || start > end)
        throw new Error(`Invalid range: ${part}`);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    const value = parseInt(part, 10);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Value out of range: ${value}`);
    return [value];
  };

  return {
    minute: parse(parts[0], 0, 59),
    hour: parse(parts[1], 0, 23),
    day: parse(parts[2], 1, 31),
    month: parse(parts[3], 1, 12),
    weekday: parse(parts[4], 0, 6),
  };
}

export function shouldRunCron(schedule: string, date: Date): boolean {
  try {
    const cron = parseCronSchedule(schedule);
    return (
      cron.minute.includes(date.getMinutes()) &&
      cron.hour.includes(date.getHours()) &&
      cron.day.includes(date.getDate()) &&
      cron.month.includes(date.getMonth() + 1) &&
      cron.weekday.includes(date.getDay())
    );
  } catch {
    return false;
  }
}

export function parseTimeSpec(spec: string): number {
  const now = Date.now();
  if (spec === "now") return now;

  if (spec.startsWith("+")) {
    const match = spec.match(/^\+(\d+)([smhd])$/);
    if (match) {
      const val = parseInt(match[1], 10);
      const unit = match[2] as "s" | "m" | "h" | "d";
      const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
      return now + val * mult;
    }
  }

  if (/^\d{10,13}$/.test(spec)) {
    const ts = parseInt(spec, 10);
    return ts < 1e12 ? ts * 1000 : ts;
  }

  if (/^\d{1,2}:\d{2}$/.test(spec)) {
    const [h, m] = spec.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() < now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  const parsed = Date.parse(spec);
  if (!Number.isNaN(parsed)) return parsed;

  throw new Error(`Invalid time spec: ${spec}`);
}

export function createOnceJob(time: string, session: string, message: string): CronJob {
  const runAt = parseTimeSpec(time);
  return {
    name: `once-${Date.now()}`,
    schedule: "once",
    session,
    message,
    once: true,
    runAt,
  };
}

// Script execution functions below (pure logic, no storage)

const DEFAULT_SCRIPT_TIMEOUT = 30000;
const MAX_SCRIPT_OUTPUT = 50000; // 50KB max per script output

/**
 * Execute a single cron script, capturing stdout/stderr.
 */
export async function executeCronScript(script: CronScript): Promise<CronScriptResult> {
  const timeout = script.timeout ?? DEFAULT_SCRIPT_TIMEOUT;
  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(script.command, {
      cwd: script.cwd || undefined,
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
    });
    const durationMs = Date.now() - start;
    return {
      name: script.name,
      exitCode: 0,
      stdout: stdout.length > MAX_SCRIPT_OUTPUT ? `${stdout.substring(0, MAX_SCRIPT_OUTPUT)}\n... (truncated)` : stdout,
      stderr: stderr.length > MAX_SCRIPT_OUTPUT ? `${stderr.substring(0, MAX_SCRIPT_OUTPUT)}\n... (truncated)` : stderr,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const error = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      name: script.name,
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      durationMs,
      error: error.message,
    };
  }
}

/**
 * Execute all scripts for a cron job serially and return results.
 */
export async function executeCronScripts(scripts: CronScript[]): Promise<CronScriptResult[]> {
  const results: CronScriptResult[] = [];
  for (const script of scripts) {
    results.push(await executeCronScript(script));
  }
  return results;
}

/**
 * Replace {{name}} placeholders in a message with corresponding script outputs.
 * If a script failed, includes an error marker in the output.
 */
export function resolveScriptTemplates(message: string, results: CronScriptResult[]): string {
  let resolved = message;
  for (const result of results) {
    const placeholder = `{{${result.name}}}`;
    let replacement: string;
    if (result.error) {
      replacement = result.stdout
        ? `${result.stdout}\n[script error: ${result.error}]`
        : `[script error: ${result.error}]`;
    } else {
      replacement = result.stdout;
    }
    // Remove trailing newline from command output for cleaner templating
    replacement = replacement.replace(/\n$/, "");
    resolved = resolved.split(placeholder).join(replacement);
  }
  return resolved;
}
