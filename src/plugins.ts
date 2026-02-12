/**
 * Plugin system - thin re-export barrel.
 *
 * All implementation has been extracted into focused modules under src/plugins/.
 * This file preserves the original public API so existing imports keep working.
 */

// Public accessors for runtime state
export {
  getChannel,
  getChannels,
  getChannelsForSession,
  getContextProvider,
  getUiComponents,
  getWebUiExtensions,
} from "./plugins/accessors.js";
// Config schemas
export { getConfigSchemas, listConfigSchemas } from "./plugins/config-schemas.js";
// Extensions
export {
  getPluginExtension,
  listPluginExtensions,
  registerPluginExtension,
  unregisterPluginExtension,
} from "./plugins/extensions.js";
export type { InstallResult } from "./plugins/installation.js";
// Installation
export {
  disablePlugin,
  enablePlugin,
  getInstalledPlugins,
  installPlugin,
  listPlugins,
  removePlugin,
  uninstallPlugin,
} from "./plugins/installation.js";
export type { LoadPluginOptions } from "./plugins/loading.js";
// Loading
export {
  getAllPluginManifests,
  getLoadedPlugin,
  loadAllPlugins,
  loadPlugin,
  shutdownAllPlugins,
  unloadPlugin,
} from "./plugins/loading.js";
export type { DiscoveredPlugin } from "./plugins/registry.js";
// Registry & discovery
export {
  addRegistry,
  discoverVoicePlugins,
  getPluginRegistries,
  listRegistries,
  removeRegistry,
  searchPlugins,
} from "./plugins/registry.js";
