/**
 * Plugin loading, unloading, and batch lifecycle operations.
 *
 * Handles dynamic ESM import of plugins, requirements checking,
 * and coordinated startup/shutdown of all enabled plugins.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCapabilityDependencyGraph } from "../core/capability-deps.js";
import { getCapabilityRegistry } from "../core/capability-registry.js";
import { logger } from "../logger.js";
import type {
  InstallMethod as ManifestInstallMethod,
  PluginManifest,
  PluginRequirements,
} from "../plugin-types/manifest.js";
import {
  checkNodeRequirement,
  checkOsRequirement,
  checkRequirements,
  ensureRequirements,
  formatMissingRequirements,
} from "../plugins/requirements.js";
import type { InstalledPlugin, PluginInjectOptions, WOPRPlugin, WOPRPluginContext } from "../types.js";
import type { InstallMethod, VoicePluginRequirements } from "../voice/types.js";
import { createPluginContext } from "./context-factory.js";
import { getInstalledPlugins } from "./installation.js";
import { configSchemas, loadedPlugins, pluginManifests } from "./state.js";

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
  let pkg: Record<string, unknown> = {};

  if (existsSync(join(installed.path, "package.json"))) {
    pkg = JSON.parse(readFileSync(join(installed.path, "package.json"), "utf-8")) as Record<string, unknown>;
    entryPoint = join(installed.path, (pkg.main as string) || "index.js");
  } else if (existsSync(join(installed.path, "index.js"))) {
    entryPoint = join(installed.path, "index.js");
  } else if (existsSync(join(installed.path, "index.ts"))) {
    entryPoint = join(installed.path, "index.ts");
  }

  // ── Step 1: Read manifest BEFORE init ──
  // Check package.json "wopr" field first, then fall back to wopr-plugin.json
  const manifest = readPluginManifest(installed.path, pkg);

  if (manifest) {
    logger.info(`[plugins] Read manifest for ${installed.name} (v${manifest.version})`);
    pluginManifests.set(installed.name, manifest);

    // Populate config schema from manifest (before init).
    // The manifest ConfigSchema is a superset of the legacy ConfigSchema in types.ts
    // (extra field types like "boolean", "array", "object"). Structurally compatible.
    if (manifest.configSchema) {
      configSchemas.set(installed.name, manifest.configSchema as unknown as import("../types.js").ConfigSchema);
    }
  }

  // ── Step 2: Validate requirements (manifest takes priority over legacy) ──
  if (!options.skipRequirementsCheck) {
    // Prefer manifest requirements, fall back to legacy pkg.wopr.plugin.requires
    const manifestRequires: PluginRequirements | undefined = manifest?.requires;
    const legacyMeta = (pkg.wopr as { plugin?: { requires?: VoicePluginRequirements; install?: InstallMethod[] } })
      ?.plugin;
    const legacyRequires: VoicePluginRequirements | undefined = legacyMeta?.requires;
    const requires = manifestRequires ?? legacyRequires;

    const manifestInstall: ManifestInstallMethod[] | undefined = manifest?.install;
    const legacyInstall: InstallMethod[] | undefined = legacyMeta?.install;
    const installMethods = manifestInstall ?? legacyInstall;

    if (requires) {
      // Check OS constraint before anything else (manifest-only field)
      if ("os" in requires && !checkOsRequirement((requires as PluginRequirements).os)) {
        const allowed = (requires as PluginRequirements).os?.join(", ") ?? "unknown";
        throw new Error(
          `Plugin ${installed.name} does not support this platform (${process.platform}). Supported: ${allowed}`,
        );
      }

      // Check Node.js version constraint (manifest-only field)
      if ("node" in requires && !checkNodeRequirement((requires as PluginRequirements).node)) {
        throw new Error(
          `Plugin ${installed.name} requires Node.js ${(requires as PluginRequirements).node} (running ${process.versions.node})`,
        );
      }

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

    // ── Step 2.5: Check capability requirements ──
    if (manifest?.requires?.capabilities?.length) {
      const registry = getCapabilityRegistry();
      const { satisfied, missing, optional } = registry.checkRequirements(manifest.requires.capabilities);

      // Register in dependency graph regardless
      getCapabilityDependencyGraph().registerPlugin(installed.name, manifest.requires.capabilities);

      if (!satisfied) {
        throw new Error(
          `Plugin ${installed.name} requires capabilities not yet available: ${missing.join(", ")}. ` +
            `Install a provider for each missing capability first.`,
        );
      }

      if (optional.length > 0) {
        logger.info(`[plugins] ${installed.name}: optional capabilities not available: ${optional.join(", ")}`);
      }
    }
  }

  // ── Step 3: Dynamic import ──
  // Temporarily change cwd to plugin directory for proper module resolution
  const originalCwd = process.cwd();
  process.chdir(installed.path);

  let module: { default?: WOPRPlugin } & Record<string, unknown>;
  try {
    // Dynamic import with cache-busting query param for reloads
    // ESM caches by URL, so adding timestamp forces fresh import
    const cacheBuster = `?t=${Date.now()}`;
    module = (await import(entryPoint + cacheBuster)) as { default?: WOPRPlugin } & Record<string, unknown>;
  } finally {
    process.chdir(originalCwd);
  }
  const plugin: WOPRPlugin = (module.default || module) as WOPRPlugin;

  // Create context
  const context = createPluginContext(installed, injectors);

  // Store
  loadedPlugins.set(installed.name, { plugin, context });

  // ── Step 4: Initialize (skip for CLI commands) ──
  if (plugin.init && !options.skipInit) {
    await plugin.init(context);
  }

  return plugin;
}

/**
 * Read a plugin manifest from package.json "wopr" field or wopr-plugin.json.
 * Returns undefined if no manifest is found (backward compat).
 */
// biome-ignore lint/suspicious/noExplicitAny: package.json shape is untyped
export function readPluginManifest(pluginPath: string, pkg?: any): PluginManifest | undefined {
  // 1. Check package.json "wopr" field (top-level manifest)
  if (pkg?.wopr?.name && pkg.wopr.capabilities) {
    return pkg.wopr as PluginManifest;
  }

  // 2. Check standalone wopr-plugin.json
  const manifestPath = join(pluginPath, "wopr-plugin.json");
  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
      if (raw.name && raw.capabilities) {
        return raw as PluginManifest;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[plugins] Failed to parse ${manifestPath}: ${msg}`);
    }
  }

  return undefined;
}

/**
 * Get the manifest for a plugin by name (if available).
 * This allows the platform/webui to query manifest data without loading the plugin.
 */
export function getPluginManifest(name: string): PluginManifest | undefined {
  return pluginManifests.get(name);
}

/**
 * Get all loaded plugin manifests.
 */
export function getAllPluginManifests(): Map<string, PluginManifest> {
  return pluginManifests;
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

  // Unregister from capability dependency graph
  getCapabilityDependencyGraph().unregisterPlugin(name);

  loadedPlugins.delete(name);
  pluginManifests.delete(name);
  configSchemas.delete(name);
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
    } catch (err: unknown) {
      const error = err as Error;
      logger.error(`[plugins]   Failed to load ${plugin.name}:`, error.message);
      if (error.stack) {
        logger.error(`[plugins]     Stack:`, error.stack.substring(0, 200));
      }
      failed.push({ name: plugin.name, error: error.message });
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
