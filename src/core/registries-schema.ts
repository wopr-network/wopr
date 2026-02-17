import { z } from "zod";
import type { PluginSchema } from "../storage/api/plugin-storage.js";

export const registryRecordSchema = z.object({
  id: z.string(), // registry name as primary key
  name: z.string(),
  url: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type RegistryRecord = z.infer<typeof registryRecordSchema>;

export const registriesPluginSchema: PluginSchema = {
  namespace: "registries",
  version: 1,
  tables: {
    registries: {
      schema: registryRecordSchema,
      primaryKey: "id",
      indexes: [{ fields: ["name"] }],
    },
  },
};
