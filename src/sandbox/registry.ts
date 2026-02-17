/**
 * Sandbox Container Registry
 * Tracks container state persistently across restarts.
 * Now backed by SQL via Storage API.
 */

import {
  findRegistryEntrySQL,
  listRegistryEntriesSQL,
  removeRegistryEntrySQL,
  updateRegistrySQL,
} from "./sandbox-repository.js";

// Re-export type from schema for backward compatibility
export type { SandboxRegistryRecord as SandboxRegistryEntry } from "./sandbox-schema.js";

/**
 * Update or insert a sandbox registry entry (async)
 */
export async function updateRegistry(entry: {
  containerName: string;
  sessionKey: string;
  createdAtMs: number;
  lastUsedAtMs: number;
  image: string;
  configHash?: string;
}): Promise<void> {
  await updateRegistrySQL(entry);
}

/**
 * Remove a sandbox registry entry by container name (async)
 */
export async function removeRegistryEntry(containerName: string): Promise<void> {
  await removeRegistryEntrySQL(containerName);
}

/**
 * Find a sandbox registry entry by container name (async)
 */
export async function findRegistryEntry(containerName: string): Promise<
  | {
      containerName: string;
      sessionKey: string;
      createdAtMs: number;
      lastUsedAtMs: number;
      image: string;
      configHash?: string;
    }
  | undefined
> {
  return findRegistryEntrySQL(containerName);
}

/**
 * List all sandbox registry entries (async)
 */
export async function listRegistryEntries(): Promise<
  Array<{
    containerName: string;
    sessionKey: string;
    createdAtMs: number;
    lastUsedAtMs: number;
    image: string;
    configHash?: string;
  }>
> {
  return listRegistryEntriesSQL();
}
