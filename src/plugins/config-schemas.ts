/**
 * Config schema accessors.
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
