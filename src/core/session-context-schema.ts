/**
 * Session Context Schema (WOP-556)
 *
 * Defines the storage schema for session context files
 * (SOUL.md, IDENTITY.md, MEMORY.md, AGENTS.md, USER.md,
 * HEARTBEAT.md, BOOTSTRAP.md, memory/YYYY-MM-DD.md, etc.)
 *
 * These were previously stored as flat files under:
 *   $WOPR_HOME/sessions/{name}/
 *   $WOPR_HOME/identity/
 *
 * Now stored in SQL with composite key "{session}:{filename}".
 */

import { z } from "zod";
import type { PluginSchema } from "../storage/api/plugin-storage.js";

// ---------- session_context table ----------
export const sessionContextSchema = z.object({
  /** Composite primary key: "{sessionName}:{filename}" e.g. "mybot:SOUL.md" */
  id: z.string(),
  /** Session name (e.g. "mybot") or "__global__" for global identity files */
  sessionName: z.string(),
  /** Relative filename: "SOUL.md", "IDENTITY.md", "memory/2024-01-15.md", etc. */
  filename: z.string(),
  /** Markdown content of the file */
  content: z.string(),
  /** Whether this is a global or session-specific file */
  source: z.enum(["global", "session"]),
  /** Creation timestamp (epoch ms) */
  createdAt: z.number(),
  /** Last update timestamp (epoch ms) */
  updatedAt: z.number(),
});

export type SessionContextRecord = z.infer<typeof sessionContextSchema>;

// ---------- PluginSchema ----------
export const sessionContextPluginSchema: PluginSchema = {
  namespace: "session_context",
  version: 1,
  tables: {
    session_context: {
      schema: sessionContextSchema,
      primaryKey: "id",
      indexes: [
        { fields: ["sessionName"] },
        { fields: ["sessionName", "filename"], unique: true },
        { fields: ["source"] },
        { fields: ["updatedAt"] },
      ],
    },
  },
};
