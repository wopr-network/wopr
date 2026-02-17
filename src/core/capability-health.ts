/**
 * Capability Health Probe System
 *
 * Monitors health status for capability providers registered in the CapabilityRegistry.
 * Plugins can register health probe functions that run periodically to validate provider connectivity.
 *
 * Events emitted:
 * - "providerStatusChange" -> { capability, providerId, providerName, previousHealthy, currentHealthy, error? }
 */

import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
import type { AdapterCapability } from "../plugin-types/manifest.js";
import { getCapabilityRegistry } from "./capability-registry.js";
import { eventBus } from "./events.js";

/** Health status for a single capability provider */
export interface CapabilityProviderHealth {
  capability: AdapterCapability;
  providerId: string;
  providerName: string;
  healthy: boolean;
  lastCheck: string; // ISO timestamp
  lastHealthy: string | null; // ISO timestamp of last healthy check
  error?: string;
  responseTimeMs?: number;
  consecutiveFailures: number;
}

/** Aggregated health for a capability type */
export interface CapabilityHealth {
  capability: AdapterCapability;
  healthy: boolean; // true if at least one provider is healthy
  providers: CapabilityProviderHealth[];
  healthyCount: number;
  totalCount: number;
}

/** Full health snapshot across all capabilities */
export interface CapabilityHealthSnapshot {
  timestamp: string;
  capabilities: CapabilityHealth[];
  overallHealthy: boolean; // true if all capabilities have at least one healthy provider
}

/** Health probe function signature — plugins register these */
export type HealthProbeFn = () => Promise<boolean>;

export interface CapabilityHealthProberConfig {
  intervalMs?: number;
  probeTimeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_PROBE_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Run a health probe with a timeout.
 */
async function runProbeWithTimeout(
  probe: HealthProbeFn,
  timeoutMs: number,
): Promise<{ healthy: boolean; responseTimeMs: number; error?: string }> {
  const start = Date.now();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("Probe timed out")), timeoutMs);
      }),
    ]);
    // Clean up timeout if probe resolved first
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
    return { healthy: result, responseTimeMs: Date.now() - start };
  } catch (err) {
    // Clean up timeout if probe rejected
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
    return {
      healthy: false,
      responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export class CapabilityHealthProber extends EventEmitter {
  private intervalMs: number;
  private probeTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private probes = new Map<string, HealthProbeFn>(); // "capability:providerId" -> probe fn
  private healthState = new Map<string, CapabilityProviderHealth>(); // "capability:providerId" -> state
  private checkAborted = false; // abort flag for graceful shutdown
  private checkInFlight = false; // guard against overlapping checks

  constructor(config: CapabilityHealthProberConfig = {}) {
    super();
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.probeTimeoutMs = config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  }

  /** Register a health probe for a specific capability provider */
  registerProbe(capability: AdapterCapability, providerId: string, probe: HealthProbeFn): void {
    const key = `${capability}:${providerId}`;
    this.probes.set(key, probe);
    logger.debug(`[capability-health] Registered probe for ${key}`);
  }

  /** Unregister a health probe */
  unregisterProbe(capability: AdapterCapability, providerId: string): void {
    const key = `${capability}:${providerId}`;
    this.probes.delete(key);
    // Clean up health state to prevent unbounded map growth
    this.healthState.delete(key);
    logger.debug(`[capability-health] Unregistered probe for ${key}`);
  }

  /** Start periodic probing */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.check().catch((err) => {
        logger.error(`[capability-health] Periodic check failed: ${err instanceof Error ? err.message : String(err)}`);
        // Emit health error event so listeners are aware
        this.emit("healthCheckError", { error: err instanceof Error ? err.message : String(err) });
      });
    }, this.intervalMs);
    // Run an initial check immediately
    this.check().catch((err) => {
      logger.error(`[capability-health] Initial check failed: ${err instanceof Error ? err.message : String(err)}`);
      // Emit health error event so listeners are aware
      this.emit("healthCheckError", { error: err instanceof Error ? err.message : String(err) });
    });
  }

  /** Stop periodic probing */
  stop(): void {
    // Signal any running checks to abort
    this.checkAborted = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Check if periodic probing is currently running */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Run all probes and return snapshot */
  async check(): Promise<CapabilityHealthSnapshot> {
    // Guard against overlapping checks
    if (this.checkInFlight) {
      logger.debug("[capability-health] Check already in flight, skipping");
      return this.getSnapshot();
    }
    this.checkInFlight = true;
    try {
      // Reset abort flag at start of new check
      this.checkAborted = false;
      const registry = getCapabilityRegistry();
      const capabilityList = registry.listCapabilities();
      const now = new Date().toISOString();

      // Collect all probe tasks
      const probeTasks: Array<{
        capability: AdapterCapability;
        providerId: string;
        providerName: string;
        key: string;
        probe?: HealthProbeFn;
      }> = [];

      for (const { capability } of capabilityList) {
        const providers = registry.getProviders(capability);
        for (const provider of providers) {
          const key = `${capability}:${provider.id}`;
          const probe = this.probes.get(key);
          probeTasks.push({
            capability,
            providerId: provider.id,
            providerName: provider.name,
            key,
            probe,
          });
        }
      }

      // Run all probes concurrently with Promise.allSettled
      const probeResults = await Promise.allSettled(
        probeTasks.map(async (task) => {
          // Early exit if check was aborted
          if (this.checkAborted) {
            return { ...task, healthy: false, error: "Check aborted", responseTimeMs: 0 };
          }
          if (!task.probe) {
            // No probe registered — optimistic default (healthy)
            return { ...task, healthy: true, responseTimeMs: 0 };
          }
          const result = await runProbeWithTimeout(task.probe, this.probeTimeoutMs);
          return { ...task, ...result };
        }),
      );

      // Update health state and detect transitions
      for (let i = 0; i < probeTasks.length; i++) {
        const task = probeTasks[i];
        const result = probeResults[i];
        const probeData =
          result.status === "fulfilled"
            ? result.value
            : { ...task, healthy: false, error: "Probe task rejected", responseTimeMs: 0 };

        const previousState = this.healthState.get(task.key);
        const previousHealthy = previousState?.healthy ?? null; // null means first check

        const newState: CapabilityProviderHealth = {
          capability: task.capability,
          providerId: task.providerId,
          providerName: task.providerName,
          healthy: probeData.healthy,
          lastCheck: now,
          lastHealthy: probeData.healthy ? now : (previousState?.lastHealthy ?? null),
          error: probeData.error,
          responseTimeMs: probeData.responseTimeMs,
          consecutiveFailures: probeData.healthy ? 0 : (previousState?.consecutiveFailures ?? 0) + 1,
        };

        this.healthState.set(task.key, newState);

        // Emit status change event (skip first check)
        if (previousHealthy !== null && previousHealthy !== probeData.healthy) {
          const event = {
            capability: task.capability,
            providerId: task.providerId,
            providerName: task.providerName,
            previousHealthy,
            currentHealthy: probeData.healthy,
            error: probeData.error,
          };
          this.emit("providerStatusChange", event);
        }
      }

      // Emit all event bus notifications in parallel (after all state updates)
      const eventBusEmissions = probeTasks
        .map((task, i) => {
          const result = probeResults[i];
          const probeData =
            result.status === "fulfilled"
              ? result.value
              : { ...task, healthy: false, error: "Probe task rejected", responseTimeMs: 0 };

          const previousState = this.healthState.get(task.key);
          const previousHealthy = previousState?.healthy ?? null;

          if (previousHealthy !== null && previousHealthy !== probeData.healthy) {
            return eventBus
              .emitCustom(
                "capability:providerHealthChange",
                {
                  capability: task.capability,
                  providerId: task.providerId,
                  providerName: task.providerName,
                  previousHealthy,
                  currentHealthy: probeData.healthy,
                  error: probeData.error,
                },
                "core",
              )
              .catch((err) => {
                logger.error(
                  `[capability-health] Event bus emission failed for ${task.key}: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }
          return null;
        })
        .filter((p): p is Promise<void> => p !== null);

      await Promise.all(eventBusEmissions);

      return this.getSnapshot();
    } finally {
      this.checkInFlight = false;
    }
  }

  /** Get current health state without running probes */
  getSnapshot(): CapabilityHealthSnapshot {
    const registry = getCapabilityRegistry();
    const capabilityList = registry.listCapabilities();
    const now = new Date().toISOString();

    const capabilities: CapabilityHealth[] = [];
    let allCapabilitiesHealthy = true;

    for (const { capability } of capabilityList) {
      const providers = registry.getProviders(capability);
      const providerHealths: CapabilityProviderHealth[] = [];

      for (const provider of providers) {
        const key = `${capability}:${provider.id}`;
        const state = this.healthState.get(key);
        if (state) {
          providerHealths.push(state);
        } else {
          // Provider exists but no health state yet (initial state or no probe)
          providerHealths.push({
            capability,
            providerId: provider.id,
            providerName: provider.name,
            healthy: true, // Optimistic default
            lastCheck: now,
            lastHealthy: null,
            consecutiveFailures: 0,
          });
        }
      }

      const healthyCount = providerHealths.filter((p) => p.healthy).length;
      const healthy = healthyCount > 0;

      capabilities.push({
        capability,
        healthy,
        providers: providerHealths,
        healthyCount,
        totalCount: providerHealths.length,
      });

      if (!healthy) {
        allCapabilitiesHealthy = false;
      }
    }

    return {
      timestamp: now,
      capabilities,
      overallHealthy: allCapabilitiesHealthy,
    };
  }

  /** Get health for a specific capability */
  getCapabilityHealth(capability: AdapterCapability): CapabilityHealth | null {
    const snapshot = this.getSnapshot();
    return snapshot.capabilities.find((c) => c.capability === capability) ?? null;
  }

  /** Get health for a specific provider */
  getProviderHealth(capability: AdapterCapability, providerId: string): CapabilityProviderHealth | null {
    const key = `${capability}:${providerId}`;
    return this.healthState.get(key) ?? null;
  }
}

// Singleton
let instance: CapabilityHealthProber | null = null;

export function getCapabilityHealthProber(config?: CapabilityHealthProberConfig): CapabilityHealthProber {
  if (!instance) {
    instance = new CapabilityHealthProber(config);
  }
  return instance;
}

export function resetCapabilityHealthProber(): void {
  if (instance) {
    instance.stop();
  }
  instance = null;
}
