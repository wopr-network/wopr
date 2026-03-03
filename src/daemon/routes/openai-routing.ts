/**
 * Inference routing strategies for OpenAI-compatible API.
 *
 * Pure functions that select a provider from the available set
 * based on the chosen strategy.
 */

export type RoutingStrategy = "first" | "cheapest" | "capable" | "preferred";

export interface RoutableProvider {
  id: string;
  name: string;
  available: boolean;
  supportedModels: string[];
}

interface ProviderCostConfig {
  costPerToken?: number;
  preferred?: boolean;
}

/**
 * Select a provider based on the given strategy.
 *
 * @param providers - All registered providers with availability and model info
 * @param model - The requested model string
 * @param strategy - Which routing strategy to use
 * @param providerConfigs - Per-provider config (costs, preferred flag)
 * @returns The selected provider, or null if none available
 */
export function selectProvider(
  providers: RoutableProvider[],
  model: string,
  strategy: RoutingStrategy,
  providerConfigs: Record<string, ProviderCostConfig>,
): RoutableProvider | null {
  const available = providers.filter((p) => p.available);
  if (available.length === 0) return null;

  // Direct match on provider ID always wins (existing behavior)
  const directMatch = available.find((p) => p.id === model);
  if (directMatch) return directMatch;

  switch (strategy) {
    case "capable": {
      const capable = available.filter((p) => p.supportedModels.includes(model));
      return capable.length > 0 ? capable[0] : available[0];
    }

    case "cheapest": {
      const withCosts = available
        .map((p) => ({ provider: p, cost: providerConfigs[p.id]?.costPerToken ?? Number.POSITIVE_INFINITY }))
        .sort((a, b) => a.cost - b.cost);
      return withCosts[0].provider;
    }

    case "preferred": {
      const preferred = available.find((p) => providerConfigs[p.id]?.preferred === true);
      return preferred ?? available[0];
    }

    default:
      return available[0];
  }
}
