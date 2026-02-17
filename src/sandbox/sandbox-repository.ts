/**
 * Sandbox repository - SQL-backed container registry operations
 */

import type { Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import type { SandboxRegistryRecord } from "./sandbox-schema.js";
import { sandboxPluginSchema } from "./sandbox-schema.js";

let initialized = false;

/** Initialize schema — idempotent, call on first access */
export async function initSandboxStorage(): Promise<void> {
  if (initialized) return;
  const storage = getStorage();
  await storage.register(sandboxPluginSchema);
  initialized = true;
}

/** Reset for testing */
export function resetSandboxStorageInit(): void {
  initialized = false;
}

// ---------- Helper to get repo (ensures init) ----------
function sandboxRepo(): Repository<SandboxRegistryRecord> {
  return getStorage().getRepository<SandboxRegistryRecord>("sandbox", "sandbox_registry");
}

// ---------- Sandbox Registry CRUD ----------

/**
 * Update or insert a sandbox registry entry
 * Preserves createdAtMs, image, and configHash from existing entry if present
 */
export async function updateRegistrySQL(entry: {
  containerName: string;
  sessionKey: string;
  createdAtMs: number;
  lastUsedAtMs: number;
  image: string;
  configHash?: string;
}): Promise<void> {
  await initSandboxStorage();
  const repo = sandboxRepo();
  const existing = await repo.findFirst({ id: entry.containerName } as any);

  const record: SandboxRegistryRecord = {
    id: entry.containerName,
    containerName: entry.containerName,
    sessionKey: entry.sessionKey,
    createdAtMs: existing?.createdAtMs ?? entry.createdAtMs,
    lastUsedAtMs: entry.lastUsedAtMs,
    image: existing?.image ?? entry.image,
    configHash: entry.configHash ?? existing?.configHash,
  };

  if (existing) {
    await repo.update(entry.containerName, record);
  } else {
    await repo.insert(record);
  }
}

/**
 * Remove a sandbox registry entry by container name
 */
export async function removeRegistryEntrySQL(containerName: string): Promise<void> {
  await initSandboxStorage();
  const repo = sandboxRepo();
  const existing = await repo.findFirst({ id: containerName } as any);
  if (existing) {
    await repo.delete(containerName);
  }
}

/**
 * Find a sandbox registry entry by container name
 */
export async function findRegistryEntrySQL(containerName: string): Promise<SandboxRegistryRecord | undefined> {
  await initSandboxStorage();
  const repo = sandboxRepo();
  const entry = await repo.findFirst({ id: containerName } as any);
  return entry ?? undefined;
}

/**
 * List all sandbox registry entries
 */
export async function listRegistryEntriesSQL(): Promise<SandboxRegistryRecord[]> {
  await initSandboxStorage();
  const repo = sandboxRepo();
  return repo.findMany({});
}
