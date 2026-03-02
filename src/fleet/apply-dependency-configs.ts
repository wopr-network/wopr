import { logger } from "../config/logger.js";

export interface DependencyConfigResult {
  pluginId?: string;
  npmPackage?: string;
  dispatched?: boolean;
  dispatchError?: string;
  skipped?: boolean;
  reason?: string;
}

interface ApplyDependencyConfigsOpts {
  botId: string;
  superpowerPluginName: string;
  pluginRegistry: ReadonlyArray<{ id: string; install: string[] }>;
  fetchDependencies: (botId: string, pluginName: string) => Promise<string[]>;
  dispatchConfig: (
    botId: string,
    pluginId: string,
    config: Record<string, unknown>,
  ) => Promise<{ dispatched: boolean; dispatchError?: string }>;
  findAllForBot: (botId: string) => Promise<Array<{ pluginId: string; configJson: string }>>;
}

/**
 * After a superpower installs, fetch its resolved dependencies from the daemon,
 * look up stored plugin_configs for each, and dispatch config to the daemon.
 * All failures are non-fatal. Returns a result array for logging.
 */
export async function applyDependencyConfigs(opts: ApplyDependencyConfigsOpts): Promise<DependencyConfigResult[]> {
  const { botId, superpowerPluginName, pluginRegistry, fetchDependencies, dispatchConfig, findAllForBot } = opts;

  const depPackages = await fetchDependencies(botId, superpowerPluginName);
  if (depPackages.length === 0) {
    return [];
  }

  const npmToPluginId = new Map<string, string>();
  for (const entry of pluginRegistry) {
    for (const pkg of entry.install) {
      npmToPluginId.set(pkg, entry.id);
    }
  }

  const storedConfigs = await findAllForBot(botId);
  const configByPluginId = new Map<string, Record<string, unknown>>();
  for (const cfg of storedConfigs) {
    try {
      configByPluginId.set(cfg.pluginId, JSON.parse(cfg.configJson) as Record<string, unknown>);
    } catch {
      // Malformed JSON — skip
    }
  }

  const results: DependencyConfigResult[] = [];

  for (const npmPkg of depPackages) {
    const pluginId = npmToPluginId.get(npmPkg);
    if (!pluginId) {
      results.push({ pluginId: undefined, skipped: true, reason: "not_in_registry", npmPackage: npmPkg });
      continue;
    }

    const storedConfig = configByPluginId.get(pluginId);
    if (!storedConfig || Object.keys(storedConfig).length === 0) {
      results.push({ pluginId, skipped: true, reason: "no_stored_config" });
      continue;
    }

    const result = await dispatchConfig(botId, pluginId, storedConfig);
    results.push({ pluginId, ...result });

    logger.info(`Dependency config dispatch for ${pluginId} on bot ${botId}`, {
      botId,
      pluginId,
      npmPkg,
      dispatched: result.dispatched,
    });
  }

  return results;
}
