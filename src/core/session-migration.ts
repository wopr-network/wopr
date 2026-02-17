import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { logger } from "../logger.js";
import { SESSIONS_DIR, SESSIONS_FILE } from "../paths.js";
import type { Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import type { ConversationEntry } from "../types.js";
import { initSessionStorage } from "./session-repository.js";
import type { SessionMessageRecord, SessionRecord } from "./session-schema.js";

/** Main migration entry point — idempotent */
export async function migrateSessionsToSQL(): Promise<void> {
  // Check if sessions.json exists — if not, nothing to migrate
  if (!existsSync(SESSIONS_FILE)) {
    logger.info("[migration] No sessions.json found, skipping migration");
    return;
  }

  logger.info("[migration] Starting sessions migration from files to SQL");

  // Ensure storage is initialized
  await initSessionStorage();
  const storage = getStorage();
  const sessionsRepo = storage.getRepository<SessionRecord>("sessions", "sessions");
  const messagesRepo = storage.getRepository<SessionMessageRecord>("sessions", "session_messages");

  // Read sessions.json to get name→id map
  let sessionsMap: Record<string, string>;
  try {
    const raw = readFileSync(SESSIONS_FILE, "utf-8");
    sessionsMap = JSON.parse(raw) as Record<string, string>;
  } catch (error) {
    logger.error("[migration] Failed to parse sessions.json:", error);
    return;
  }

  // Migrate each session
  let migratedCount = 0;
  for (const [name, id] of Object.entries(sessionsMap)) {
    try {
      await migrateSession(name, id, sessionsRepo, messagesRepo);
      migratedCount++;
    } catch (error) {
      logger.error(`[migration] Failed to migrate session "${name}":`, error);
    }
  }

  logger.info(`[migration] Migrated ${migratedCount} sessions to SQL`);

  // Backup old files
  backupFile(SESSIONS_FILE);

  // Backup individual session files
  if (existsSync(SESSIONS_DIR)) {
    const files = readdirSync(SESSIONS_DIR);
    for (const file of files) {
      const filePath = join(SESSIONS_DIR, file);
      if (file.endsWith(".created") || file.endsWith(".provider.json") || file.endsWith(".conversation.jsonl")) {
        backupFile(filePath);
      }
      // Do NOT touch .md files — those stay as-is
    }
  }

  logger.info("[migration] Backup of old files complete");
}

async function migrateSession(
  name: string,
  id: string,
  sessionsRepo: Repository<SessionRecord>,
  messagesRepo: Repository<SessionMessageRecord>,
): Promise<void> {
  logger.debug(`[migration] Migrating session "${name}" (${id})`);

  // Read .created file for timestamp
  const createdPath = join(SESSIONS_DIR, `${name}.created`);
  let createdAt = Date.now();
  if (existsSync(createdPath)) {
    try {
      const raw = readFileSync(createdPath, "utf-8").trim();
      createdAt = parseInt(raw, 10);
      if (Number.isNaN(createdAt)) createdAt = Date.now();
    } catch {
      // Fall back to now
    }
  }

  // Read .provider.json for provider config
  const providerPath = join(SESSIONS_DIR, `${name}.provider.json`);
  let providerId: string | undefined;
  let providerConfig: string | undefined;
  if (existsSync(providerPath)) {
    try {
      const raw = readFileSync(providerPath, "utf-8");
      const parsed = JSON.parse(raw);
      providerId = parsed.name;
      providerConfig = raw; // Store as JSON string
    } catch {
      // No provider config
    }
  }

  // Read .md file for context (if exists)
  const mdPath = join(SESSIONS_DIR, `${name}.md`);
  let context: string | undefined;
  if (existsSync(mdPath)) {
    try {
      context = readFileSync(mdPath, "utf-8");
    } catch {
      // No context
    }
  }

  // Insert session record
  await sessionsRepo.insert({
    id,
    name,
    providerId,
    providerConfig,
    context,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    lastActivityAt: createdAt,
  });

  // Stream .conversation.jsonl to session_messages
  const conversationPath = join(SESSIONS_DIR, `${name}.conversation.jsonl`);
  if (existsSync(conversationPath)) {
    const messageCount = await streamJsonlToMessages(id, conversationPath, messagesRepo);
    logger.debug(`[migration] Migrated ${messageCount} messages for session "${name}"`);
  }
}

async function streamJsonlToMessages(
  sessionId: string,
  jsonlPath: string,
  msgRepo: Repository<SessionMessageRecord>,
): Promise<number> {
  const rl = createInterface({
    input: createReadStream(jsonlPath, "utf-8"),
    crlfDelay: Infinity,
  });

  let sequence = 0;
  let batch: SessionMessageRecord[] = [];
  const BATCH_SIZE = 100;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry: ConversationEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // Skip malformed lines
    }

    // Map ConversationEntry → SessionMessageRecord
    let role = "user";
    if (entry.from === "WOPR") role = "assistant";
    else if (entry.from === "system") role = "system";

    batch.push({
      id: randomUUID(),
      sessionId,
      role,
      content: entry.content || "",
      source: entry.from || "unknown",
      senderId: entry.senderId,
      sequence: sequence++,
      channelId: entry.channel?.id,
      channelType: entry.channel?.type,
      channelName: entry.channel?.name,
      entryType: entry.type || "message",
      createdAt: entry.ts || Date.now(),
    });

    if (batch.length >= BATCH_SIZE) {
      await msgRepo.insertMany(batch);
      batch = [];
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    await msgRepo.insertMany(batch);
  }

  return sequence;
}

function backupFile(filePath: string): void {
  if (existsSync(filePath)) {
    renameSync(filePath, `${filePath}.backup`);
    logger.debug(`[migration] Backed up ${filePath}`);
  }
}
