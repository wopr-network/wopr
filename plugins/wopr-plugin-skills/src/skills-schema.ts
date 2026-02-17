import { z } from "zod";
import type { PluginSchema } from "../../../src/storage/api/plugin-storage.js";

// ---------- skills_state table ----------
export const skillStateSchema = z.object({
  id: z.string(), // Skill name (primary key)
  enabled: z.boolean(), // Whether skill is enabled
  installed: z.boolean(), // Whether skill is installed
  enabledAt: z.string().optional(), // ISO timestamp when enabled
  lastUsedAt: z.string().optional(), // ISO timestamp of last use
  useCount: z.number(), // Number of times skill has been used
});
export type SkillStateRecord = z.infer<typeof skillStateSchema>;

// ---------- PluginSchema ----------
export const skillsPluginSchema: PluginSchema = {
  namespace: "skills",
  version: 1,
  tables: {
    skills_state: {
      schema: skillStateSchema,
      primaryKey: "id",
      indexes: [{ fields: ["enabled"] }, { fields: ["lastUsedAt"] }],
    },
  },
};
