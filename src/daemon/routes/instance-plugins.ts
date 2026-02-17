/**
 * Per-instance plugin management API routes (WOP-203)
 *
 * Provides REST endpoints for managing plugins on individual WOPR instances.
 * Currently proxies to the daemon's global plugin system since each daemon
 * manages a single instance. This abstraction layer allows future multi-instance
 * support without API changes.
 */

import { Hono } from "hono";
import { z } from "zod";
import { config as centralConfig } from "../../core/config.js";
import { providerRegistry } from "../../core/providers.js";
import { getSessions, inject } from "../../core/sessions.js";
import { logger } from "../../logger.js";
import {
  disablePlugin,
  enablePlugin,
  getAllPluginManifests,
  getConfigSchemas,
  getLoadedPlugin,
  installPlugin,
  listPlugins,
  loadPlugin,
  readPluginManifest,
  removePlugin,
  unloadPlugin,
} from "../../plugins.js";
import type { ConfigSchema, PluginInjectOptions } from "../../types.js";

// ============================================================================
// Zod Schemas
// ============================================================================

const installBodySchema = z.object({
  source: z.string().min(1, "source is required"),
  /** "npm" | "github" | "local" — hint for install strategy */
  type: z.enum(["npm", "github", "local"]).optional(),
});

const configUpdateSchema = z.object({
  config: z.record(z.string(), z.unknown()),
});

// ============================================================================
// Validation
// ============================================================================

const PLUGIN_NAME_RE = /^[@a-z0-9][\w./-]*$/i;
const SHELL_META_RE = /[;|&$`\\!><()"'\n\r]/;

function validatePluginName(name: string): string | null {
  if (!name || !PLUGIN_NAME_RE.test(name) || name.includes("..") || SHELL_META_RE.test(name)) {
    return `Invalid plugin name "${name}": must match ${PLUGIN_NAME_RE}, without ".." or shell metacharacters`;
  }
  return null;
}

/** Validate that the instance ID is a safe identifier. */
function validateInstanceId(id: string): string | null {
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id) || id.includes("..")) {
    return `Invalid instance ID "${id}"`;
  }
  return null;
}

// ============================================================================
// Helpers
// ============================================================================

async function createInjectors() {
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
// Router
// ============================================================================

export const instancePluginsRouter = new Hono();

/**
 * Middleware: validate instance ID on all routes.
 * Currently accepts any valid ID — in a multi-instance future this would
 * verify the instance exists and the caller has access.
 */
instancePluginsRouter.use("/*", async (c, next) => {
  const id = c.req.param("id");
  if (id) {
    const err = validateInstanceId(id);
    if (err) {
      return c.json({ error: err }, 400);
    }
  }
  await next();
});

// GET /api/instances/:id/plugins — List installed plugins
instancePluginsRouter.get("/", async (c) => {
  const plugins = await listPlugins();
  const runtimeManifests = getAllPluginManifests();
  return c.json({
    plugins: plugins.map((p: PluginEntry) => {
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

// POST /api/instances/:id/plugins — Install plugin
instancePluginsRouter.post("/", async (c) => {
  const parsed = installBodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const { source } = parsed.data;
  const nameErr = validatePluginName(source);
  if (nameErr) {
    return c.json({ error: nameErr }, 400);
  }

  try {
    const plugin = await installPlugin(source);
    await enablePlugin(plugin.name);

    const injectors = await createInjectors();
    await loadPlugin(plugin, injectors);
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
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[instance-plugins] Install failed", error: message });
    return c.json({ error: "Plugin installation failed", detail: message }, 400);
  }
});

// DELETE /api/instances/:id/plugins/:name — Uninstall plugin
instancePluginsRouter.delete("/:name", async (c) => {
  const name = c.req.param("name");
  const nameErr = validatePluginName(name);
  if (nameErr) {
    return c.json({ error: nameErr }, 400);
  }

  try {
    await unloadPlugin(name);
    await removePlugin(name);
    return c.json({ removed: true, unloaded: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[instance-plugins] Uninstall failed", plugin: name, error: message });
    return c.json({ error: "Plugin uninstall failed" }, 400);
  }
});

// POST /api/instances/:id/plugins/:name/enable — Enable plugin
instancePluginsRouter.post("/:name/enable", async (c) => {
  const name = c.req.param("name");
  const nameErr = validatePluginName(name);
  if (nameErr) {
    return c.json({ error: nameErr }, 400);
  }

  const plugins = await listPlugins();
  const plugin = plugins.find((p: PluginEntry) => p.name === name);
  if (!plugin) {
    return c.json({ error: "Plugin not found" }, 404);
  }

  try {
    await enablePlugin(name);
    const injectors = await createInjectors();
    await loadPlugin(plugin, injectors);
    await providerRegistry.checkHealth();
    return c.json({ enabled: true, loaded: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[instance-plugins] Enable failed", plugin: name, error: message });
    return c.json({ error: "Plugin enable failed" }, 400);
  }
});

// POST /api/instances/:id/plugins/:name/disable — Disable plugin
instancePluginsRouter.post("/:name/disable", async (c) => {
  const name = c.req.param("name");
  const nameErr = validatePluginName(name);
  if (nameErr) {
    return c.json({ error: nameErr }, 400);
  }

  try {
    await unloadPlugin(name);
    await disablePlugin(name);
    return c.json({ disabled: true, unloaded: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ msg: "[instance-plugins] Disable failed", plugin: name, error: message });
    return c.json({ error: "Plugin disable failed" }, 400);
  }
});

// GET /api/instances/:id/plugins/:name/config — Get plugin config
instancePluginsRouter.get("/:name/config", async (c) => {
  const name = c.req.param("name");

  const plugins = await listPlugins();
  const plugin = plugins.find((p: PluginEntry) => p.name === name);
  if (!plugin) {
    return c.json({ error: "Plugin not found" }, 404);
  }

  await centralConfig.load();
  const cfg = centralConfig.get();
  const pluginConfig = (cfg as unknown as PluginConfigData).plugins?.data?.[name] || {};

  const schemas = getConfigSchemas();
  let schema = schemas.get(name) || null;

  if (!schema) {
    const manifest = readPluginManifest(plugin.path);
    if (manifest?.configSchema) {
      schema = manifest.configSchema as ConfigSchema;
    }
  }

  return c.json({ name, config: pluginConfig, configSchema: schema });
});

// PUT /api/instances/:id/plugins/:name/config — Update plugin config
instancePluginsRouter.put("/:name/config", async (c) => {
  const name = c.req.param("name");

  const plugins = await listPlugins();
  const plugin = plugins.find((p: PluginEntry) => p.name === name);
  if (!plugin) {
    return c.json({ error: "Plugin not found" }, 404);
  }

  const parsed = configUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const { config: newConfig } = parsed.data;

  // Validate against configSchema if available
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
