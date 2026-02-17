/**
 * Browser profile storage schema
 *
 * Defines the SQL schema for browser profiles, cookies, and localStorage.
 */

import { z } from "zod";
import type { PluginSchema } from "../storage/public.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * Browser profile metadata
 */
export const BrowserProfileSchema = z.object({
  id: z.string(), // Primary key
  name: z.string(), // Unique profile name
  userAgent: z.string().optional(),
  viewport: z.string().optional(), // JSON string: {width, height}
  createdAt: z.number(), // Unix timestamp (ms)
  updatedAt: z.number(), // Unix timestamp (ms)
});

export type BrowserProfileRow = z.infer<typeof BrowserProfileSchema>;

/**
 * Browser cookie
 */
export const BrowserCookieSchema = z.object({
  id: z.string(), // Primary key
  profileId: z.string(), // Foreign key to browser_profiles.id
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  expiresAt: z.number().optional(), // Unix timestamp (ms)
  httpOnly: z.number(), // 0 or 1 (SQLite boolean)
  secure: z.number(), // 0 or 1 (SQLite boolean)
  sameSite: z.string().optional(), // "Strict" | "Lax" | "None"
});

export type BrowserCookieRow = z.infer<typeof BrowserCookieSchema>;

/**
 * Browser localStorage entry
 */
export const BrowserLocalStorageSchema = z.object({
  id: z.string(), // Primary key
  profileId: z.string(), // Foreign key to browser_profiles.id
  origin: z.string(), // e.g., "https://example.com"
  key: z.string(),
  value: z.string(),
});

export type BrowserLocalStorageRow = z.infer<typeof BrowserLocalStorageSchema>;

// ---------------------------------------------------------------------------
// PluginSchema for storage API
// ---------------------------------------------------------------------------

export const browserProfilePluginSchema: PluginSchema = {
  namespace: "browser",
  version: 1,
  tables: {
    profiles: {
      schema: BrowserProfileSchema,
      primaryKey: "id",
      indexes: [{ fields: ["name"], unique: true }],
    },
    cookies: {
      schema: BrowserCookieSchema,
      primaryKey: "id",
      indexes: [{ fields: ["profileId"] }],
    },
    localStorage: {
      schema: BrowserLocalStorageSchema,
      primaryKey: "id",
      indexes: [{ fields: ["profileId"] }, { fields: ["origin"] }],
    },
  },
};
