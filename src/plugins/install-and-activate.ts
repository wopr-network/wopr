/**
 * Shared plugin install-and-activate sequence (WOP-1487)
 *
 * Both the /api/plugins and /api/instances/:id/plugins routes must perform
 * the same sequence after a plugin is installed: enable it, hot-load it, and
 * run a provider health check so newly registered providers become available
 * immediately.
 *
 * Before this module existed the two routes had diverged: plugins.ts ran the
 * health check while instance-plugins.ts did not, causing inconsistent state.
 */

import { providerRegistry } from "../core/providers.js";
import { getSessions, inject } from "../core/sessions.js";
import { enablePlugin, installPlugin, loadPlugin } from "../plugins.js";
import type { InstalledPlugin, PluginInjectOptions } from "../types.js";

/** Minimal injector interface required by loadPlugin. */
export interface PluginInjectors {
  inject(session: string, message: string, options?: PluginInjectOptions): Promise<string>;
  getSessions(): string[];
}

export interface InstallAndActivateResult {
  plugin: InstalledPlugin;
}

/**
 * Create the session-based injector object required by loadPlugin.
 * Extracted here so both call sites can share it without duplication.
 */
export async function createInjectors(): Promise<PluginInjectors> {
  const sessions = await getSessions();
  return {
    inject: async (session: string, message: string, options?: PluginInjectOptions): Promise<string> => {
      const result = await inject(session, message, { silent: true, ...options });
      return result.response;
    },
    getSessions: () => Object.keys(sessions),
  };
}

/**
 * In-memory lock map to serialize concurrent install requests for the same
 * plugin source. Prevents TOCTOU races where two requests both pass
 * existsSync checks and race to install (WOP-1440).
 *
 * Note: this is a single-process lock. In multi-instance deployments, races
 * across pods are possible; a distributed lock (e.g. DB row) would be needed
 * for full cross-instance safety.
 */
const installLocks = new Map<string, Promise<InstallAndActivateResult>>();

/** 10-minute ceiling; prevents a hung npm install from holding the lock forever. */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Install a plugin from `source`, enable it, hot-load it, and run a provider
 * health check. This is the canonical install sequence — both the plugins route
 * and the instance-plugins route must use this function to ensure consistent DB
 * state and provider availability.
 *
 * Concurrent requests for the same source are serialized via an in-memory lock
 * to prevent TOCTOU races on filesystem checks (WOP-1440). A timeout ensures
 * a hung install never holds the lock permanently.
 */
export function installAndActivatePlugin(source: string): Promise<InstallAndActivateResult> {
  const existing = installLocks.get(source);
  if (existing) return existing;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Plugin install from '${source}' timed out after ${INSTALL_TIMEOUT_MS / 1000}s`)),
      INSTALL_TIMEOUT_MS,
    );
  });

  const promise = Promise.race<InstallAndActivateResult>([doInstallAndActivate(source), timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
    installLocks.delete(source);
  });
  installLocks.set(source, promise);
  return promise;
}

async function doInstallAndActivate(source: string): Promise<InstallAndActivateResult> {
  const plugin = await installPlugin(source);
  await enablePlugin(plugin.name);

  const injectors = await createInjectors();
  await loadPlugin(plugin, injectors);

  await providerRegistry.checkHealth();

  return { plugin };
}
