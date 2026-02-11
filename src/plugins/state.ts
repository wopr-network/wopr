/**
 * Shared mutable state for the plugin system.
 *
 * All plugin modules that need access to runtime registries import from here.
 * This keeps the state in one place and avoids circular dependency issues.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginManifest } from "../plugin-types/manifest.js";
import type { ModelProvider } from "../types/provider.js";
import type {
  ChannelAdapter,
  ConfigSchema,
  ContextProvider,
  UiComponentExtension,
  WebUiExtension,
  WOPRPlugin,
  WOPRPluginContext,
} from "../types.js";

export const WOPR_HOME = process.env.WOPR_HOME || join(homedir(), "wopr");
export const PLUGINS_DIR = join(WOPR_HOME, "plugins");
export const PLUGINS_FILE = join(WOPR_HOME, "plugins.json");
export const REGISTRIES_FILE = join(WOPR_HOME, "plugin-registries.json");

/** Loaded plugins (runtime) */
export const loadedPlugins: Map<string, { plugin: WOPRPlugin; context: WOPRPluginContext }> = new Map();

/** Context providers - session -> provider mapping */
export const contextProviders: Map<string, ContextProvider> = new Map();
export const channelAdapters: Map<string, ChannelAdapter> = new Map();
export const webUiExtensions: Map<string, WebUiExtension> = new Map();
export const uiComponents: Map<string, UiComponentExtension> = new Map();

/** Provider plugins registry (for providers registered via plugins) */
export const providerPlugins: Map<string, ModelProvider> = new Map();

/** Config schemas registry (pluginId -> schema) */
export const configSchemas: Map<string, ConfigSchema> = new Map();

/** Plugin manifests registry (pluginName -> manifest) */
export const pluginManifests: Map<string, PluginManifest> = new Map();

/**
 * Plugin extensions registry - plugins can expose APIs to other plugins.
 * Key format: "pluginName.extensionName" -> extension object
 */
export const pluginExtensions: Map<string, unknown> = new Map();

export function channelKey(channel: { type: string; id: string }): string {
  return `${channel.type}:${channel.id}`;
}
