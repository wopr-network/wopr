import { logger } from "../logger.js";
import type { AdapterCapability, ProviderOption } from "../plugin-types/manifest.js";
import { getCapabilityHealthProber } from "./capability-health.js";
import { getCapabilityRegistry } from "./capability-registry.js";

/**
 * Options for resolving a capability provider.
 */
export interface ResolveCapabilityOptions {
  /** Preferred provider ID (e.g., "elevenlabs"). Falls back if unavailable. */
  preferredProvider?: string;
  /** If true, only return healthy providers. Default: true. */
  healthyOnly?: boolean;
}

/**
 * Result of capability resolution.
 */
export interface ResolvedCapability {
  /** The capability type that was resolved */
  capability: AdapterCapability;
  /** The selected provider */
  provider: ProviderOption;
  /** Whether the provider is currently healthy (if probed) */
  healthy: boolean;
}

/**
 * Resolve the best provider for a given capability type.
 *
 * Resolution order:
 * 1. If preferredProvider is set and available (and healthy), use it.
 * 2. Otherwise, pick the first healthy provider.
 * 3. If healthyOnly=false, pick the first registered provider regardless.
 * 4. If no providers exist, return null.
 */
export function resolveCapability(
  capability: AdapterCapability,
  options: ResolveCapabilityOptions = {},
): ResolvedCapability | null {
  const { preferredProvider, healthyOnly = true } = options;
  const registry = getCapabilityRegistry();
  const providers = registry.getProviders(capability);

  if (providers.length === 0) {
    logger.debug(`[capability-resolver] No providers registered for ${capability}`);
    return null;
  }

  const prober = getCapabilityHealthProber();

  // Helper: check if a provider is healthy
  const isHealthy = (providerId: string): boolean => {
    const health = prober.getProviderHealth(capability, providerId);
    // No health state = optimistic (assume healthy)
    return health ? health.healthy : true;
  };

  // 1. Try preferred provider
  if (preferredProvider) {
    const preferred = providers.find((p) => p.id === preferredProvider);
    if (preferred) {
      const healthy = isHealthy(preferred.id);
      if (!healthyOnly || healthy) {
        return { capability, provider: preferred, healthy };
      }
      logger.debug(
        `[capability-resolver] Preferred provider ${preferredProvider} for ${capability} is unhealthy, falling back`,
      );
    }
  }

  // 2. Find first healthy provider
  for (const provider of providers) {
    const healthy = isHealthy(provider.id);
    if (!healthyOnly || healthy) {
      return { capability, provider, healthy };
    }
  }

  // 3. No healthy providers found
  logger.warn(`[capability-resolver] No healthy providers for ${capability}`);
  return null;
}

/**
 * Resolve all providers for a capability, sorted by health status.
 * Healthy providers come first.
 */
export function resolveAllProviders(capability: AdapterCapability): ResolvedCapability[] {
  const registry = getCapabilityRegistry();
  const providers = registry.getProviders(capability);
  const prober = getCapabilityHealthProber();

  const resolved: ResolvedCapability[] = providers.map((provider) => {
    const health = prober.getProviderHealth(capability, provider.id);
    return {
      capability,
      provider,
      healthy: health ? health.healthy : true,
    };
  });

  // Sort: healthy first
  resolved.sort((a, b) => (a.healthy === b.healthy ? 0 : a.healthy ? -1 : 1));
  return resolved;
}
