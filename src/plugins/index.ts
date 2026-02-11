/**
 * Plugin system barrel export.
 *
 * Re-exports everything from the plugin sub-modules so that
 * `import { ... } from "./plugins/index.js"` works with the
 * same public API as the original monolithic plugins.ts.
 */

// --- Public accessors for runtime maps ---
export {
  getChannel,
  getChannels,
  getChannelsForSession,
  getContextProvider,
  getUiComponents,
  getWebUiExtensions,
} from "./accessors.js";

// --- Config Schemas ---
export { getConfigSchemas, hasConfigSchema, listConfigSchemas } from "./config-schemas.js";

// --- Extensions ---
export {
  getPluginExtension,
  listPluginExtensions,
  registerPluginExtension,
  unregisterPluginExtension,
} from "./extensions.js";

export type { InstallResult } from "./installation.js";
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

export type { LoadPluginOptions } from "./loading.js";
// --- Loading ---
export {
  getAllPluginManifests,
  getLoadedPlugin,
  getPluginManifest,
  loadAllPlugins,
  loadPlugin,
  readPluginManifest,
  shutdownAllPlugins,
  unloadPlugin,
} from "./loading.js";

export type { DiscoveredPlugin } from "./registry.js";
// --- Registry & Discovery ---
export {
  addRegistry,
  discoverVoicePlugins,
  getPluginRegistries,
  listRegistries,
  removeRegistry,
  searchPlugins,
} from "./registry.js";

// --- State (public accessors only) ---
export {
  channelAdapters,
  channelKey,
  configSchemas,
  contextProviders,
  pluginManifests,
  uiComponents,
  webUiExtensions,
} from "./state.js";
