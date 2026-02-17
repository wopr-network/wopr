/**
 * Capability Activation Routes (WOP-504)
 *
 * Zero-click activation: user picks a capability, platform does the rest.
 *
 * Endpoints:
 *   GET  /api/capabilities           — List available capabilities + activation status
 *   POST /api/capabilities/activate  — Activate a capability (install + configure + load)
 *   POST /api/capabilities/deactivate — Deactivate a capability (unload + disable)
 */

import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { z } from "zod";
import { getCapabilityCatalogEntry, listCapabilityCatalog } from "../../core/capability-catalog.js";
import { config as centralConfig } from "../../core/config.js";
import { providerRegistry } from "../../core/providers.js";
import { getSessions, inject } from "../../core/sessions.js";
import { logger } from "../../logger.js";
import {
  disablePlugin,
  enablePlugin,
  getLoadedPlugin,
  installPlugin,
  listPlugins,
  loadPlugin,
  unloadPlugin,
} from "../../plugins.js";
import type { InstalledPlugin, PluginInjectOptions } from "../../types.js";

// ============================================================================
// Rate limiting
// ============================================================================

const rateLimitKey = (c: { req: { header: (name: string) => string | undefined } }) =>
  c.req.header("authorization") ?? c.req.header("x-forwarded-for") ?? "anonymous";

/** 10 requests/minute for activate/deactivate (heavy operations). */
const mutateRateLimit = rateLimiter({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-6",
  keyGenerator: rateLimitKey,
  handler: (c) => c.json({ error: "Too many activation requests, please try again later" }, 429),
});

// ============================================================================
// Types
// ============================================================================

interface PluginConfigData {
  plugins?: {
    data?: Record<string, unknown>;
  };
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

// ============================================================================
// Router
// ============================================================================

export const capabilitiesRouter = new Hono();

// Validation schemas
const ActivateSchema = z.object({
  capability: z.string().min(1),
});

const DeactivateSchema = z.object({
  capability: z.string().min(1),
});

// GET /api/capabilities — List capabilities with activation status
capabilitiesRouter.get("/", async (c) => {
  const catalog = listCapabilityCatalog();
  const installed = await listPlugins();
  const installedNames = new Set(installed.map((p: InstalledPlugin) => p.name));

  const capabilities = catalog.map((entry) => {
    const pluginStatuses = entry.plugins.map((ref) => {
      const plugin = installed.find((p: InstalledPlugin) => p.name === ref.name);
      return {
        name: ref.name,
        installed: installedNames.has(ref.name),
        enabled: plugin?.enabled ?? false,
        loaded: getLoadedPlugin(ref.name) !== undefined,
      };
    });

    const active = pluginStatuses.every((s) => s.installed && s.enabled && s.loaded);

    return {
      id: entry.id,
      label: entry.label,
      description: entry.description,
      icon: entry.icon,
      active,
      plugins: pluginStatuses,
    };
  });

  return c.json({ capabilities });
});

// POST /api/capabilities/activate — Activate a capability (install + configure + load)
capabilitiesRouter.post("/activate", mutateRateLimit, async (c) => {
  const parsed = ActivateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const { capability } = parsed.data;
  const entry = getCapabilityCatalogEntry(capability);
  if (!entry) {
    return c.json({ error: `Unknown capability: ${capability}` }, 404);
  }

  // Check if already fully active
  const installed = await listPlugins();
  const allActive = entry.plugins.every((ref) => {
    const p = installed.find((ip: InstalledPlugin) => ip.name === ref.name);
    return p?.enabled && getLoadedPlugin(ref.name) !== undefined;
  });

  if (allActive) {
    return c.json({
      activated: true,
      capability: entry.id,
      message: entry.activatedMessage,
      alreadyActive: true,
    });
  }

  // Resolve the bot's platform token for WOPR-hosted config
  const platformToken = process.env.WOPR_PLATFORM_TOKEN || (centralConfig.getValue("platform.token") as string) || "";

  const activatedPlugins: Array<{ name: string; version: string }> = [];
  const errors: Array<{ plugin: string; error: string }> = [];

  for (const ref of entry.plugins) {
    try {
      // Check if already installed
      let plugin = installed.find((p: InstalledPlugin) => p.name === ref.name) as InstalledPlugin | undefined;

      if (!plugin) {
        // Install the plugin
        plugin = await installPlugin(ref.source);
      }

      // Enable if not enabled
      if (!plugin.enabled) {
        const enabled = await enablePlugin(plugin.name);
        if (enabled === false) {
          throw new Error(`Plugin ${plugin.name} could not be enabled — plugin record not found`);
        }
      }

      // Set WOPR-hosted config (auto-configure to api.wopr.bot)
      // Only set config if not already configured (don't overwrite existing user config)
      await centralConfig.load();
      const cfg = centralConfig.get() as unknown as PluginConfigData;
      if (!cfg.plugins) cfg.plugins = {};
      if (!cfg.plugins.data) cfg.plugins.data = {};

      // Only inject hosted config if the plugin has no existing config
      if (!cfg.plugins.data[plugin.name]) {
        cfg.plugins.data[plugin.name] = {
          ...ref.hostedConfig,
          ...(platformToken ? { platformToken } : {}),
        };
        centralConfig.setValue("plugins.data", cfg.plugins.data);
        await centralConfig.save();
      }

      // Hot-load the plugin if not already loaded
      if (!getLoadedPlugin(plugin.name)) {
        const injectors = await createInjectors();
        await loadPlugin(plugin, injectors);
      }

      activatedPlugins.push({ name: plugin.name, version: plugin.version });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ msg: "[capabilities] Activation failed for plugin", plugin: ref.name, error: message });
      errors.push({ plugin: ref.name, error: message });
    }
  }

  // Run provider health check after all plugins loaded
  try {
    await providerRegistry.checkHealth();
  } catch (err) {
    // Non-fatal — health check failure shouldn't block activation
    logger.warn({
      msg: "[capabilities] Provider health check failed after activation",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (errors.length > 0 && activatedPlugins.length === 0) {
    // Total failure
    return c.json(
      {
        activated: false,
        capability: entry.id,
        errors,
      },
      500,
    );
  }

  return c.json({
    activated: true,
    capability: entry.id,
    message: entry.activatedMessage,
    plugins: activatedPlugins,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// POST /api/capabilities/deactivate — Deactivate a capability (unload + disable)
capabilitiesRouter.post("/deactivate", mutateRateLimit, async (c) => {
  const parsed = DeactivateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }

  const { capability } = parsed.data;
  const entry = getCapabilityCatalogEntry(capability);
  if (!entry) {
    return c.json({ error: `Unknown capability: ${capability}` }, 404);
  }

  const deactivated: string[] = [];
  const errors: Array<{ plugin: string; error: string }> = [];

  for (const ref of entry.plugins) {
    try {
      await unloadPlugin(ref.name);
      await disablePlugin(ref.name);
      deactivated.push(ref.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ msg: "[capabilities] Deactivation failed for plugin", plugin: ref.name, error: message });
      errors.push({ plugin: ref.name, error: message });
    }
  }

  // Build updated capabilities list for UI to refresh state (mirrors activate response)
  const updatedInstalled = await listPlugins();
  const updatedInstalledNames = new Set(updatedInstalled.map((p: InstalledPlugin) => p.name));
  const catalog = listCapabilityCatalog();
  const capabilities = catalog.map((cap) => {
    const pluginStatuses = cap.plugins.map((ref) => {
      const p = updatedInstalled.find((ip: InstalledPlugin) => ip.name === ref.name);
      return {
        name: ref.name,
        installed: updatedInstalledNames.has(ref.name),
        enabled: p?.enabled ?? false,
        loaded: getLoadedPlugin(ref.name) !== undefined,
      };
    });
    const active = pluginStatuses.every((s) => s.installed && s.enabled && s.loaded);
    return {
      id: cap.id,
      label: cap.label,
      description: cap.description,
      icon: cap.icon,
      active,
      plugins: pluginStatuses,
    };
  });

  return c.json({
    deactivated: true,
    capability: entry.id,
    plugins: deactivated,
    errors: errors.length > 0 ? errors : undefined,
    capabilities,
  });
});
