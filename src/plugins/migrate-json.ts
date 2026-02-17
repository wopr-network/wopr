/**
 * Migrate plugins.json and plugin-registries.json to SQL.
 *
 * Reads existing JSON files, inserts records into SQL,
 * then renames JSON files to .backup.
 * Idempotent — skips if JSON files don't exist.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { logger } from "../logger.js";
import type { InstalledPlugin, PluginRegistryEntry } from "../types.js";
import { ensurePluginSchema, getPluginRepo, getRegistryRepo } from "./plugin-storage.js";
import { PLUGINS_FILE, REGISTRIES_FILE } from "./state.js";

export async function migratePluginJsonToSql(): Promise<{ plugins: number; registries: number }> {
  await ensurePluginSchema();
  let pluginCount = 0;
  let registryCount = 0;

  // --- Migrate plugins.json ---
  if (existsSync(PLUGINS_FILE)) {
    try {
      const raw = readFileSync(PLUGINS_FILE, "utf-8");
      const plugins: InstalledPlugin[] = JSON.parse(raw);
      const repo = getPluginRepo();

      for (const plugin of plugins) {
        const exists = await repo.findById(plugin.name);
        if (!exists) {
          await repo.insert(plugin as never);
          pluginCount++;
        }
      }

      // Rename to .backup
      renameSync(PLUGINS_FILE, `${PLUGINS_FILE}.backup`);
      logger.info(`[plugins] Migrated ${pluginCount} plugins from plugins.json to SQL`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[plugins] Failed to migrate plugins.json: ${msg}`);
    }
  }

  // --- Migrate plugin-registries.json ---
  if (existsSync(REGISTRIES_FILE)) {
    try {
      const raw = readFileSync(REGISTRIES_FILE, "utf-8");
      const registries: PluginRegistryEntry[] = JSON.parse(raw);
      const repo = getRegistryRepo();

      for (const entry of registries) {
        const exists = await repo.findById(entry.url);
        if (!exists) {
          await repo.insert(entry as never);
          registryCount++;
        }
      }

      // Rename to .backup
      renameSync(REGISTRIES_FILE, `${REGISTRIES_FILE}.backup`);
      logger.info(`[plugins] Migrated ${registryCount} registries from plugin-registries.json to SQL`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[plugins] Failed to migrate plugin-registries.json: ${msg}`);
    }
  }

  return { plugins: pluginCount, registries: registryCount };
}
