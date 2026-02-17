import { logger } from "../logger.js";
import type { Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import type { SkillStateRecord } from "./skills-schema.js";
import { skillsPluginSchema } from "./skills-schema.js";

let initialized = false;

/** Initialize schema — idempotent, call on first access */
export async function initSkillsStorage(): Promise<void> {
  if (initialized) return;
  const storage = getStorage();
  await storage.register(skillsPluginSchema);
  initialized = true;
}

/** Reset for testing */
export function resetSkillsStorageInit(): void {
  initialized = false;
}

// ---------- Helper to get repo (ensures init) ----------
function skillsStateRepo(): Repository<SkillStateRecord> {
  return getStorage().getRepository<SkillStateRecord>("skills", "skills_state");
}

// ---------- Skills State CRUD ----------

/** Get skill state by name */
export async function getSkillState(name: string): Promise<SkillStateRecord | null> {
  await initSkillsStorage();
  const repo = skillsStateRepo();
  const existing = await repo.findFirst({ id: name } as any);
  return existing ?? null;
}

/** Get all skill states */
export async function getAllSkillStates(): Promise<Record<string, { enabled: boolean }>> {
  await initSkillsStorage();
  const repo = skillsStateRepo();
  const rows = await repo.findMany({});
  const state: Record<string, { enabled: boolean }> = {};
  for (const row of rows) {
    state[row.id] = { enabled: row.enabled };
  }
  return state;
}

/** Check if a skill is enabled (async version) */
export async function isSkillEnabledAsync(name: string): Promise<boolean> {
  await initSkillsStorage();
  const repo = skillsStateRepo();
  const existing = await repo.findFirst({ id: name } as any);
  // Skills are enabled by default if not explicitly disabled
  return existing?.enabled !== false;
}

/** Get all skill states (async version) */
export async function readAllSkillStatesAsync(): Promise<Record<string, { enabled: boolean }>> {
  return getAllSkillStates();
}

/** Enable a skill - validates skill exists first */
export async function enableSkillAsync(name: string): Promise<boolean> {
  // Check if skill exists by discovering
  const { discoverSkills } = await import("./skills.js");
  const { skills } = discoverSkills();
  const skill = skills.find((s) => s.name === name);
  if (!skill) return false;

  await initSkillsStorage();
  const repo = skillsStateRepo();
  const existing = await repo.findFirst({ id: name } as any);
  const now = new Date().toISOString();

  if (existing) {
    // Update existing
    await repo.update(existing.id, { enabled: true, enabledAt: now });
  } else {
    // Create new
    await repo.insert({
      id: name,
      enabled: true,
      installed: true,
      enabledAt: now,
      useCount: 0,
    });
  }
  return true;
}

/** Disable a skill - validates skill exists first */
export async function disableSkillAsync(name: string): Promise<boolean> {
  // Check if skill exists by discovering
  const { discoverSkills } = await import("./skills.js");
  const { skills } = discoverSkills();
  const skill = skills.find((s) => s.name === name);
  if (!skill) return false;

  await initSkillsStorage();
  const repo = skillsStateRepo();
  const existing = await repo.findFirst({ id: name } as any);

  if (existing) {
    // Update existing
    await repo.update(existing.id, { enabled: false, enabledAt: undefined });
  } else {
    // Create new entry as disabled
    await repo.insert({
      id: name,
      enabled: false,
      installed: true,
      useCount: 0,
    });
  }
  return true;
}

/** Record skill usage */
export async function recordSkillUsage(name: string): Promise<void> {
  await initSkillsStorage();
  const repo = skillsStateRepo();
  const existing = await repo.findFirst({ id: name } as any);
  const now = new Date().toISOString();

  if (existing) {
    await repo.update(existing.id, {
      lastUsedAt: now,
      useCount: (existing.useCount ?? 0) + 1,
    });
  } else {
    // Auto-create on first use
    await repo.insert({
      id: name,
      enabled: true,
      installed: true,
      enabledAt: now,
      lastUsedAt: now,
      useCount: 1,
    });
  }
  logger.debug(`[skills-repository] Recorded usage for skill "${name}"`);
}

/** Remove skill state (for cleanup when skill is uninstalled) */
export async function removeSkillState(name: string): Promise<void> {
  await initSkillsStorage();
  const repo = skillsStateRepo();
  const existing = await repo.findFirst({ id: name } as any);
  if (existing) {
    await repo.delete(existing.id);
    logger.debug(`[skills-repository] Removed state for skill "${name}"`);
  }
}
