/**
 * Sandbox migration - migrate container registry from JSON to SQL
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import { logger } from "../logger.js";
import { SANDBOX_REGISTRY_PATH } from "./constants.js";
import { updateRegistrySQL } from "./sandbox-repository.js";

/**
 * Migrate sandbox registry from JSON file to SQL
 * Renames JSON file to .backup after successful migration
 */
export async function migrateSandboxRegistryToSql(): Promise<void> {
  if (!existsSync(SANDBOX_REGISTRY_PATH)) {
    logger.info("[sandbox-migrate] No sandbox-registry.json found - clean SQL start");
    return;
  }

  try {
    const raw = readFileSync(SANDBOX_REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const entries = parsed?.entries ?? [];

    for (const entry of entries) {
      await updateRegistrySQL(entry);
    }

    // Rename to backup
    renameSync(SANDBOX_REGISTRY_PATH, `${SANDBOX_REGISTRY_PATH}.backup`);
    logger.info(`[sandbox-migrate] Migrated ${entries.length} entries from sandbox registry`);
  } catch (err) {
    logger.error(`[sandbox-migrate] Failed to migrate: ${err}`);
    throw err;
  }
}
