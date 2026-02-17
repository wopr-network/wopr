/**
 * Core plugin interface and command types.
 *
 * WOPRPlugin is the interface every WOPR plugin must implement.
 * PluginCommand defines CLI commands that plugins can register.
 */

import type { WOPRPluginContext } from "./context.js";
import type { PluginManifest } from "./manifest.js";

/**
 * A CLI command registered by a plugin.
 */
export interface PluginCommand {
  name: string;
  description: string;
  usage?: string;
  handler: (ctx: WOPRPluginContext, args: string[]) => Promise<void>;
}

/**
 * The core plugin interface.
 *
 * Every WOPR plugin must satisfy this interface. The `manifest` field
 * is optional for backward compatibility but recommended for WaaS.
 */
export interface WOPRPlugin {
  name: string;
  version: string;
  description?: string;

  /** Plugin manifest with full metadata (optional, for WaaS support) */
  manifest?: PluginManifest;

  /** Runtime hooks (daemon) */
  init?(ctx: WOPRPluginContext): Promise<void>;
  shutdown?(): Promise<void>;

  /** Hot-load lifecycle hooks */
  /** Called when the plugin is activated at runtime (after init, or on hot-enable). */
  onActivate?(ctx: WOPRPluginContext): Promise<void>;
  /** Called when the plugin is about to be deactivated. Return a Promise that resolves when ready to unload. */
  onDeactivate?(): Promise<void>;
  /** Called when the plugin enters drain mode. Plugin should stop accepting new work and complete in-flight work. Return a Promise that resolves when drained. */
  onDrain?(): Promise<void>;

  /** CLI extensions */
  commands?: PluginCommand[];
}

/**
 * Record of an installed plugin (on disk).
 */
export interface InstalledPlugin {
  name: string;
  version: string;
  description?: string;
  source: "npm" | "github" | "local";
  path: string;
  enabled: boolean;
  installedAt: number;
}

/**
 * A plugin registry entry for remote discovery.
 */
export interface PluginRegistryEntry {
  name: string;
  url: string;
  enabled: boolean;
  lastSync: number;
}
