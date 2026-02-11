/**
 * Plugin loading, unloading, and batch lifecycle operations.
 *
 * Handles dynamic ESM import of plugins, requirements checking,
 * and coordinated startup/shutdown of all enabled plugins.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import { checkRequirements, ensureRequirements, formatMissingRequirements } from "../plugins/requirements.js";
import type { InstalledPlugin, PluginInjectOptions, WOPRPlugin, WOPRPluginContext } from "../types.js";
import type { InstallMethod, VoicePluginRequirements } from "../voice/types.js";
import { createPluginContext } from "./context-factory.js";
import { getInstalledPlugins } from "./installation.js";
import { loadedPlugins } from "./state.js";

/** Options for loading plugins */
export interface LoadPluginOptions {
  /** Automatically install missing dependencies */
  autoInstall?: boolean;
  /** Skip requirements check entirely */
  skipRequirementsCheck?: boolean;
  /** Prompt function for interactive install */
  promptInstall?: (message: string) => Promise<boolean>;
  /** Skip plugin init (for CLI commands that just need the plugin module) */
  skipInit?: boolean;
}

export async function loadPlugin(
  installed: InstalledPlugin,
  injectors: {
    inject: (session: string, message: string, options?: PluginInjectOptions) => Promise<string>;
    getSessions: () => string[];
  },
  options: LoadPluginOptions = {},
): Promise<WOPRPlugin> {
  // Find the entry point and read package.json
  let entryPoint = installed.path;
  let pkg: any = {};

  if (existsSync(join(installed.path, "package.json"))) {
    pkg = JSON.parse(readFileSync(join(installed.path, "package.json"), "utf-8"));
    entryPoint = join(installed.path, pkg.main || "index.js");
  } else if (existsSync(join(installed.path, "index.js"))) {
    entryPoint = join(installed.path, "index.js");
  } else if (existsSync(join(installed.path, "index.ts"))) {
    entryPoint = join(installed.path, "index.ts");
  }

  // Check requirements from package.json wopr.plugin metadata
  if (!options.skipRequirementsCheck) {
    const pluginMeta = pkg.wopr?.plugin;
    const requires: VoicePluginRequirements | undefined = pluginMeta?.requires;
    const installMethods: InstallMethod[] | undefined = pluginMeta?.install;

    if (requires) {
      logger.info(`[plugins] Checking requirements for ${installed.name}...`);

      const {
        satisfied,
        installed: installedDeps,
        errors,
      } = await ensureRequirements(requires, installMethods, {
        auto: options.autoInstall,
        prompt: options.promptInstall,
      });

      if (!satisfied) {
        const check = await checkRequirements(requires);
        const missing = formatMissingRequirements(check);
        const errorDetail = errors.length > 0 ? `\nInstall errors:\n${errors.map((e) => `  - ${e}`).join("\n")}` : "";
        throw new Error(`Plugin ${installed.name} requirements not satisfied:\n${missing}${errorDetail}`);
      }

      if (installedDeps.length > 0) {
        logger.info(`[plugins] Installed ${installedDeps.length} dependencies for ${installed.name}`);
      }
    }
  }

  // Temporarily change cwd to plugin directory for proper module resolution
  const originalCwd = process.cwd();
  process.chdir(installed.path);

  let module: any;
  try {
    // Dynamic import with cache-busting query param for reloads
    // ESM caches by URL, so adding timestamp forces fresh import
    const cacheBuster = `?t=${Date.now()}`;
    module = await import(entryPoint + cacheBuster);
  } finally {
    process.chdir(originalCwd);
  }
  const plugin: WOPRPlugin = module.default || module;

  // Create context
  const context = createPluginContext(installed, injectors);

  // Store
  loadedPlugins.set(installed.name, { plugin, context });

  // Initialize if needed (skip for CLI commands)
  if (plugin.init && !options.skipInit) {
    await plugin.init(context);
  }

  return plugin;
}

export async function unloadPlugin(name: string): Promise<void> {
  const loaded = loadedPlugins.get(name);
  if (!loaded) return;

  // Shutdown if needed
  if (loaded.plugin.shutdown) {
    await loaded.plugin.shutdown();
  }

  // Clean up registrations
  if (loaded.plugin.commands) {
    // Commands are registered per-plugin, no global registry to clean
  }

  loadedPlugins.delete(name);
}

export function getLoadedPlugin(name: string): { plugin: WOPRPlugin; context: WOPRPluginContext } | undefined {
  return loadedPlugins.get(name);
}

export async function loadAllPlugins(
  injectors: {
    inject: (session: string, message: string, options?: PluginInjectOptions) => Promise<string>;
    getSessions: () => string[];
  },
  options: LoadPluginOptions = {},
): Promise<void> {
  logger.info(`[plugins] loadAllPlugins starting...`);
  logger.info(`[plugins] WOPR_HOME: ${process.env.WOPR_HOME || "not set"}`);
  if (options.autoInstall) {
    logger.info(`[plugins] Auto-install enabled`);
  }

  const installed = getInstalledPlugins();
  logger.info(`[plugins] Found ${installed.length} installed plugins`);

  for (const p of installed) {
    logger.info(`[plugins]  - ${p.name}: enabled=${p.enabled}, path=${p.path}`);
  }

  let loadedCount = 0;
  const failed: { name: string; error: string }[] = [];

  for (const plugin of installed) {
    logger.info(`[plugins] Processing ${plugin.name}...`);
    if (!plugin.enabled) {
      logger.info(`[plugins]   Skipping ${plugin.name} (disabled)`);
      continue;
    }

    logger.info(`[plugins]   Loading ${plugin.name} from ${plugin.path}...`);
    try {
      await loadPlugin(plugin, injectors, options);
      loadedCount++;
      logger.info(`[plugins]   Loaded: ${plugin.name}`);
    } catch (err: any) {
      logger.error(`[plugins]   Failed to load ${plugin.name}:`, err.message);
      if (err.stack) {
        logger.error(`[plugins]     Stack:`, err.stack.substring(0, 200));
      }
      failed.push({ name: plugin.name, error: err.message });
    }
  }

  logger.info(`[plugins] loadAllPlugins complete. Loaded ${loadedCount}/${installed.length} plugins`);

  if (failed.length > 0) {
    logger.warn(`[plugins] ${failed.length} plugins failed to load:`);
    for (const f of failed) {
      logger.warn(`[plugins]   - ${f.name}: ${f.error.split("\n")[0]}`);
    }
  }
}

export async function shutdownAllPlugins(): Promise<void> {
  for (const [name] of loadedPlugins) {
    try {
      await unloadPlugin(name);
      logger.info(`[plugins] Unloaded: ${name}`);
    } catch (err) {
      logger.error(`[plugins] Failed to unload ${name}:`, err);
    }
  }
}
