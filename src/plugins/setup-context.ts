/**
 * Setup context injection — registers a temporary ContextProvider
 * during plugin setup that injects the plugin's setup instructions
 * into the active session's system prompt.
 */

import type { ContextProvider, MessageInfo } from "../core/context.js";
import { registerContextProvider, unregisterContextProvider } from "../core/context.js";
import { logger } from "../logger.js";
import { configSchemas, setupContextProviders } from "./state.js";

/** Generate a deterministic context provider name for a setup session */
function setupProviderName(pluginId: string, sessionId: string): string {
  return `setup:${pluginId}:${sessionId}`;
}

/**
 * Begin setup context injection for a plugin in a session.
 * Registers a temporary ContextProvider that calls the plugin's
 * SetupContextProvider and injects the result as a system prompt fragment.
 *
 * No-op if the plugin has no registered SetupContextProvider.
 */
export function beginSetupContext(pluginId: string, sessionId: string, partialConfig: Record<string, unknown>): void {
  const provider = setupContextProviders.get(pluginId);
  if (!provider) {
    logger.debug(`[setup-context] No setup context provider for ${pluginId}, skipping`);
    return;
  }

  const schema = configSchemas.get(pluginId) ?? { title: "", fields: [] };
  const name = setupProviderName(pluginId, sessionId);

  const contextProvider: ContextProvider = {
    name,
    priority: 1,
    enabled: (session: string) => session === sessionId,
    async getContext(_session: string, _message: MessageInfo) {
      const fragment = provider({ pluginId, configSchema: schema, partialConfig });
      if (!fragment) return null;

      return {
        content: fragment,
        role: "system" as const,
        metadata: {
          source: `setup:${pluginId}`,
          priority: 1,
        },
      };
    },
  };

  registerContextProvider(contextProvider);
  logger.info(`[setup-context] Injected setup context for ${pluginId} in session ${sessionId}`);
}

/**
 * End setup context injection — removes the temporary ContextProvider.
 * Safe to call even if no provider was registered (no-op).
 */
export function endSetupContext(pluginId: string, sessionId: string): void {
  const name = setupProviderName(pluginId, sessionId);
  unregisterContextProvider(name);
  logger.info(`[setup-context] Removed setup context for ${pluginId} in session ${sessionId}`);
}
