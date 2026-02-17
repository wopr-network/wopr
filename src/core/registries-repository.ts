import type { Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import { logger } from "../logger.js";
import type { RegistryRecord } from "./registries-schema.js";
import { registriesPluginSchema } from "./registries-schema.js";

let initPromise: Promise<void> | null = null;

export async function initRegistriesStorage(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const storage = getStorage();
      await storage.register(registriesPluginSchema);
    })();
  }
  return initPromise;
}

export function resetRegistriesStorageInit(): void {
  initPromise = null;
}

function registriesRepo(): Repository<RegistryRecord> {
  return getStorage().getRepository<RegistryRecord>("registries", "registries");
}

export async function getRegistriesFromSQL(): Promise<Array<{ name: string; url: string }>> {
  await initRegistriesStorage();
  try {
    const rows = await registriesRepo().findMany({});
    return rows.map((r) => ({ name: r.name, url: r.url }));
  } catch (err) {
    logger.error(`[registries-repository] Failed to get registries: ${err}`);
    throw err;
  }
}

export async function addRegistrySQL(name: string, url: string): Promise<void> {
  await initRegistriesStorage();
  try {
    const repo = registriesRepo();
    const now = Date.now();
    const existing = await repo.findFirst({ id: name });
    if (existing) {
      await repo.update(name, { url, updatedAt: now });
    } else {
      await repo.insert({ id: name, name, url, createdAt: now, updatedAt: now });
    }
  } catch (err) {
    logger.error(`[registries-repository] Failed to add registry "${name}": ${err}`);
    throw err;
  }
}

export async function removeRegistrySQL(name: string): Promise<boolean> {
  await initRegistriesStorage();
  try {
    const repo = registriesRepo();
    const existing = await repo.findFirst({ id: name });
    if (!existing) return false;
    await repo.delete(name);
    return true;
  } catch (err) {
    logger.error(`[registries-repository] Failed to remove registry "${name}": ${err}`);
    throw err;
  }
}
