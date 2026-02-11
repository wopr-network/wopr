/**
 * Plugin system barrel export.
 *
 * Re-exports everything from the plugin sub-modules so that
 * `import { ... } from "./plugins/index.js"` works with the
 * same public API as the original monolithic plugins.ts.
 */

// --- State (public accessors only) ---
export { channelAdapters, channelKey, configSchemas, contextProviders, uiComponents, webUiExtensions } from "./state.js";

// --- Extensions ---
export {
  getPluginExtension,
  listPluginExtensions,
  registerPluginExtension,
  unregisterPluginExtension,
} from "./extensions.js";

// --- Installation ---
export {
  disablePlugin,
  enablePlugin,
  getInstalledPlugins,
  installPlugin,
  listPlugins,
  removePlugin,
  uninstallPlugin,
} from "./installation.js";
export type { InstallResult } from "./installation.js";

// --- Loading ---
export { getLoadedPlugin, loadAllPlugins, loadPlugin, shutdownAllPlugins, unloadPlugin } from "./loading.js";
export type { LoadPluginOptions } from "./loading.js";

// --- Registry & Discovery ---
export {
  addRegistry,
  discoverVoicePlugins,
  getPluginRegistries,
  listRegistries,
  removeRegistry,
  searchPlugins,
} from "./registry.js";
export type { DiscoveredPlugin } from "./registry.js";

// --- Config Schemas ---
export { getConfigSchemas, listConfigSchemas } from "./config-schemas.js";

// --- Public accessors for runtime maps ---
export { getChannel, getChannels, getChannelsForSession, getContextProvider } from "./accessors.js";
export { getUiComponents, getWebUiExtensions } from "./accessors.js";
