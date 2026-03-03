/**
 * A2A tool dependency resolver.
 *
 * After all plugins are loaded, scans each plugin's manifest.toolDependencies
 * and resolves them against the global pluginTools registry. Returns a map
 * of tool proxies per plugin that context-factory uses for getA2ATool().
 */

import { pluginTools } from "../core/a2a-tools/_base.js";
import { logger } from "../logger.js";
import type { A2AToolResult } from "../plugin-types/a2a.js";
import { pluginManifests } from "./state.js";

export interface ResolveResult {
  /** Successfully resolved tool references (format: "pluginName:toolName") */
  resolved: string[];
  /** Missing tool references (format: "pluginName:toolName") */
  missing: string[];
  /** Map of pluginName -> Map of toolName -> handler proxy */
  toolMap: Map<string, Map<string, (args: Record<string, unknown>) => Promise<A2AToolResult>>>;
}

/**
 * Resolve all declared A2A tool dependencies across all loaded plugins.
 *
 * Call this AFTER loadAllPlugins() completes — all tools must be registered.
 */
export function resolveA2AToolDependencies(): ResolveResult {
  const resolved: string[] = [];
  const missing: string[] = [];
  const toolMap = new Map<string, Map<string, (args: Record<string, unknown>) => Promise<A2AToolResult>>>();

  for (const [pluginName, manifest] of pluginManifests) {
    if (!manifest.toolDependencies?.length) continue;

    const pluginToolMap = new Map<string, (args: Record<string, unknown>) => Promise<A2AToolResult>>();

    for (const dep of manifest.toolDependencies) {
      const registeredTool = pluginTools.get(dep.toolName);

      if (registeredTool) {
        const proxy = async (args: Record<string, unknown>): Promise<A2AToolResult> => {
          return registeredTool.handler(args, { sessionName: "" }) as Promise<A2AToolResult>;
        };

        pluginToolMap.set(dep.toolName, proxy);
        resolved.push(`${pluginName}:${dep.toolName}`);
        logger.info(`[a2a-resolver] Resolved tool dependency: ${pluginName} -> ${dep.toolName}`);
      } else {
        missing.push(`${pluginName}:${dep.toolName}`);
        if (dep.optional) {
          logger.warn(
            `[a2a-resolver] Optional tool dependency not found: ${pluginName} needs "${dep.toolName}" (skipped)`,
          );
        } else {
          logger.error(`[a2a-resolver] Required tool dependency not found: ${pluginName} needs "${dep.toolName}"`);
        }
      }
    }

    if (pluginToolMap.size > 0) {
      toolMap.set(pluginName, pluginToolMap);
    }
  }

  if (resolved.length > 0) {
    logger.info(`[a2a-resolver] Resolved ${resolved.length} tool dependencies, ${missing.length} missing`);
  }

  return { resolved, missing, toolMap };
}
