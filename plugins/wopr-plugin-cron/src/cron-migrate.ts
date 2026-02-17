/**
 * Cron migration - migrate from JSON files to SQL
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import { logger } from "../../../src/logger.js";
import { CRON_HISTORY_FILE, CRONS_FILE } from "../../../src/paths.js";
import type { CronHistoryEntry, CronJob } from "../../../src/types.js";
import { addCron, addCronRun } from "./cron-repository.js";

/**
 * Migrate cron data from JSON files to SQL
 * Renames JSON files to .backup after successful migration
 */
export async function migrateCronsToSql(): Promise<void> {
  let jobsMigrated = 0;
  let runsMigrated = 0;

  // Migrate cron jobs
  if (existsSync(CRONS_FILE)) {
    try {
      const jobs: CronJob[] = JSON.parse(readFileSync(CRONS_FILE, "utf-8"));
      for (const job of jobs) {
        await addCron(job);
        jobsMigrated++;
      }
      // Rename to backup
      renameSync(CRONS_FILE, `${CRONS_FILE}.backup`);
      logger.info(`[cron-migrate] Migrated ${jobsMigrated} jobs from ${CRONS_FILE}`);
    } catch (err) {
      logger.error(`[cron-migrate] Failed to migrate jobs: ${err}`);
      throw err;
    }
  }

  // Migrate cron history
  if (existsSync(CRON_HISTORY_FILE)) {
    try {
      const history: CronHistoryEntry[] = JSON.parse(readFileSync(CRON_HISTORY_FILE, "utf-8"));
      for (const entry of history) {
        // Map old CronHistoryEntry to new CronRunRow format
        await addCronRun({
          cronName: entry.name,
          session: entry.session,
          startedAt: entry.timestamp,
          status: entry.success ? "success" : "failure",
          durationMs: entry.durationMs,
          error: entry.error,
          message: entry.message,
          scriptResults: entry.scriptResults,
        });
        runsMigrated++;
      }
      // Rename to backup
      renameSync(CRON_HISTORY_FILE, `${CRON_HISTORY_FILE}.backup`);
      logger.info(`[cron-migrate] Migrated ${runsMigrated} history entries from ${CRON_HISTORY_FILE}`);
    } catch (err) {
      logger.error(`[cron-migrate] Failed to migrate history: ${err}`);
      throw err;
    }
  }

  if (jobsMigrated === 0 && runsMigrated === 0) {
    logger.info("[cron-migrate] No JSON files found - clean SQL start");
  }
}
