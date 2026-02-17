import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import { WOPR_HOME } from "../paths.js";
import type { Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import { initSkillsStorage } from "./skills-repository.js";
import type { SkillStateRecord } from "./skills-schema.js";

const SKILLS_STATE_FILE = join(WOPR_HOME, "skills-state.json");

/** Main migration entry point — idempotent */
export async function migrateSkillsToSQL(): Promise<void> {
  // Check if skills-state.json exists — if not, nothing to migrate
  if (!existsSync(SKILLS_STATE_FILE)) {
    logger.info("[migration] No skills-state.json found, skipping migration");
    return;
  }

  logger.info("[migration] Starting skills state migration from JSON to SQL");

  // Ensure storage is initialized
  await initSkillsStorage();
  const storage = getStorage();
  const skillsRepo = storage.getRepository<SkillStateRecord>("skills", "skills_state");

  // Read skills-state.json
  let skillsState: Record<string, { enabled: boolean }>;
  try {
    const raw = readFileSync(SKILLS_STATE_FILE, "utf-8");
    skillsState = JSON.parse(raw) as Record<string, { enabled: boolean }>;
  } catch (error) {
    logger.error("[migration] Failed to parse skills-state.json:", error);
    return;
  }

  // Migrate each skill state entry
  let migratedCount = 0;
  for (const [skillName, state] of Object.entries(skillsState)) {
    try {
      await migrateSkillState(skillName, state, skillsRepo);
      migratedCount++;
    } catch (error) {
      logger.error(`[migration] Failed to migrate skill state "${skillName}":`, error);
    }
  }

  logger.info(`[migration] Migrated ${migratedCount} skill states to SQL`);

  // Backup old file
  backupFile(SKILLS_STATE_FILE);

  logger.info("[migration] Backup of skills-state.json complete");
}

async function migrateSkillState(
  skillName: string,
  state: { enabled: boolean },
  skillsRepo: Repository<SkillStateRecord>,
): Promise<void> {
  logger.debug(`[migration] Migrating skill state "${skillName}" (enabled: ${state.enabled})`);

  // Insert skill state record
  const now = new Date().toISOString();
  await skillsRepo.insert({
    id: skillName,
    enabled: state.enabled,
    installed: true,
    enabledAt: state.enabled ? now : undefined,
    useCount: 0,
  });
}

function backupFile(filePath: string): void {
  if (existsSync(filePath)) {
    renameSync(filePath, `${filePath}.backup`);
    logger.debug(`[migration] Backed up ${filePath}`);
  }
}
