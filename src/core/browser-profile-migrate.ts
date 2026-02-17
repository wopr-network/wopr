/**
 * Migrate browser profiles from JSON files to SQL
 *
 * One-time migration: read JSON files from browser-profiles/ directory,
 * insert into SQL, and rename to .backup
 */

import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import { WOPR_HOME } from "../paths.js";
import { loadProfile, saveProfile } from "./browser-profile-repository.js";

const PROFILES_DIR = join(WOPR_HOME, "browser-profiles");
const MIGRATION_MARKER = join(WOPR_HOME, ".browser-profiles-migrated");

interface LegacyBrowserProfile {
  name: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
  localStorage: Record<string, Record<string, string>>;
  updatedAt: number;
}

/**
 * Migrate all browser profile JSON files to SQL
 */
export async function migrateBrowserProfilesToSql(): Promise<void> {
  // Check if migration already ran
  if (existsSync(MIGRATION_MARKER)) {
    return;
  }

  // Check if profiles directory exists
  if (!existsSync(PROFILES_DIR)) {
    // No profiles to migrate
    logger.info("[browser-profile-migrate] No browser-profiles directory, skipping migration");
    // Create marker to avoid checking again
    try {
      const fs = await import("node:fs/promises");
      await fs.writeFile(MIGRATION_MARKER, String(Date.now()));
    } catch {
      // Best effort
    }
    return;
  }

  logger.info("[browser-profile-migrate] Starting migration from JSON to SQL");

  const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    logger.info("[browser-profile-migrate] No JSON files to migrate");
    try {
      const fs = await import("node:fs/promises");
      await fs.writeFile(MIGRATION_MARKER, String(Date.now()));
    } catch {
      // Best effort
    }
    return;
  }

  let migratedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const filePath = join(PROFILES_DIR, file);
    try {
      // Read JSON file
      const content = readFileSync(filePath, "utf-8");
      const legacy = JSON.parse(content) as LegacyBrowserProfile;

      // Check if profile already exists in SQL
      const existing = await loadProfile(legacy.name);
      if (existing && existing.cookies.length > 0) {
        // Profile already in SQL, skip
        logger.info(`[browser-profile-migrate] Profile "${legacy.name}" already in SQL, skipping`);
      } else {
        // Save to SQL
        await saveProfile({
          name: legacy.name,
          cookies: legacy.cookies,
          localStorage: legacy.localStorage,
          updatedAt: legacy.updatedAt,
        });
        logger.info(`[browser-profile-migrate] Migrated profile "${legacy.name}"`);
      }

      // Rename JSON file to .backup
      const backupPath = `${filePath}.backup`;
      renameSync(filePath, backupPath);
      migratedCount++;
    } catch (err) {
      logger.error(`[browser-profile-migrate] Failed to migrate ${file}: ${err}`);
      errorCount++;
    }
  }

  logger.info(`[browser-profile-migrate] Migration complete: ${migratedCount} migrated, ${errorCount} errors`);

  // Create marker file
  try {
    const fs = await import("node:fs/promises");
    await fs.writeFile(MIGRATION_MARKER, String(Date.now()));
  } catch {
    // Best effort
  }
}
