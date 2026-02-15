import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
import type { AdapterCapability, ProviderOption } from "../plugin-types/manifest.js";

export interface CapabilityEntry {
  capability: AdapterCapability;
  providers: Map<string, ProviderOption>;
}

/**
 * Events emitted by the capability registry.
 *
 * "provider:registered"   -> { capability, provider }
 * "provider:unregistered" -> { capability, providerId }
 */
export class CapabilityRegistry extends EventEmitter {
  private capabilities = new Map<AdapterCapability, CapabilityEntry>();

  constructor() {
    super();
    // Seed with known capabilities (empty provider lists)
    const seeds: AdapterCapability[] = ["tts", "stt", "text-gen", "image-gen", "embeddings"];
    for (const cap of seeds) {
      this.capabilities.set(cap, { capability: cap, providers: new Map() });
    }
  }

  /**
   * Register a provider for a capability.
   * If the capability doesn't exist yet, it's created (extensible).
   */
  registerProvider(capability: AdapterCapability, provider: ProviderOption): void {
    let entry = this.capabilities.get(capability);
    if (!entry) {
      entry = { capability, providers: new Map() };
      this.capabilities.set(capability, entry);
    }

    entry.providers.set(provider.id, provider);
    this.emit("provider:registered", { capability, provider });
    logger.info(`[capability-registry] Registered ${provider.id} for ${capability}`);
  }

  /**
   * Unregister a provider from a capability.
   */
  unregisterProvider(capability: AdapterCapability, providerId: string): void {
    const entry = this.capabilities.get(capability);
    if (!entry) return;

    entry.providers.delete(providerId);
    this.emit("provider:unregistered", { capability, providerId });
    logger.info(`[capability-registry] Unregistered ${providerId} from ${capability}`);
  }

  /**
   * Get all providers for a capability.
   */
  getProviders(capability: AdapterCapability): ProviderOption[] {
    const entry = this.capabilities.get(capability);
    return entry ? Array.from(entry.providers.values()) : [];
  }

  /**
   * Check if a capability has at least one registered provider.
   */
  hasProvider(capability: AdapterCapability): boolean {
    const entry = this.capabilities.get(capability);
    return entry ? entry.providers.size > 0 : false;
  }

  /**
   * Get a specific provider by capability + id.
   */
  getProvider(capability: AdapterCapability, providerId: string): ProviderOption | undefined {
    return this.capabilities.get(capability)?.providers.get(providerId);
  }

  /**
   * List all known capabilities and their provider counts.
   */
  listCapabilities(): Array<{ capability: AdapterCapability; providerCount: number }> {
    return Array.from(this.capabilities.values()).map((e) => ({
      capability: e.capability,
      providerCount: e.providers.size,
    }));
  }

  /**
   * Check which capabilities from a requirements list are unsatisfied.
   * Returns the list of missing required capabilities (ignores optional ones).
   */
  checkRequirements(
    requirements: Array<{ capability: AdapterCapability; optional?: boolean }>
  ): { satisfied: boolean; missing: AdapterCapability[]; optional: AdapterCapability[] } {
    const missing: AdapterCapability[] = [];
    const optionalMissing: AdapterCapability[] = [];

    for (const req of requirements) {
      if (!this.hasProvider(req.capability)) {
        if (req.optional) {
          optionalMissing.push(req.capability);
        } else {
          missing.push(req.capability);
        }
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
      optional: optionalMissing,
    };
  }
}

// Singleton
let instance: CapabilityRegistry | null = null;

export function getCapabilityRegistry(): CapabilityRegistry {
  if (!instance) {
    instance = new CapabilityRegistry();
  }
  return instance;
}

export function resetCapabilityRegistry(): void {
  instance = null;
}
