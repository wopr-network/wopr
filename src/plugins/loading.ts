/**
 * Plugin loading, unloading, and batch lifecycle operations.
 *
 * Handles dynamic ESM import of plugins, requirements checking,
 * and coordinated startup/shutdown of all enabled plugins.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCapabilityDependencyGraph } from "../core/capability-deps.js";
import { getCapabilityHealthProber } from "../core/capability-health.js";
import { getCapabilityRegistry } from "../core/capability-registry.js";
import { config as centralConfig } from "../core/config.js";
import { emitPluginActivated, emitPluginDeactivated, emitPluginDrained, emitPluginDraining } from "../core/events.js";
import { logger, shouldLogStack } from "../logger.js";
import type { InstallMethod, PluginManifest, PluginRequirements } from "../plugin-types/manifest.js";
import {
  checkNodeRequirement,
  checkOsRequirement,
  checkRequirements,
  ensureRequirements,
  formatMissingRequirements,
} from "../plugins/requirements.js";
import type { InstalledPlugin, PluginInjectOptions, WOPRPlugin, WOPRPluginContext } from "../types.js";
import { resolveA2AToolDependencies } from "./a2a-tool-resolver.js";
import { pluginCircuitBreaker } from "./circuit-breaker.js";
import { createPluginContext } from "./context-factory.js";
import { enablePlugin, getInstalledPlugins, installPlugin } from "./installation.js";
import { configSchemas, loadedPlugins, pluginManifests, pluginStates, resolvedA2ATools } from "./state.js";

/**
 * Validate plugin config against its declared configSchema.
 * Throws if any required field is missing or empty.
 */
function validatePluginConfig(pluginName: string, schema: import("../types.js").ConfigSchema): void {
  const requiredFields = schema.fields.filter((f) => f.required);
  if (requiredFields.length === 0) return;

  const cfg = centralConfig.get();
  const pluginConfig = (cfg.plugins?.data?.[pluginName] ?? {}) as Record<string, unknown>;

  const missing: string[] = [];
  for (const field of requiredFields) {
    const value = pluginConfig[field.name];
    if (value === undefined || value === null || value === "") {
      missing.push(field.name);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Plugin ${pluginName} config validation failed: missing required fields: ${missing.join(", ")}. ` +
        `Declare these in your config before loading the plugin.`,
    );
  }
}

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
  /** @internal Tracks plugins currently being resolved to detect circular dependencies */
  _resolving?: Set<string>;
}

async function initAndActivatePlugin(
  installed: InstalledPlugin,
  plugin: WOPRPlugin,
  context: WOPRPluginContext,
  manifest: PluginManifest | undefined,
): Promise<void> {
  if (plugin.init) {
    try {
      await plugin.init(context);
      pluginCircuitBreaker.recordSuccess(installed.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[plugins] ${installed.name}: init() failed, cleaning up: ${msg}`);
      pluginCircuitBreaker.recordError(installed.name, err instanceof Error ? err : new Error(msg));

      // Attempt plugin-side cleanup via shutdown()
      if (plugin.shutdown) {
        try {
          await plugin.shutdown();
        } catch (shutdownErr: unknown) {
          logger.warn(
            `[plugins] ${installed.name}: shutdown() during init cleanup also failed: ${shutdownErr instanceof Error ? shutdownErr.message : String(shutdownErr)}`,
          );
        }
      }

      // Unregister capability providers registered from manifest (Step 2.6)
      if (manifest?.provides?.capabilities?.length) {
        const registry = getCapabilityRegistry();
        for (const entry of manifest.provides.capabilities) {
          try {
            registry.unregisterProvider(entry.type, entry.id);
          } catch (unregErr: unknown) {
            logger.warn(
              `[plugins] ${installed.name}: failed to unregister capability ${entry.type}:${entry.id} during cleanup: ${unregErr instanceof Error ? unregErr.message : String(unregErr)}`,
            );
          }
        }
      }

      // Remove from all state maps
      loadedPlugins.delete(installed.name);
      pluginManifests.delete(installed.name);
      configSchemas.delete(installed.name);
      pluginStates.delete(installed.name);

      throw new Error(`Plugin ${installed.name} init() failed: ${msg}`);
    }
  }

  pluginStates.set(installed.name, "active");
  if (plugin.onActivate) {
    try {
      await plugin.onActivate(context);
      pluginCircuitBreaker.recordSuccess(installed.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[plugins] ${installed.name}: onActivate() threw: ${msg}`);
      pluginCircuitBreaker.recordError(installed.name, err instanceof Error ? err : new Error(msg));
      // onActivate failure is non-fatal — plugin loaded but activation handler failed
    }
  }
  await emitPluginActivated(installed.name, plugin.version || installed.version);
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

  // ── Step 1.5: Resolve manifest dependencies ──
  if (manifest?.dependencies?.length) {
    logger.info(
      `[plugins] Resolving ${manifest.dependencies.length} dependencies for ${installed.name}: ${manifest.dependencies.join(", ")}`,
    );
    const resolving = options._resolving ?? new Set<string>();
    resolving.add(installed.name);
    await resolveDependencies(manifest.dependencies, injectors, { ...options, _resolving: resolving });
  }

  // ── Step 2: Validate requirements (manifest takes priority over legacy) ──
  if (!options.skipRequirementsCheck) {
    // Prefer manifest requirements, fall back to legacy pkg.wopr.plugin.requires
    const manifestRequires: PluginRequirements | undefined = manifest?.requires;
    const legacyMeta = (pkg.wopr as { plugin?: { requires?: PluginRequirements; install?: InstallMethod[] } })?.plugin;
    const legacyRequires: PluginRequirements | undefined = legacyMeta?.requires;
    const requires = manifestRequires ?? legacyRequires;

    const manifestInstall: InstallMethod[] | undefined = manifest?.install;
    const legacyInstall: InstallMethod[] | undefined = legacyMeta?.install;
    const installMethods = manifestInstall ?? legacyInstall;

    if (requires) {
      // Check OS constraint before anything else
      if (requires.os && !checkOsRequirement(requires.os)) {
        const allowed = requires.os.join(", ");
        throw new Error(
          `Plugin ${installed.name} does not support this platform (${process.platform}). Supported: ${allowed}`,
        );
      }

      // Check Node.js version constraint
      if (requires.node && !checkNodeRequirement(requires.node)) {
        throw new Error(
          `Plugin ${installed.name} requires Node.js ${requires.node} (running ${process.versions.node})`,
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

  // ── Step 2.6: Auto-register provided capabilities ──
  if (manifest?.provides?.capabilities?.length) {
    const registry = getCapabilityRegistry();
    for (const entry of manifest.provides.capabilities) {
      registry.registerProvider(entry.type, {
        id: entry.id,
        name: entry.displayName,
        configSchema: entry.configSchema,
      });
    }
    logger.info(
      `[plugins] ${installed.name}: registered ${manifest.provides.capabilities.length} capability provider(s): ${manifest.provides.capabilities.map((e) => `${e.type}:${e.id}`).join(", ")}`,
    );
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

  // ── Step 3.5: Validate config against schema (before init) ──
  if (!options.skipInit) {
    const schema = configSchemas.get(installed.name);
    if (schema) {
      validatePluginConfig(installed.name, schema);
    }
  }

  // ── Steps 4-5: Initialize and activate (skip for CLI commands) ──
  if (!options.skipInit) {
    await initAndActivatePlugin(installed, plugin, context, manifest);
  }

  return plugin;
}

/**
 * Read a plugin manifest from package.json "wopr" field or wopr-plugin.json.
 * Returns undefined if no manifest is found (backward compat).
 */
export function readPluginManifest(pluginPath: string, pkg?: Record<string, unknown>): PluginManifest | undefined {
  // 1. Check package.json "wopr" field (top-level manifest)
  const wopr = pkg?.wopr as Record<string, unknown> | undefined;
  if (wopr?.name && wopr.capabilities) {
    return wopr as unknown as PluginManifest;
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
 * Normalize a dependency name to the short form used as InstalledPlugin.name.
 * Strips @wopr-network/plugin-, @wopr-network/, and wopr-plugin- prefixes.
 */
export function normalizeDependencyName(dep: string): string {
  return dep
    .replace(/^@wopr-network\/plugin-/, "")
    .replace(/^@wopr-network\//, "")
    .replace(/^wopr-plugin-/, "");
}

/**
 * Resolve and auto-install manifest.dependencies before a plugin initializes.
 *
 * For each dependency:
 * 1. If already loaded, skip.
 * 2. If in the resolving set, throw (circular dependency).
 * 3. If not installed, call installPlugin() then enablePlugin().
 * 4. If installed but disabled, call enablePlugin().
 * 5. Load the dependency via loadPlugin() (which recurses for transitive deps).
 */
export async function resolveDependencies(
  dependencies: string[] | undefined,
  injectors: {
    inject: (session: string, message: string, options?: PluginInjectOptions) => Promise<string>;
    getSessions: () => string[];
  },
  options: LoadPluginOptions,
): Promise<void> {
  if (!dependencies || dependencies.length === 0) return;

  const resolving = options._resolving ?? new Set<string>();

  let installed = await getInstalledPlugins();

  for (const dep of dependencies) {
    const shortName = normalizeDependencyName(dep);

    // Already loaded — nothing to do
    if (loadedPlugins.has(shortName)) {
      logger.info(`[plugins] Dependency ${shortName} already loaded`);
      continue;
    }

    // Circular dependency detection
    if (resolving.has(shortName)) {
      throw new Error(
        `Circular dependency detected: ${shortName} is already being resolved. ` +
          `Chain: ${[...resolving].join(" -> ")} -> ${shortName}`,
      );
    }

    const found = installed.find((p) => p.name === shortName);

    if (!found) {
      // Not installed — install it
      logger.info(`[plugins] Installing missing dependency: ${dep}`);
      let newPlugin: InstalledPlugin;
      try {
        newPlugin = await installPlugin(dep);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to install dependency ${shortName} (${dep}): ${msg}`);
      }

      // Enable it (state is persisted by enablePlugin — no local mutation needed)
      await enablePlugin(newPlugin.name);

      // Refresh the installed list so subsequent deps see the new plugin
      installed = await getInstalledPlugins();

      // Load it (recursive — will resolve its own deps)
      logger.info(`[plugins] Loading dependency: ${newPlugin.name}`);
      resolving.add(shortName);
      await loadPlugin(newPlugin, injectors, { ...options, _resolving: resolving });
      resolving.delete(shortName);
    } else if (!found.enabled) {
      // Installed but disabled — enable and load (state is persisted by enablePlugin)
      logger.info(`[plugins] Enabling disabled dependency: ${shortName}`);
      await enablePlugin(shortName);

      resolving.add(shortName);
      await loadPlugin(found, injectors, { ...options, _resolving: resolving });
      resolving.delete(shortName);
    } else {
      // Installed and enabled but not yet loaded — load it
      logger.info(`[plugins] Loading dependency: ${shortName}`);
      resolving.add(shortName);
      await loadPlugin(found, injectors, { ...options, _resolving: resolving });
      resolving.delete(shortName);
    }
  }
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

export interface UnloadPluginOptions {
  /** Drain timeout in ms. Default: read from manifest lifecycle.shutdownTimeoutMs, or 30_000 */
  drainTimeoutMs?: number;
  /** Skip drain entirely (force unload). Default: false */
  force?: boolean;
}

async function drainPlugin(name: string, plugin: WOPRPlugin, drainTimeoutMs: number): Promise<void> {
  pluginStates.set(name, "draining");
  await emitPluginDraining(name, drainTimeoutMs);

  const drainStart = Date.now();
  let timedOut = false;

  if (plugin.onDrain) {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        plugin.onDrain().then(() => {
          // Success: clear timeout to prevent mutation
          if (timeoutId) clearTimeout(timeoutId);
        }),
        new Promise<void>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(new Error(`Drain timeout after ${drainTimeoutMs}ms`));
          }, drainTimeoutMs);
        }),
      ]);
    } catch (err) {
      logger.warn(`[plugins] ${name}: drain ${timedOut ? "timed out" : "failed"}: ${err}`);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  const durationMs = Date.now() - drainStart;
  await emitPluginDrained(name, durationMs, timedOut);
}

async function deactivateAndShutdownPlugin(name: string, plugin: WOPRPlugin, drainTimeoutMs: number): Promise<void> {
  pluginStates.set(name, "deactivating");

  if (plugin.onDeactivate) {
    try {
      await Promise.race([
        plugin.onDeactivate(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`onDeactivate timeout after ${drainTimeoutMs}ms`)), drainTimeoutMs),
        ),
      ]);
    } catch (err) {
      logger.error(`[plugins] ${name}: onDeactivate failed: ${err}`);
    }
  }

  if (plugin.shutdown) {
    try {
      await Promise.race([
        plugin.shutdown(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`shutdown timeout after ${drainTimeoutMs}ms`)), drainTimeoutMs),
        ),
      ]);
    } catch (err) {
      logger.error(`[plugins] ${name}: shutdown failed: ${err}`);
    }
  }
}

export async function unloadPlugin(name: string, options: UnloadPluginOptions = {}): Promise<void> {
  const loaded = loadedPlugins.get(name);
  if (!loaded) return;

  const manifest = pluginManifests.get(name);
  const drainBehavior = manifest?.lifecycle?.shutdownBehavior ?? "graceful";
  const defaultTimeout = manifest?.lifecycle?.shutdownTimeoutMs ?? 30_000;
  const drainTimeoutMs = options.drainTimeoutMs ?? defaultTimeout;
  const force = options.force ?? false;

  // ── Step 1: Drain (if plugin supports it and not force) ──
  if (!force && (drainBehavior === "drain" || loaded.plugin.onDrain)) {
    await drainPlugin(name, loaded.plugin, drainTimeoutMs);
  }

  // ── Steps 2-3: Deactivate and shutdown ──
  await deactivateAndShutdownPlugin(name, loaded.plugin, drainTimeoutMs);

  // ── Step 4: Cleanup registrations (existing behavior) ──
  if (manifest?.provides?.capabilities?.length) {
    const registry = getCapabilityRegistry();
    for (const entry of manifest.provides.capabilities) {
      registry.unregisterProvider(entry.type, entry.id);
    }
    logger.info(`[plugins] ${name}: deregistered ${manifest.provides.capabilities.length} capability provider(s)`);
  }

  // Deregister health probes for provided capabilities
  // Note: Check if prober has a running check before unregistering to avoid race conditions
  if (manifest?.provides?.capabilities?.length) {
    const prober = getCapabilityHealthProber();
    // Stop the prober temporarily to ensure no probes are running
    const wasRunning = prober.isRunning();
    if (wasRunning) {
      prober.stop();
    }
    for (const entry of manifest.provides.capabilities) {
      prober.unregisterProbe(entry.type, entry.id);
    }
    // Restart if it was running before
    if (wasRunning) {
      prober.start();
    }
  }

  // Unregister from capability dependency graph
  getCapabilityDependencyGraph().unregisterPlugin(name);

  // ── Step 5: Emit deactivated, clean up state ──
  const version = loaded.plugin.version || manifest?.version || "unknown";
  const wasDrained = !force && (drainBehavior === "drain" || !!loaded.plugin.onDrain);
  await emitPluginDeactivated(name, version, wasDrained);

  pluginStates.set(name, "inactive");
  loadedPlugins.delete(name);
  pluginManifests.delete(name);
  configSchemas.delete(name);
  pluginStates.delete(name);
  resolvedA2ATools.delete(name);
  pluginCircuitBreaker.clear(name);
}

export function getLoadedPlugin(name: string): { plugin: WOPRPlugin; context: WOPRPluginContext } | undefined {
  return loadedPlugins.get(name);
}

/** Get the runtime state of a plugin */
export function getPluginState(name: string): import("./state.js").PluginRuntimeState | undefined {
  return pluginStates.get(name);
}

/** Check if a plugin is currently draining */
export function isPluginDraining(name: string): boolean {
  return pluginStates.get(name) === "draining";
}

export interface ProviderSwitchOptions {
  fromPlugin: string;
  toPlugin: string;
  drainTimeoutMs?: number;
}

/**
 * Switch a capability provider by hot-unloading the old plugin and hot-loading the new one.
 * This is a convenience wrapper around unloadPlugin + loadPlugin.
 */
export async function switchProvider(
  options: ProviderSwitchOptions,
  injectors: {
    inject: (session: string, message: string, opts?: PluginInjectOptions) => Promise<string>;
    getSessions: () => string[];
  },
): Promise<void> {
  const { fromPlugin, toPlugin, drainTimeoutMs } = options;

  // Store reference to old plugin for rollback
  const oldPluginRef = loadedPlugins.get(fromPlugin);

  // 1. Drain and unload old plugin
  await unloadPlugin(fromPlugin, { drainTimeoutMs });

  // 2. Find and load new plugin
  const installed = await getInstalledPlugins();
  const target = installed.find((p) => p.name === toPlugin);
  if (!target) {
    throw new Error(`Plugin ${toPlugin} is not installed`);
  }

  try {
    await loadPlugin(target, injectors);
  } catch (err) {
    // Rollback: reload the old plugin if new plugin fails
    logger.error(`[plugins] Failed to load ${toPlugin}, rolling back to ${fromPlugin}: ${err}`);
    if (oldPluginRef) {
      const oldInstalled = installed.find((p) => p.name === fromPlugin);
      if (oldInstalled) {
        try {
          await loadPlugin(oldInstalled, injectors);
          logger.info(`[plugins] Rollback successful: ${fromPlugin} reloaded`);
        } catch (rollbackErr) {
          logger.error(`[plugins] Rollback failed for ${fromPlugin}: ${rollbackErr}`);
        }
      }
    }
    throw err;
  }
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

  const installed = await getInstalledPlugins();
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
      if (error.stack && shouldLogStack()) {
        logger.error(`[plugins]     Stack:`, error.stack.substring(0, 200));
      }
      failed.push({ name: plugin.name, error: error.message });
    }
  }

  // ── Post-load: resolve A2A tool dependencies ──
  // Full reload may change the set of installed plugins; clear to avoid stale entries
  resolvedA2ATools.clear();
  const a2aResult = resolveA2AToolDependencies();
  for (const [pluginName, toolMap] of a2aResult.toolMap) {
    resolvedA2ATools.set(pluginName, toolMap);
  }
  if (a2aResult.resolved.length > 0) {
    logger.info(
      `[plugins] A2A tool dependencies: ${a2aResult.resolved.length} resolved, ${a2aResult.missing.length} missing`,
    );
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
