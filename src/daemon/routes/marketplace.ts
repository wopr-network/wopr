/**
 * Marketplace API routes (WOP-203)
 *
 * Provides read-only endpoints for browsing available plugins using
 * PluginManifest metadata. These endpoints do NOT load or execute plugins;
 * they only read manifest files and registry metadata.
 *
 * Endpoints:
 *   GET /api/marketplace              — Browse available plugins
 *   GET /api/marketplace/:name        — Plugin detail (manifest + requirements)
 *   GET /api/marketplace/:name/schema — ConfigSchema for dynamic UI generation
 */

import { Hono } from "hono";
import type { PluginManifest } from "../../plugin-types/manifest.js";
import { checkRequirements } from "../../plugins/requirements.js";
import {
  getAllPluginManifests,
  getLoadedPlugin,
  listPlugins,
  readPluginManifest,
  searchPlugins,
} from "../../plugins.js";

// ============================================================================
// Router
// ============================================================================

export const marketplaceRouter = new Hono();

/**
 * GET /api/marketplace — Browse available plugins
 *
 * Combines installed (with manifest) + discoverable plugins from npm/GitHub.
 * Query params:
 *   ?q=<search>       — Filter by name/description
 *   ?category=<cat>   — Filter by manifest category
 *   ?capability=<cap> — Filter by capability
 *   ?limit=<n>        — Max results (default 50, max 200)
 */
marketplaceRouter.get("/", async (c) => {
  const query = c.req.query("q") || "";
  const category = c.req.query("category");
  const capability = c.req.query("capability");
  const limit = Math.min(Number(c.req.query("limit")) || 50, 200);

  // 1. Collect installed plugins with their manifests
  const installed = listPlugins();
  const runtimeManifests = getAllPluginManifests();

  interface MarketplaceEntry {
    name: string;
    version: string;
    description: string | null;
    source: string;
    installed: boolean;
    enabled: boolean;
    loaded: boolean;
    manifest: Partial<PluginManifest> | null;
  }

  const results: MarketplaceEntry[] = [];
  const seen = new Set<string>();

  for (const p of installed) {
    const manifest = runtimeManifests.get(p.name) || readPluginManifest(p.path);

    // Apply filters
    if (category && manifest?.category !== category) continue;
    if (capability && !manifest?.capabilities?.includes(capability as any)) continue;
    if (query && !p.name.includes(query) && !p.description?.includes(query) && !manifest?.description?.includes(query))
      continue;

    seen.add(p.name);
    results.push({
      name: p.name,
      version: p.version,
      description: p.description || manifest?.description || null,
      source: p.source,
      installed: true,
      enabled: p.enabled,
      loaded: getLoadedPlugin(p.name) !== undefined,
      manifest: manifest
        ? {
            capabilities: manifest.capabilities,
            category: manifest.category,
            tags: manifest.tags,
            icon: manifest.icon,
            author: manifest.author,
            license: manifest.license,
            homepage: manifest.homepage,
          }
        : null,
    });
  }

  // 2. Append discoverable plugins from npm/GitHub (not installed)
  try {
    const discovered = await searchPlugins(query);
    for (const d of discovered) {
      if (seen.has(d.name)) continue;
      seen.add(d.name);
      results.push({
        name: d.name,
        version: d.version || "unknown",
        description: d.description || null,
        source: d.source,
        installed: d.installed || false,
        enabled: false,
        loaded: false,
        manifest: null,
      });
    }
  } catch {
    // Search failed (offline, etc.) — return installed-only results
  }

  return c.json({
    total: results.length,
    plugins: results.slice(0, limit),
  });
});

/**
 * GET /api/marketplace/:name — Plugin detail
 *
 * Returns the full manifest, requirements, setup steps, and install methods
 * for a specific plugin. Works for both installed and loaded plugins.
 */
marketplaceRouter.get("/:name", async (c) => {
  const name = c.req.param("name");

  const installed = listPlugins();
  const plugin = installed.find((p: { name: string }) => p.name === name);

  if (!plugin) {
    return c.json({ error: "Plugin not found. Install it first to view full details." }, 404);
  }

  const runtimeManifests = getAllPluginManifests();
  const manifest = runtimeManifests.get(name) || readPluginManifest(plugin.path);

  if (!manifest) {
    return c.json({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description || null,
      source: plugin.source,
      installed: true,
      enabled: plugin.enabled,
      loaded: getLoadedPlugin(name) !== undefined,
      manifest: null,
      requirements: null,
      setup: null,
      install: null,
    });
  }

  // Check requirements status
  let requirementsStatus = null;
  if (manifest.requires) {
    try {
      requirementsStatus = await checkRequirements(manifest.requires);
    } catch {
      // Requirements check failed — not critical for marketplace
    }
  }

  return c.json({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author || null,
    license: manifest.license || null,
    homepage: manifest.homepage || null,
    repository: manifest.repository || null,
    icon: manifest.icon || null,
    category: manifest.category || null,
    tags: manifest.tags || [],
    capabilities: manifest.capabilities,
    source: plugin.source,
    installed: true,
    enabled: plugin.enabled,
    loaded: getLoadedPlugin(name) !== undefined,
    requires: manifest.requires || null,
    requirementsStatus,
    install: manifest.install || null,
    setup: manifest.setup || null,
    configSchema: manifest.configSchema || null,
    dependencies: manifest.dependencies || null,
    conflicts: manifest.conflicts || null,
    minCoreVersion: manifest.minCoreVersion || null,
    lifecycle: manifest.lifecycle || null,
  });
});

/**
 * GET /api/marketplace/:name/schema — ConfigSchema for dynamic UI generation
 *
 * Returns only the ConfigSchema for a plugin, useful for generating
 * dynamic configuration forms in the dashboard without fetching the
 * full manifest.
 */
marketplaceRouter.get("/:name/schema", (c) => {
  const name = c.req.param("name");

  const installed = listPlugins();
  const plugin = installed.find((p: { name: string }) => p.name === name);

  if (!plugin) {
    return c.json({ error: "Plugin not found" }, 404);
  }

  const runtimeManifests = getAllPluginManifests();
  const manifest = runtimeManifests.get(name) || readPluginManifest(plugin.path);

  if (!manifest?.configSchema) {
    return c.json({ name, configSchema: null });
  }

  return c.json({
    name,
    configSchema: manifest.configSchema,
  });
});
