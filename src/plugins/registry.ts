/**
 * Plugin discovery and registry management.
 *
 * Manages plugin registries (URLs), searching for plugins across
 * npm, GitHub, and local sources, and voice plugin discovery.
 */

import { execFileSync, spawnSync } from "node:child_process";
import type { PluginRegistryEntry } from "../types.js";
import { getInstalledPlugins } from "./installation.js";
import { ensurePluginSchema, getRegistryRepo } from "./plugin-storage.js";

export interface DiscoveredPlugin {
  name: string;
  description?: string;
  source: "github" | "npm" | "installed" | "registry";
  url?: string;
  version?: string;
  installed?: boolean;
}

// ============================================================================
// Config Schemas (re-exported from state)
// ============================================================================

export { configSchemas } from "./state.js";

// ============================================================================
// Plugin Registries
// ============================================================================

export async function getPluginRegistries(): Promise<PluginRegistryEntry[]> {
  await ensurePluginSchema();
  return getRegistryRepo().findMany();
}

export async function addRegistry(url: string, name?: string): Promise<PluginRegistryEntry> {
  await ensurePluginSchema();
  const entry: PluginRegistryEntry = {
    url,
    name: name || new URL(url).hostname,
    enabled: true,
    lastSync: 0,
  };
  await getRegistryRepo().insert(entry as never);
  return entry;
}

export async function removeRegistry(url: string): Promise<boolean> {
  await ensurePluginSchema();
  return getRegistryRepo().delete(url);
}

export async function listRegistries(): Promise<PluginRegistryEntry[]> {
  return getPluginRegistries();
}

// ============================================================================
// Plugin Search & Discovery
// ============================================================================

/**
 * Search for plugins across multiple sources
 */
export async function searchPlugins(query: string): Promise<DiscoveredPlugin[]> {
  const results: DiscoveredPlugin[] = [];
  const seen = new Set<string>();

  // 1. Check installed plugins first
  const installed = await getInstalledPlugins();
  for (const p of installed) {
    if (!query || p.name.includes(query)) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        results.push({
          name: p.name,
          description: p.description,
          source: "installed",
          version: p.version,
          installed: true,
        });
      }
    }
  }

  // 2. Search GitHub repos (if gh is available)
  try {
    const ghResults = await searchGitHubPlugins(query);
    for (const p of ghResults) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        p.installed = installed.some((i) => i.name === p.name);
        results.push(p);
      }
    }
  } catch {
    // gh not available or error, skip
  }

  // 3. Search npm (if online)
  try {
    const npmResults = await searchNpmPlugins(query);
    for (const p of npmResults) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        p.installed = installed.some((i) => i.name === p.name);
        results.push(p);
      }
    }
  } catch {
    // npm search failed, skip
  }

  return results;
}

/**
 * Search GitHub for wopr plugins using gh CLI
 */
async function searchGitHubPlugins(query?: string): Promise<DiscoveredPlugin[]> {
  const results: DiscoveredPlugin[] = [];

  try {
    // Get user's repos matching wopr-plugin-*
    const output = execFileSync("gh", ["repo", "list", "--json", "name,description,url", "--limit", "100"], {
      encoding: "utf-8",
      timeout: 10000,
    });
    const repos = JSON.parse(output);

    for (const repo of repos) {
      if (repo.name.startsWith("wopr-plugin-")) {
        if (!query || repo.name.includes(query) || repo.description?.includes(query)) {
          results.push({
            name: repo.name,
            description: repo.description,
            source: "github",
            url: repo.url,
          });
        }
      }
    }
  } catch {
    // gh not available or not authenticated
  }

  return results;
}

/**
 * Search npm for wopr plugins
 */
async function searchNpmPlugins(query?: string): Promise<DiscoveredPlugin[]> {
  const results: DiscoveredPlugin[] = [];
  const sanitized = query ? query.replace(/[^a-zA-Z0-9._-]/g, "") : "";
  const searchTerm = sanitized ? `wopr-plugin-${sanitized}` : "wopr-plugin-";

  try {
    const result = spawnSync("npm", ["search", searchTerm, "--json"], {
      encoding: "utf-8",
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    if (result.error || result.status !== 0 || !result.stdout) {
      return results;
    }
    const output = result.stdout;
    const packages = JSON.parse(output);

    for (const pkg of packages) {
      if (pkg.name.startsWith("wopr-plugin-")) {
        results.push({
          name: pkg.name,
          description: pkg.description,
          source: "npm",
          version: pkg.version,
          url: `https://www.npmjs.com/package/${pkg.name}`,
        });
      }
    }
  } catch {
    // npm search failed
  }

  return results;
}

/**
 * Discover all available voice plugins from GitHub
 */
export async function discoverVoicePlugins(): Promise<{
  stt: DiscoveredPlugin[];
  tts: DiscoveredPlugin[];
  channels: DiscoveredPlugin[];
  cli: DiscoveredPlugin[];
}> {
  const all = await searchPlugins("voice");

  return {
    stt: all.filter((p) => p.name.includes("stt") || p.name.includes("whisper") || p.name.includes("deepgram")),
    tts: all.filter((p) => p.name.includes("tts") || p.name.includes("piper") || p.name.includes("elevenlabs")),
    channels: all.filter((p) => p.name.includes("channel") && p.name.includes("voice")),
    cli: all.filter((p) => p.name.includes("voice-cli")),
  };
}
