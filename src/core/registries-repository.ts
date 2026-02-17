import type { Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import type { RegistryRecord } from "./registries-schema.js";
import { registriesPluginSchema } from "./registries-schema.js";

let initialized = false;

export async function initRegistriesStorage(): Promise<void> {
  if (initialized) return;
  const storage = getStorage();
  await storage.register(registriesPluginSchema);
  initialized = true;
}

export function resetRegistriesStorageInit(): void {
  initialized = false;
}

function registriesRepo(): Repository<RegistryRecord> {
  return getStorage().getRepository<RegistryRecord>("registries", "registries");
}

export async function getRegistriesFromSQL(): Promise<Array<{ name: string; url: string }>> {
  await initRegistriesStorage();
  const rows = await registriesRepo().findMany({});
  return rows.map((r) => ({ name: r.name, url: r.url }));
}

export async function addRegistrySQL(name: string, url: string): Promise<void> {
  await initRegistriesStorage();
  const repo = registriesRepo();
  const now = Date.now();
  const existing = await repo.findFirst({ id: name } as never);
  if (existing) {
    await repo.update(name, { url, updatedAt: now });
  } else {
    await repo.insert({ id: name, name, url, createdAt: now, updatedAt: now });
  }
}

export async function removeRegistrySQL(name: string): Promise<boolean> {
  await initRegistriesStorage();
  const repo = registriesRepo();
  const existing = await repo.findFirst({ id: name } as never);
  if (!existing) return false;
  await repo.delete(name);
  return true;
}
