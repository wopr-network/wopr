/**
 * Config schema accessors.
 *
 * Schemas are populated from two sources:
 * 1. Manifest configSchema (populated during loadPlugin, before init)
 * 2. Runtime registration via context.registerConfigSchema() (during init)
 *
 * Runtime registrations overwrite manifest-provided schemas for backward compat.
 */

import type { ConfigSchema } from "../types.js";
import { configSchemas } from "./state.js";

export function getConfigSchemas(): Map<string, ConfigSchema> {
  return configSchemas;
}

export function listConfigSchemas(): { pluginId: string; schema: ConfigSchema }[] {
  return Array.from(configSchemas.entries()).map(([pluginId, schema]) => ({
    pluginId,
    schema,
  }));
}

/**
 * Check if a config schema exists for a plugin (from manifest or runtime registration).
 */
export function hasConfigSchema(pluginId: string): boolean {
  return configSchemas.has(pluginId);
}
