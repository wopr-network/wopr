import type { AdapterCapability } from "../plugin-types/manifest.js";

export interface CapabilityDependency {
  pluginName: string;
  capability: AdapterCapability;
  optional: boolean;
}

/**
 * Tracks which plugins depend on which capabilities.
 * Used for:
 * - "Which plugins break if I remove TTS?" (removal warnings)
 * - "Which plugins share the STT provider?" (shared capabilities)
 */
export class CapabilityDependencyGraph {
  // capability -> set of { pluginName, optional }
  private deps = new Map<AdapterCapability, Set<string>>();
  // pluginName -> list of capability requirements
  private pluginDeps = new Map<string, CapabilityDependency[]>();

  /**
   * Register a plugin's capability dependencies (called during plugin load).
   */
  registerPlugin(
    pluginName: string,
    requirements: Array<{ capability: AdapterCapability; optional?: boolean }>
  ): void {
    const deps: CapabilityDependency[] = [];

    for (const req of requirements) {
      deps.push({
        pluginName,
        capability: req.capability,
        optional: req.optional ?? false,
      });

      let capSet = this.deps.get(req.capability);
      if (!capSet) {
        capSet = new Set();
        this.deps.set(req.capability, capSet);
      }
      capSet.add(pluginName);
    }

    this.pluginDeps.set(pluginName, deps);
  }

  /**
   * Unregister a plugin (called during plugin unload).
   */
  unregisterPlugin(pluginName: string): void {
    const deps = this.pluginDeps.get(pluginName);
    if (!deps) return;

    for (const dep of deps) {
      this.deps.get(dep.capability)?.delete(pluginName);
    }
    this.pluginDeps.delete(pluginName);
  }

  /**
   * Get all plugins that depend on a capability.
   * Used for removal warnings.
   */
  getDependents(capability: AdapterCapability): string[] {
    return Array.from(this.deps.get(capability) ?? []);
  }

  /**
   * Get all capabilities a plugin requires.
   */
  getPluginDependencies(pluginName: string): CapabilityDependency[] {
    return this.pluginDeps.get(pluginName) ?? [];
  }

  /**
   * Check if removing a capability's last provider would affect any plugins.
   * Returns the list of affected plugin names.
   */
  getAffectedPlugins(capability: AdapterCapability): string[] {
    const dependents = this.getDependents(capability);
    // Filter to only non-optional dependents
    return dependents.filter((name) => {
      const deps = this.pluginDeps.get(name);
      const dep = deps?.find((d) => d.capability === capability);
      return dep && !dep.optional;
    });
  }
}

// Singleton
let instance: CapabilityDependencyGraph | null = null;

export function getCapabilityDependencyGraph(): CapabilityDependencyGraph {
  if (!instance) {
    instance = new CapabilityDependencyGraph();
  }
  return instance;
}

export function resetCapabilityDependencyGraph(): void {
  instance = null;
}
