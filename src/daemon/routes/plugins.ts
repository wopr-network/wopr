/**
 * Plugins API routes
 *
 * Provides full plugin management: listing, installation, removal,
 * enable/disable, config, health, and npm registry search.
 */

import { type Context, Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { config as centralConfig } from "../../core/config.js";
import { providerRegistry } from "../../core/providers.js";
import { getSessions, inject } from "../../core/sessions.js";
import { logger } from "../../logger.js";
import {
  addRegistry,
  disablePlugin,
  enablePlugin,
  getAllPluginManifests,
  getConfigSchemas,
  getLoadedPlugin,
  getPluginExtension,
  getUiComponents,
  getWebUiExtensions,
  installPlugin,
  listPlugins,
  listRegistries,
  loadPlugin,
  readPluginManifest,
  removePlugin,
  removeRegistry,
  searchPlugins,
  unloadPlugin,
} from "../../plugins.js";
import type { ConfigSchema, PluginInjectOptions } from "../../types.js";

// ============================================================================
// Error classes
// ============================================================================

/** Typed error for plugin route handlers with an associated HTTP status code. */
export class PluginRouteError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "PluginRouteError";
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Valid plugin name pattern: must start with a letter, `@`, or digit;
 * the rest may contain word chars, dots, slashes, and hyphens.
 * Rejects path traversal (`..`), leading dashes, and shell metacharacters.
 */
const PLUGIN_NAME_RE = /^[@a-z0-9][\w./-]*$/i;

/** Characters that are dangerous in shell contexts. */
const SHELL_META_RE = /[;|&$`\\!><()"'\n\r]/;

function validatePluginName(name: string): void {
  if (!name || !PLUGIN_NAME_RE.test(name) || name.includes("..") || SHELL_META_RE.test(name)) {
    throw new PluginRouteError(
      `Invalid plugin name "${name}": must match ${PLUGIN_NAME_RE}, without ".." or shell metacharacters`,
      400,
    );
  }
}

// ============================================================================
// Rate limiting — stricter limits for mutating plugin operations
// ============================================================================

const rateLimitKey = (c: Context) => c.req.header("authorization") ?? c.req.header("x-forwarded-for") ?? "anonymous";

/** 10 requests/minute for install/uninstall (heavy operations). */
const installRateLimit = rateLimiter({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-6",
  keyGenerator: rateLimitKey,
  handler: (c) => c.json({ error: "Too many install/uninstall requests, please try again later" }, 429),
});

/** 30 requests/minute for enable/disable/config updates. */
const mutateRateLimit = rateLimiter({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-6",
  keyGenerator: rateLimitKey,
  handler: (c) => c.json({ error: "Too many requests, please try again later" }, 429),
});

export const pluginsRouter = new Hono();

// ============================================================================
// Type Definitions
// ============================================================================

interface PluginEntry {
  name: string;
  version: string;
  description?: string;
  source: string;
  path: string;
  enabled: boolean;
  installedAt: number;
}

interface PluginConfigData {
  plugins?: {
    data?: Record<string, unknown>;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

// Create injectors for hot-loading plugins (same as daemon/index.ts)
function createInjectors() {
  return {
    inject: async (session: string, message: string, options?: PluginInjectOptions): Promise<string> => {
      const result = await inject(session, message, { silent: true, ...options });
      return result.response;
    },
    getSessions: () => Object.keys(getSessions()),
  };
}

// List installed plugins (with manifest metadata)
pluginsRouter.get("/", (c) => {
  const plugins = listPlugins();
  const runtimeManifests = getAllPluginManifests();

  return c.json({
    plugins: plugins.map((p: PluginEntry) => {
      // Prefer runtime manifest (loaded plugins), fall back to reading from disk
      const manifest = runtimeManifests.get(p.name) || readPluginManifest(p.path);
      return {
        name: p.name,
        version: p.version,
        description: p.description || null,
        source: p.source,
        enabled: p.enabled,
        installedAt: p.installedAt,
        loaded: getLoadedPlugin(p.name) !== undefined,
        manifest: manifest
          ? {
              capabilities: manifest.capabilities,
              category: manifest.category || null,
              tags: manifest.tags || [],
              icon: manifest.icon || null,
              author: manifest.author || null,
              license: manifest.license || null,
              homepage: manifest.homepage || null,
              configSchema: manifest.configSchema || null,
            }
          : null,
      };
    }),
  });
});

// Search npm registry for available wopr-plugin-* packages
pluginsRouter.get("/available", async (c) => {
  const query = c.req.query("q") || "";
  const limit = Math.min(Number(c.req.query("limit")) || 25, 100);
  const results = await searchPlugins(query);
  return c.json({ results: results.slice(0, limit) });
});

// List plugin-provided Web UI extensions
pluginsRouter.get("/ui", (c) => {
  const extensions = getWebUiExtensions();
  return c.json({ extensions });
});

// List plugin-provided UI components
pluginsRouter.get("/components", (c) => {
  const components = getUiComponents();
  return c.json({ components });
});

// Install plugin (POST / — legacy, POST /install — new)
async function handleInstall(c: Context) {
  const body = await c.req.json();
  const source = body.source || body.package;

  if (!source) {
    return c.json({ error: "source (or package) is required" }, 400);
  }

  try {
    validatePluginName(source);
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    throw err;
  }

  try {
    const plugin = await installPlugin(source);
    // Auto-enable plugin after installation
    enablePlugin(plugin.name);

    // Hot-load the plugin immediately (no restart required)
    const injectors = createInjectors();
    await loadPlugin(plugin, injectors);

    // Run health check for any newly registered providers
    await providerRegistry.checkHealth();

    return c.json(
      {
        installed: true,
        plugin: {
          name: plugin.name,
          version: plugin.version,
          description: plugin.description,
          source: plugin.source,
          enabled: true,
          loaded: true,
        },
      },
      201,
    );
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[plugins] Install failed", error: message });
    return c.json({ error: "Plugin installation failed" }, 400);
  }
}

pluginsRouter.post("/", installRateLimit, handleInstall);
pluginsRouter.post("/install", installRateLimit, handleInstall);

// Uninstall plugin (POST /uninstall — new endpoint)
pluginsRouter.post("/uninstall", installRateLimit, async (c) => {
  const body = await c.req.json();
  const { name } = body;

  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }

  try {
    validatePluginName(name);
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    throw err;
  }

  try {
    await unloadPlugin(name);
    await removePlugin(name);
    return c.json({ removed: true, unloaded: true });
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[plugins] Uninstall failed", plugin: name, error: message });
    return c.json({ error: "Plugin uninstall failed" }, 400);
  }
});

// Remove plugin (hot-unloads first) — legacy DELETE endpoint
pluginsRouter.delete("/:name", installRateLimit, async (c) => {
  const name = c.req.param("name");

  try {
    validatePluginName(name);
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    throw err;
  }

  try {
    // Hot-unload the plugin first
    await unloadPlugin(name);

    await removePlugin(name);
    return c.json({ removed: true, unloaded: true });
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[plugins] Remove failed", plugin: name, error: message });
    return c.json({ error: "Plugin removal failed" }, 400);
  }
});

// Enable plugin (hot-loads if not already loaded)
pluginsRouter.post("/:name/enable", mutateRateLimit, async (c) => {
  const name = c.req.param("name");

  try {
    validatePluginName(name);
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    throw err;
  }

  try {
    const plugins = listPlugins();
    const plugin = plugins.find((p: PluginEntry) => p.name === name);
    if (!plugin) {
      return c.json({ error: "Plugin not found" }, 404);
    }

    enablePlugin(name);

    // Hot-load the plugin
    const injectors = createInjectors();
    await loadPlugin(plugin, injectors);

    // Run health check for any newly registered providers
    await providerRegistry.checkHealth();

    return c.json({ enabled: true, loaded: true });
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[plugins] Enable failed", plugin: name, error: message });
    return c.json({ error: "Plugin enable failed" }, 400);
  }
});

// Disable plugin (hot-unloads)
pluginsRouter.post("/:name/disable", mutateRateLimit, async (c) => {
  const name = c.req.param("name");

  try {
    validatePluginName(name);
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    throw err;
  }

  try {
    // Hot-unload the plugin first
    await unloadPlugin(name);

    disablePlugin(name);
    return c.json({ disabled: true, unloaded: true });
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[plugins] Disable failed", plugin: name, error: message });
    return c.json({ error: "Plugin disable failed" }, 400);
  }
});

// Reload plugin (hot-unload then hot-load - picks up code changes without restart)
pluginsRouter.post("/:name/reload", mutateRateLimit, async (c) => {
  const name = c.req.param("name");

  try {
    validatePluginName(name);
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    throw err;
  }

  try {
    const plugins = listPlugins();
    const plugin = plugins.find((p: PluginEntry) => p.name === name);
    if (!plugin) {
      return c.json({ error: "Plugin not found" }, 404);
    }

    if (!plugin.enabled) {
      return c.json({ error: "Plugin is not enabled" }, 400);
    }

    // Hot-unload first
    await unloadPlugin(name);

    // Hot-load with fresh code
    const injectors = createInjectors();
    await loadPlugin(plugin, injectors);

    // Run health check for any newly registered providers
    await providerRegistry.checkHealth();

    return c.json({ reloaded: true, plugin: name });
  } catch (err) {
    if (err instanceof PluginRouteError) {
      return c.json({ error: err.message }, err.statusCode as 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[plugins] Reload failed", plugin: name, error: message });
    return c.json({ error: "Plugin reload failed" }, 400);
  }
});

// Get plugin config
pluginsRouter.get("/:name/config", async (c) => {
  const name = c.req.param("name");

  const plugins = listPlugins();
  const plugin = plugins.find((p: { name: string }) => p.name === name);
  if (!plugin) {
    return c.json({ error: "Plugin not found" }, 404);
  }

  await centralConfig.load();
  const cfg = centralConfig.get();
  const pluginConfig = (cfg as unknown as PluginConfigData).plugins?.data?.[name] || {};

  const schemas = getConfigSchemas();
  let schema = schemas.get(name) || null;

  // Fall back to reading configSchema from manifest on disk if not in runtime state
  if (!schema) {
    const manifest = readPluginManifest(plugin.path);
    if (manifest?.configSchema) {
      schema = manifest.configSchema as ConfigSchema;
    }
  }

  return c.json({ name, config: pluginConfig, configSchema: schema });
});

// Update plugin config
pluginsRouter.put("/:name/config", mutateRateLimit, async (c) => {
  const name = c.req.param("name");

  const plugins = listPlugins();
  const plugin = plugins.find((p: { name: string }) => p.name === name);
  if (!plugin) {
    return c.json({ error: "Plugin not found" }, 404);
  }

  const body = await c.req.json();
  const { config: newConfig } = body;

  if (newConfig === undefined) {
    return c.json({ error: "config is required in request body" }, 400);
  }

  if (typeof newConfig !== "object" || newConfig === null || Array.isArray(newConfig)) {
    return c.json({ error: "config must be a JSON object" }, 400);
  }

  // Validate against configSchema if available (runtime or disk)
  const schemas = getConfigSchemas();
  let schema = schemas.get(name);
  if (!schema) {
    const manifest = readPluginManifest(plugin.path);
    if (manifest?.configSchema) {
      schema = manifest.configSchema as ConfigSchema;
    }
  }
  if (schema) {
    const errors = validateConfigAgainstSchema(newConfig, schema);
    if (errors.length > 0) {
      return c.json({ error: "Config validation failed", details: errors }, 400);
    }
  }

  // Save to central config
  await centralConfig.load();
  const cfg = centralConfig.get() as unknown as PluginConfigData;
  if (!cfg.plugins) cfg.plugins = {};
  if (!cfg.plugins.data) cfg.plugins.data = {};
  cfg.plugins.data[name] = newConfig;
  centralConfig.setValue("plugins.data", cfg.plugins.data);
  await centralConfig.save();

  return c.json({ name, config: newConfig, updated: true });
});

// Plugin health/status
pluginsRouter.get("/:name/health", (c) => {
  const name = c.req.param("name");

  const plugins = listPlugins();
  const plugin = plugins.find((p: { name: string }) => p.name === name);
  if (!plugin) {
    return c.json({ error: "Plugin not found" }, 404);
  }

  const loaded = getLoadedPlugin(name);
  const runtimeManifests = getAllPluginManifests();
  // Prefer runtime manifest, fall back to reading from disk
  const manifest = runtimeManifests.get(name) || readPluginManifest(plugin.path);

  return c.json({
    name,
    installed: true,
    enabled: plugin.enabled,
    loaded: loaded !== undefined,
    version: plugin.version,
    source: plugin.source,
    manifest: manifest
      ? {
          capabilities: manifest.capabilities,
          category: manifest.category || null,
          lifecycle: manifest.lifecycle || null,
        }
      : null,
  });
});

// Search npm for plugins
pluginsRouter.get("/search", async (c) => {
  const query = c.req.query("q");

  if (!query) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  const results = await searchPlugins(query);
  return c.json({ results });
});

// Plugin registries
pluginsRouter.get("/registries", (c) => {
  const registries = listRegistries();
  return c.json({ registries });
});

pluginsRouter.post("/registries", async (c) => {
  const body = await c.req.json();
  const { name, url } = body;

  if (!name || !url) {
    return c.json({ error: "name and url are required" }, 400);
  }

  addRegistry(name, url);
  return c.json({ added: true, name, url }, 201);
});

pluginsRouter.delete("/registries/:name", (c) => {
  const name = c.req.param("name");
  removeRegistry(name);
  return c.json({ removed: true });
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate a config object against a plugin's ConfigSchema.
 * Returns an array of error strings (empty = valid).
 */
function validateConfigAgainstSchema(
  config: Record<string, unknown>,
  schema: { fields: Array<{ name: string; required?: boolean; type: string }> },
): string[] {
  const errors: string[] = [];
  for (const field of schema.fields) {
    const value = config[field.name];
    if (field.required && (value === undefined || value === null || (field.type === "string" && value === ""))) {
      errors.push(`Field "${field.name}" is required`);
    }
  }
  return errors;
}

// Discord owner claim - call the Discord plugin's claimOwnership function
pluginsRouter.post("/discord/claim", async (c) => {
  const body = await c.req.json();
  const { code } = body;

  if (!code) {
    return c.json({ error: "code is required" }, 400);
  }

  // Get the Discord extension
  interface DiscordExtension {
    claimOwnership: (code: string) => Promise<{ success: boolean; userId?: string; username?: string; error?: string }>;
  }
  const discordExt = getPluginExtension<DiscordExtension>("discord");

  if (!discordExt) {
    return c.json({ error: "Discord plugin not loaded" }, 404);
  }

  if (!discordExt.claimOwnership) {
    return c.json({ error: "Discord plugin does not support ownership claiming" }, 400);
  }

  const result = await discordExt.claimOwnership(code);
  if (result.success) {
    return c.json({
      success: true,
      userId: result.userId,
      username: result.username,
    });
  } else {
    return c.json({ success: false, error: result.error }, 400);
  }
});
