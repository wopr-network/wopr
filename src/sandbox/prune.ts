/**
 * Sandbox Container Pruning
 * Automatic cleanup of idle and old containers.
 * Copied from OpenClaw with WOPR adaptations.
 */

import { logger } from "../logger.js";
import { dockerContainerState, execDocker } from "./docker.js";
import { listRegistryEntries, removeRegistryEntry } from "./registry.js";
import type { SandboxConfig } from "./types.js";

let lastPruneAtMs = 0;

async function pruneSandboxContainers(cfg: SandboxConfig): Promise<void> {
  const now = Date.now();
  const idleHours = cfg.prune.idleHours;
  const maxAgeDays = cfg.prune.maxAgeDays;

  if (idleHours === 0 && maxAgeDays === 0) {
    return;
  }

  const entries = await listRegistryEntries();
  for (const entry of entries) {
    const idleMs = now - entry.lastUsedAtMs;
    const ageMs = now - entry.createdAtMs;

    if (
      (idleHours > 0 && idleMs > idleHours * 60 * 60 * 1000) ||
      (maxAgeDays > 0 && ageMs > maxAgeDays * 24 * 60 * 60 * 1000)
    ) {
      logger.info(`[sandbox] Pruning idle container: ${entry.containerName}`);
      try {
        await execDocker(["rm", "-f", entry.containerName], {
          allowFailure: true,
        });
      } catch {
        // ignore prune failures
      } finally {
        await removeRegistryEntry(entry.containerName);
      }
    }
  }
}

export async function maybePruneSandboxes(cfg: SandboxConfig): Promise<void> {
  const now = Date.now();
  // Only prune once every 5 minutes
  if (now - lastPruneAtMs < 5 * 60 * 1000) {
    return;
  }
  lastPruneAtMs = now;

  try {
    await pruneSandboxContainers(cfg);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[sandbox] Prune failed: ${message}`);
  }
}

export async function ensureDockerContainerIsRunning(containerName: string): Promise<void> {
  const state = await dockerContainerState(containerName);
  if (state.exists && !state.running) {
    await execDocker(["start", containerName]);
  }
}

export async function pruneAllSandboxes(): Promise<number> {
  const entries = await listRegistryEntries();
  let pruned = 0;

  for (const entry of entries) {
    try {
      await execDocker(["rm", "-f", entry.containerName], { allowFailure: true });
      await removeRegistryEntry(entry.containerName);
      pruned++;
    } catch {
      // ignore
    }
  }

  return pruned;
}
