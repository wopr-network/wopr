/**
 * Pairing storage schema - SQLite tables for identities and pairing codes
 */
import { z } from "zod";
import type { PluginSchema } from "../storage/api/plugin-storage.js";

// Trust level enum (matches security/types.ts)
const trustLevelEnum = z.enum(["owner", "trusted", "semi-trusted", "untrusted"]);

// ---------- pairing_identities table ----------
export const pairingIdentitySchema = z.object({
  id: z.string(), // UUID (primary key)
  name: z.string(), // Human-readable name (UNIQUE)
  trustLevel: trustLevelEnum, // Trust level for this identity
  links: z.string(), // JSON-serialized PlatformLink[] array
  createdAt: z.number(), // epoch ms
  updatedAt: z.number(), // epoch ms
});
export type PairingIdentityRecord = z.infer<typeof pairingIdentitySchema>;

// ---------- pairing_codes table ----------
export const pairingCodeSchema = z.object({
  code: z.string(), // The short code (e.g., "A1B2C3") - primary key
  identityId: z.string(), // FK → pairing_identities.id
  trustLevel: trustLevelEnum, // Trust level to assign on successful pairing
  createdAt: z.number(), // epoch ms
  expiresAt: z.number(), // epoch ms
});
export type PairingCodeRecord = z.infer<typeof pairingCodeSchema>;

// ---------- PluginSchema ----------
export const pairingPluginSchema: PluginSchema = {
  namespace: "pairing",
  version: 1,
  tables: {
    identities: {
      schema: pairingIdentitySchema,
      primaryKey: "id",
      indexes: [{ fields: ["name"], unique: true }, { fields: ["trustLevel"] }, { fields: ["createdAt"] }],
    },
    codes: {
      schema: pairingCodeSchema,
      primaryKey: "code",
      indexes: [{ fields: ["identityId"] }, { fields: ["expiresAt"] }],
    },
  },
};
