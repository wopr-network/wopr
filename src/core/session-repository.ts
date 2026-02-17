import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";
import type { Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import type { ProviderConfig } from "../types/provider.js";
import type { ConversationEntry } from "../types.js";
import { type SessionMessageRecord, type SessionRecord, sessionsPluginSchema } from "./session-schema.js";

let initialized = false;

/** Initialize schema — idempotent, call on first access */
export async function initSessionStorage(): Promise<void> {
  if (initialized) return;
  const storage = getStorage();
  await storage.register(sessionsPluginSchema);
  initialized = true;
}

/** Reset for testing */
export function resetSessionStorageInit(): void {
  initialized = false;
}

// ---------- Helper to get repos (ensures init) ----------
function sessionsRepo(): Repository<SessionRecord> {
  return getStorage().getRepository<SessionRecord>("sessions", "sessions");
}

function messagesRepo(): Repository<SessionMessageRecord> {
  return getStorage().getRepository<SessionMessageRecord>("sessions", "session_messages");
}

// ---------- Sessions CRUD ----------

/** Get all sessions as name→id map (backwards compat with getSessions()) */
export async function getSessionsAsync(): Promise<Record<string, string>> {
  await initSessionStorage();
  const rows = await sessionsRepo().findMany({ status: "active" });
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.name] = row.id;
  }
  return map;
}

/** Save/create session id mapping */
export async function saveSessionIdAsync(name: string, id: string): Promise<void> {
  await initSessionStorage();
  const repo = sessionsRepo();
  const existing = await repo.findFirst({ name } as any);
  const now = Date.now();
  if (existing) {
    // Update existing — preserve createdAt
    await repo.update(existing.id, { id, updatedAt: now, lastActivityAt: now });
  } else {
    // Create new
    await repo.insert({
      id,
      name,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
  }
}

/** Delete session id mapping */
export async function deleteSessionIdAsync(name: string): Promise<void> {
  await initSessionStorage();
  const repo = sessionsRepo();
  const existing = await repo.findFirst({ name } as any);
  if (existing) {
    await repo.delete(existing.id);
  }
}

/** Get session creation timestamp */
export async function getSessionCreatedAsync(name: string): Promise<number> {
  await initSessionStorage();
  const repo = sessionsRepo();
  const existing = await repo.findFirst({ name } as any);
  return existing?.createdAt ?? 0;
}

/** Get session context (system prompt) */
export async function getSessionContextAsync(name: string): Promise<string | undefined> {
  await initSessionStorage();
  const repo = sessionsRepo();
  const existing = await repo.findFirst({ name } as any);
  return existing?.context ?? undefined;
}

/** Set session context */
export async function setSessionContextAsync(name: string, context: string): Promise<void> {
  await initSessionStorage();
  const repo = sessionsRepo();
  const existing = await repo.findFirst({ name } as any);
  const now = Date.now();
  if (existing) {
    await repo.update(existing.id, { context, updatedAt: now });
  } else {
    // Create session if it doesn't exist yet (matches current behavior where setSessionContext creates the .md file)
    await repo.insert({
      id: randomUUID(),
      name,
      context,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
  }
}

/** Get session provider config */
export async function getSessionProviderAsync(name: string): Promise<ProviderConfig | undefined> {
  await initSessionStorage();
  const repo = sessionsRepo();
  const existing = await repo.findFirst({ name } as any);
  if (!existing?.providerConfig) return undefined;
  try {
    return JSON.parse(existing.providerConfig) as ProviderConfig;
  } catch {
    return undefined;
  }
}

/** Set session provider config */
export async function setSessionProviderAsync(name: string, provider: ProviderConfig): Promise<void> {
  await initSessionStorage();
  const repo = sessionsRepo();
  const existing = await repo.findFirst({ name } as any);
  const now = Date.now();
  const providerConfig = JSON.stringify(provider);
  const providerId = provider.name;
  if (existing) {
    await repo.update(existing.id, { providerId, providerConfig, updatedAt: now });
  } else {
    await repo.insert({
      id: randomUUID(),
      name,
      providerId,
      providerConfig,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
  }
}

/** List all sessions with metadata */
export async function listSessionsAsync(): Promise<
  Array<{
    name: string;
    id: string;
    context?: string;
    created: number;
  }>
> {
  await initSessionStorage();
  const rows = await sessionsRepo().findMany({ status: "active" });
  return rows.map((r) => ({
    name: r.name,
    id: r.id,
    context: r.context ?? undefined,
    created: r.createdAt,
  }));
}

// ---------- Conversation Messages ----------

/** Get next sequence number for a session */
async function getNextSequence(sessionId: string): Promise<number> {
  const repo = messagesRepo();
  const rows = await repo.raw(`SELECT MAX(sequence) as maxSeq FROM sessions_session_messages WHERE "sessionId" = ?`, [
    sessionId,
  ]);
  const row = rows[0] as { maxSeq: number | null } | undefined;
  return (row?.maxSeq ?? -1) + 1;
}

/** Append a conversation entry (replaces appendToConversationLog) */
export async function appendMessageAsync(sessionName: string, entry: ConversationEntry): Promise<void> {
  await initSessionStorage();
  // Look up session id from name
  const repo = sessionsRepo();
  const session = await repo.findFirst({ name: sessionName } as any);
  if (!session) {
    logger.warn(`[session-repo] appendMessage: session "${sessionName}" not found, creating`);
    // Auto-create session record if not exists (matches current file-append behavior)
    const now = Date.now();
    const newId = randomUUID();
    await repo.insert({
      id: newId,
      name: sessionName,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
    return appendMessageToSession(newId, entry);
  }
  // Update lastActivityAt
  await repo.update(session.id, { lastActivityAt: Date.now() });
  return appendMessageToSession(session.id, entry);
}

async function appendMessageToSession(sessionId: string, entry: ConversationEntry): Promise<void> {
  const msgRepo = messagesRepo();
  const seq = await getNextSequence(sessionId);

  // Map ConversationEntry fields to SessionMessageRecord
  // Map from→role: "WOPR" or "system" → "assistant"/"system", anything else → "user"
  let role: string;
  if (entry.from === "WOPR") {
    role = "assistant";
  } else if (entry.from === "system") {
    role = "system";
  } else {
    role = "user";
  }

  await msgRepo.insert({
    id: randomUUID(),
    sessionId,
    role,
    content: entry.content,
    source: entry.from, // Preserve original "from" value as source
    senderId: entry.senderId,
    sequence: seq,
    channelId: entry.channel?.id,
    channelType: entry.channel?.type,
    channelName: entry.channel?.name,
    entryType: entry.type, // "context" | "message" | "response" | "middleware"
    createdAt: entry.ts,
  });
}

/** Read conversation log (replaces readConversationLog) */
export async function readConversationLogAsync(sessionName: string, limit?: number): Promise<ConversationEntry[]> {
  await initSessionStorage();
  const repo = sessionsRepo();
  const session = await repo.findFirst({ name: sessionName } as any);
  if (!session) return [];

  const msgRepo = messagesRepo();
  let rows: SessionMessageRecord[];

  if (limit && limit > 0) {
    // Get last N messages by sequence descending, then reverse
    rows = await msgRepo.query().where("sessionId", session.id).orderBy("sequence", "desc").limit(limit).execute();
    rows.reverse();
  } else {
    rows = await msgRepo.query().where("sessionId", session.id).orderBy("sequence", "asc").execute();
  }

  // Map back to ConversationEntry format for backwards compat
  return rows.map((r) => ({
    ts: r.createdAt,
    from: r.source || r.role,
    senderId: r.senderId,
    content: r.content,
    type: r.entryType as ConversationEntry["type"],
    channel: r.channelId ? { id: r.channelId, type: r.channelType || "", name: r.channelName } : undefined,
  }));
}

/** Get conversation log path — returns the session id for migration compatibility */
export async function getConversationSessionId(sessionName: string): Promise<string | null> {
  await initSessionStorage();
  const repo = sessionsRepo();
  const session = await repo.findFirst({ name: sessionName } as any);
  return session?.id ?? null;
}
