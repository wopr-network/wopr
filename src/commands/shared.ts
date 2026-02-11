/**
 * Shared utilities for CLI commands.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { WoprClient } from "../client.js";
import { logger } from "../logger.js";
import { PID_FILE, SESSIONS_DIR, SKILLS_DIR, WOPR_HOME } from "../paths.js";

// Ensure directories exist
[WOPR_HOME, SESSIONS_DIR, SKILLS_DIR].forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

export const client = new WoprClient();

/** Check daemon is running, exit if not */
export async function requireDaemon(): Promise<void> {
  if (!(await client.isRunning())) {
    logger.error("Daemon not running. Start it: wopr daemon start");
    process.exit(1);
  }
}

/** Get PID of the running daemon, or null */
export function getDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    unlinkSync(PID_FILE);
    return null;
  }
}

/** Parse flags and positional args from argv slice */
export function parseFlags(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }

  return { flags, positional };
}
