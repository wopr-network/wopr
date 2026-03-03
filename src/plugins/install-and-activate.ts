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
 */
const installLocks = new Map<string, Promise<InstallAndActivateResult>>();

/** Maximum time to wait for a plugin install before giving up. */
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Install a plugin from `source`, enable it, hot-load it, and run a provider
 * health check. This is the canonical install sequence — both the plugins route
 * and the instance-plugins route must use this function to ensure consistent DB
 * state and provider availability.
 *
 * Concurrent requests for the same source are serialized via an in-memory lock
 * to prevent TOCTOU races on filesystem checks (WOP-1440). A 5-minute timeout
 * prevents a hung install from holding the lock indefinitely.
 */
export function installAndActivatePlugin(source: string): Promise<InstallAndActivateResult> {
  const existing = installLocks.get(source);
  if (existing) return existing;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Plugin install timed out after ${INSTALL_TIMEOUT_MS}ms`)), INSTALL_TIMEOUT_MS),
  );
  const promise = Promise.race([doInstallAndActivate(source), timeoutPromise]).finally(() => {
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
