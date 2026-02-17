import { existsSync, readFileSync, renameSync } from "node:fs";
import { logger } from "../logger.js";
import { REGISTRIES_FILE } from "../paths.js";
import type { Registry } from "../types.js";
import { addRegistrySQL } from "./registries-repository.js";

export async function migrateRegistriesToSql(): Promise<void> {
  if (!existsSync(REGISTRIES_FILE)) {
    logger.info("[registries-migrate] No registries.json found - clean SQL start");
    return;
  }
  try {
    const registries: Registry[] = JSON.parse(readFileSync(REGISTRIES_FILE, "utf-8"));
    for (const reg of registries) {
      await addRegistrySQL(reg.name, reg.url);
    }
    renameSync(REGISTRIES_FILE, `${REGISTRIES_FILE}.backup`);
    logger.info(`[registries-migrate] Migrated ${registries.length} registries from ${REGISTRIES_FILE}`);
  } catch (err) {
    logger.error(`[registries-migrate] Failed to migrate: ${err}`);
    throw err;
  }
}
