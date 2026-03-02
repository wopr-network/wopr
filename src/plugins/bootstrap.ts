/**
 * Bootstrap plugins from WOPR_PLUGINS_* environment variables.
 *
 * Called during daemon startup to auto-install plugins declared
 * by the platform's compose-gen in container environment variables.
 */

import { logger } from "../logger.js";
import { enablePlugin, installPlugin, listPlugins } from "./installation.js";

const ENV_VAR_NAMES = [
  "WOPR_PLUGINS_CHANNELS",
  "WOPR_PLUGINS_PROVIDERS",
  "WOPR_PLUGINS_VOICE",
  "WOPR_PLUGINS_OTHER",
] as const;

/**
 * Parse all WOPR_PLUGINS_* env vars and return a deduplicated list of plugin short names.
 */
export function parsePluginEnvVars(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const varName of ENV_VAR_NAMES) {
    const value = process.env[varName];
    if (!value) continue;

    for (const raw of value.split(",")) {
      const name = raw.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
  }

  return result;
}

export interface BootstrapResult {
  installed: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Read WOPR_PLUGINS_* env vars and install/enable any plugins not already present.
 *
 * This runs BEFORE loadAllPlugins() — it only installs and enables.
 * The actual loading happens in the subsequent loadAllPlugins() call.
 */
export async function bootstrapEnvPlugins(): Promise<BootstrapResult> {
  const names = parsePluginEnvVars();
  if (names.length === 0) return { installed: [], skipped: [], failed: [] };

  logger.info(`[plugins] Bootstrapping ${names.length} plugin(s) from env vars: ${names.join(", ")}`);

  const existing = await listPlugins();
  const existingNames = new Set(existing.map((p) => p.name));

  const result: BootstrapResult = { installed: [], skipped: [], failed: [] };

  for (const name of names) {
    if (existingNames.has(name)) {
      // Already installed — ensure enabled
      const plugin = existing.find((p) => p.name === name);
      if (plugin && !plugin.enabled) {
        try {
          await enablePlugin(name);
          logger.info(`[plugins] Env bootstrap: enabled existing plugin ${name}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[plugins] Env bootstrap: failed to enable ${name}: ${msg}`);
          result.failed.push({ name, error: msg });
          continue;
        }
      }
      result.skipped.push(name);
      logger.info(`[plugins] Env bootstrap: ${name} already installed, skipping`);
      continue;
    }

    try {
      await installPlugin(name);
      await enablePlugin(name);
      result.installed.push(name);
      logger.info(`[plugins] Env bootstrap: installed and enabled ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[plugins] Env bootstrap: failed to install ${name}: ${msg}`);
      result.failed.push({ name, error: msg });
    }
  }

  if (result.installed.length > 0) {
    logger.info(
      `[plugins] Env bootstrap: installed ${result.installed.length} new plugin(s): ${result.installed.join(", ")}`,
    );
  }
  if (result.failed.length > 0) {
    logger.warn(
      `[plugins] Env bootstrap: ${result.failed.length} plugin(s) failed: ${result.failed.map((f) => f.name).join(", ")}`,
    );
  }

  return result;
}
