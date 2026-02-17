/**
 * Auth storage schema - SQL-based credential and API key storage
 */

import { z } from "zod";
import type { PluginSchema } from "../storage/api/plugin-storage.js";

/**
 * Table: auth_credentials
 * Stores encrypted provider credentials (replaces auth.json)
 */
export const authCredentialSchema = z.object({
  id: z.string(), // Primary key - provider name or unique ID
  provider: z.string(), // Provider name (e.g., "anthropic", "openai")
  encryptedValue: z.string(), // Encrypted credential data
  encryptionMethod: z.string().optional(), // "aes-256-gcm" or undefined for plaintext
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type AuthCredentialRecord = z.infer<typeof authCredentialSchema>;

/**
 * Table: auth_api_keys
 * Stores daemon API keys (replaces auth.sqlite)
 */
export const authApiKeySchema = z.object({
  id: z.string(), // Primary key - UUID
  userId: z.string().optional(), // Optional user ID for multi-user setups
  name: z.string(), // Human-readable name for the key
  keyHash: z.string(), // Scrypt hash of the raw key
  keyPrefix: z.string(), // First 12 chars for identification
  scope: z.string().optional(), // "full", "read-only", or custom scope
  lastUsedAt: z.number().optional(), // Last usage timestamp
  createdAt: z.number(),
  expiresAt: z.number().optional(), // Optional expiration timestamp
});

export type AuthApiKeyRecord = z.infer<typeof authApiKeySchema>;

/**
 * Plugin schema definition for auth storage
 * Namespace: "auth" → tables: auth_credentials, auth_api_keys
 */
export const authPluginSchema: PluginSchema = {
  namespace: "auth",
  version: 1,
  tables: {
    auth_credentials: {
      schema: authCredentialSchema,
      primaryKey: "id",
      indexes: [{ fields: ["provider"] }, { fields: ["updatedAt"] }],
    },
    auth_api_keys: {
      schema: authApiKeySchema,
      primaryKey: "id",
      indexes: [
        { fields: ["keyPrefix"] },
        { fields: ["userId"] },
        { fields: ["createdAt"] },
        { fields: ["expiresAt"] },
      ],
    },
  },
};
