/**
 * Readiness Probe - tracks daemon subsystem health and startup state.
 *
 * Used by `/ready` endpoint to signal when the daemon is fully initialized
 * and all subsystems are operational. Returns 503 during startup.
 *
 * Checks:
 *  - Memory SQLite database is accessible
 *  - At least one AI provider is healthy
 *  - Plugin system initialized
 *  - Cron scheduler running
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { providerRegistry } from "../core/providers.js";
import { WOPR_HOME } from "../paths.js";
import { loadedPlugins } from "../plugins/state.js";

export interface SubsystemCheck {
  healthy: boolean;
  message: string;
}

export interface ReadinessResult {
  ready: boolean;
  uptime: number;
  checks: Record<string, SubsystemCheck>;
}

let startupComplete = false;
let cronSchedulerRunning = false;
const startTime = Date.now();

/** Mark startup as complete (called after all init steps finish). */
export function markStartupComplete(): void {
  startupComplete = true;
}

/** Mark the cron scheduler as running (called after setInterval). */
export function markCronRunning(): void {
  cronSchedulerRunning = true;
}

/** Check if the memory SQLite database file exists and is openable. */
function checkMemoryDb(): SubsystemCheck {
  const dbPath = join(WOPR_HOME, "memory", "index.sqlite");
  try {
    if (!existsSync(dbPath)) {
      return { healthy: false, message: "Database file not found" };
    }
    // Attempt to open and run a trivial query
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      db.exec("SELECT 1");
      return { healthy: true, message: "ok" };
    } finally {
      db.close();
    }
  } catch (err) {
    return {
      healthy: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Check that at least one AI provider is available. */
function checkProviders(): SubsystemCheck {
  const providers = providerRegistry.listProviders();
  const available = providers.filter((p) => p.available);
  if (providers.length === 0) {
    return { healthy: false, message: "No providers registered" };
  }
  if (available.length === 0) {
    return {
      healthy: false,
      message: `0/${providers.length} providers available`,
    };
  }
  return {
    healthy: true,
    message: `${available.length}/${providers.length} providers available`,
  };
}

/** Check that the plugin system has finished initializing. */
function checkPlugins(): SubsystemCheck {
  // Plugins loaded count can be zero if none are installed -- that's fine.
  // The key check is that startup has progressed past plugin loading.
  if (!startupComplete) {
    return { healthy: false, message: "Plugin loading still in progress" };
  }
  return {
    healthy: true,
    message: `${loadedPlugins.size} plugin(s) loaded`,
  };
}

/** Check that the cron scheduler interval is running. */
function checkCron(): SubsystemCheck {
  if (!cronSchedulerRunning) {
    return { healthy: false, message: "Cron scheduler not started" };
  }
  return { healthy: true, message: "ok" };
}

/**
 * Run all readiness checks and return a composite result.
 *
 * The daemon is "ready" only when startup is complete AND all subsystem
 * checks pass.
 */
export function checkReadiness(): ReadinessResult {
  const checks: Record<string, SubsystemCheck> = {
    startup: {
      healthy: startupComplete,
      message: startupComplete ? "ok" : "Startup in progress",
    },
    memory: checkMemoryDb(),
    providers: checkProviders(),
    plugins: checkPlugins(),
    cron: checkCron(),
  };

  const ready = Object.values(checks).every((c) => c.healthy);
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  return { ready, uptime, checks };
}

/** Reset state -- used by tests. */
export function _resetForTesting(): void {
  startupComplete = false;
  cronSchedulerRunning = false;
}
