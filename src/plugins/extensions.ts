/**
 * Plugin extension registry.
 *
 * Plugins can expose APIs to other plugins through named extensions.
 */

import { logger } from "../logger.js";
import { pluginExtensions } from "./state.js";

/**
 * Register a plugin extension that other plugins can access
 * @param pluginName - Name of the plugin registering the extension
 * @param extensionName - Name of the extension (e.g., "p2p", "discord")
 * @param extension - The extension object with methods/properties
 */
export function registerPluginExtension(pluginName: string, extensionName: string, extension: unknown): void {
  const key = `${pluginName}.${extensionName}`;
  pluginExtensions.set(key, extension);
  logger.info(`[plugins] Extension registered: ${key}`);
}

/**
 * Unregister a plugin extension
 */
export function unregisterPluginExtension(pluginName: string, extensionName: string): void {
  const key = `${pluginName}.${extensionName}`;
  pluginExtensions.delete(key);
  logger.info(`[plugins] Extension unregistered: ${key}`);
}

/**
 * Get a plugin extension by name
 * @param extensionName - Full name (plugin.extension) or just extension name
 */
export function getPluginExtension<T = unknown>(extensionName: string): T | undefined {
  // Try exact match first
  if (pluginExtensions.has(extensionName)) {
    return pluginExtensions.get(extensionName) as T;
  }
  // Try to find by extension name suffix
  for (const [key, ext] of pluginExtensions) {
    if (key.endsWith(`.${extensionName}`)) {
      return ext as T;
    }
  }
  return undefined;
}

/**
 * List all registered extensions
 */
export function listPluginExtensions(): string[] {
  return Array.from(pluginExtensions.keys());
}
