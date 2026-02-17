/**
 * Plugin storage schema and repository accessors.
 *
 * Replaces plugins.json and plugin-registries.json with SQL tables
 * via the Storage API.
 */
import { z } from "zod";
import type { PluginSchema, Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import type { InstalledPlugin, PluginRegistryEntry } from "../types.js";

// Zod schemas matching the existing TypeScript interfaces exactly
export const installedPluginSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  source: z.enum(["npm", "github", "local", "bundled"]),
  path: z.string(),
  enabled: z.boolean(),
  installedAt: z.number().int(),
});

export const pluginRegistryEntrySchema = z.object({
  url: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  lastSync: z.number().int(),
});

export const pluginsSchema: PluginSchema = {
  namespace: "plugins",
  version: 1,
  tables: {
    installed: {
      schema: installedPluginSchema,
      primaryKey: "name",
      indexes: [{ fields: ["enabled"] }, { fields: ["source"] }],
    },
    registries: {
      schema: pluginRegistryEntrySchema,
      primaryKey: "url",
      indexes: [{ fields: ["name"] }, { fields: ["enabled"] }],
    },
  },
};

let registered = false;

/**
 * Ensure the plugins schema is registered with storage.
 * Idempotent — safe to call multiple times.
 */
export async function ensurePluginSchema(): Promise<void> {
  if (registered) return;
  const storage = getStorage();
  await storage.register(pluginsSchema);
  registered = true;
}

/**
 * Reset the registration flag (for testing).
 */
export function resetPluginSchemaState(): void {
  registered = false;
}

/**
 * Get the installed plugins repository.
 * Caller MUST await ensurePluginSchema() first.
 */
export function getPluginRepo(): Repository<InstalledPlugin & Record<string, unknown>, "name", string> {
  return getStorage().getRepository<InstalledPlugin & Record<string, unknown>>("plugins", "installed");
}

/**
 * Get the plugin registries repository.
 * Caller MUST await ensurePluginSchema() first.
 */
export function getRegistryRepo(): Repository<PluginRegistryEntry & Record<string, unknown>, "url", string> {
  return getStorage().getRepository<PluginRegistryEntry & Record<string, unknown>>("plugins", "registries");
}
