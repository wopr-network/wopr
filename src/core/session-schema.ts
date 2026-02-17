import { z } from "zod";
import type { PluginSchema } from "../storage/api/plugin-storage.js";

// ---------- sessions table ----------
export const sessionSchema = z.object({
  id: z.string(),                       // UUID (primary key)
  name: z.string(),                     // Unique session name
  providerId: z.string().optional(),    // e.g. "anthropic"
  providerConfig: z.string().optional(),// JSON-serialized ProviderConfig
  context: z.string().optional(),       // System prompt / session context
  status: z.string(),                   // "active" | "archived"
  createdAt: z.number(),                // epoch ms
  updatedAt: z.number(),                // epoch ms
  lastActivityAt: z.number(),           // epoch ms
});
export type SessionRecord = z.infer<typeof sessionSchema>;

// ---------- session_messages table ----------
export const sessionMessageSchema = z.object({
  id: z.string(),                       // UUID (primary key)
  sessionId: z.string(),                // FK → sessions.id
  role: z.string(),                     // "user" | "assistant" | "system" | "tool"
  content: z.string(),                  // Message content
  source: z.string().optional(),        // "cli" | "discord" | "p2p" | "api" | etc.
  senderId: z.string().optional(),      // Unique sender ID (e.g., Discord user ID)
  tokens: z.number().optional(),        // Token count (future use)
  model: z.string().optional(),         // Model used (future use)
  sequence: z.number(),                 // Monotonic order within session
  channelId: z.string().optional(),     // Channel identifier
  channelType: z.string().optional(),   // Channel type (discord, p2p, etc.)
  channelName: z.string().optional(),   // Channel name
  entryType: z.string(),                // Maps to ConversationEntryType: "context" | "message" | "response" | "middleware"
  createdAt: z.number(),                // epoch ms (same as ConversationEntry.ts)
});
export type SessionMessageRecord = z.infer<typeof sessionMessageSchema>;

// ---------- PluginSchema ----------
export const sessionsPluginSchema: PluginSchema = {
  namespace: "sessions",
  version: 1,
  tables: {
    sessions: {
      schema: sessionSchema,
      primaryKey: "id",
      indexes: [
        { fields: ["name"], unique: true },
        { fields: ["status"] },
        { fields: ["lastActivityAt"] },
      ],
    },
    session_messages: {
      schema: sessionMessageSchema,
      primaryKey: "id",
      indexes: [
        { fields: ["sessionId", "sequence"] },
        { fields: ["sessionId", "createdAt"] },
        { fields: ["role"] },
        { fields: ["entryType"] },
        { fields: ["createdAt"] },
      ],
    },
  },
};
