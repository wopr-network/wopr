/**
 * Browser profile repository
 *
 * Async CRUD operations for browser profiles using the storage API.
 */

import { randomUUID } from "node:crypto";
import { getStorage } from "../storage/public.js";
import {
  type BrowserCookieRow,
  type BrowserLocalStorageRow,
  type BrowserProfileRow,
  browserProfilePluginSchema,
} from "./browser-profile-schema.js";

/**
 * Cookie shape for external API (matches browser-profile.ts)
 */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number; // Unix timestamp (s) - Playwright format
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * LocalStorage shape: Record<origin, Record<key, value>>
 */
export type LocalStorageData = Record<string, Record<string, string>>;

/**
 * Full browser profile (with cookies and localStorage)
 */
export interface BrowserProfile {
  name: string;
  cookies: BrowserCookie[];
  localStorage: LocalStorageData;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

/**
 * Initialize browser profile storage (register schema)
 */
export async function initBrowserProfileStorage(): Promise<void> {
  const storage = getStorage();
  if (!storage.isRegistered("browser")) {
    await storage.register(browserProfilePluginSchema);
  }
}

/**
 * Ensure a profile exists. If not, create it.
 */
export async function ensureProfile(name: string): Promise<BrowserProfileRow> {
  const storage = getStorage();
  const repo = storage.getRepository<BrowserProfileRow>("browser", "profiles");

  const existing = await repo.findFirst({ name });
  if (existing) return existing;

  // Create new profile
  const now = Date.now();
  return repo.insert({
    id: randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Get a profile by name
 */
export async function getProfileByName(name: string): Promise<BrowserProfileRow | null> {
  const storage = getStorage();
  const repo = storage.getRepository<BrowserProfileRow>("browser", "profiles");
  return repo.findFirst({ name });
}

/**
 * Update profile metadata (userAgent, viewport, updatedAt)
 */
export async function updateProfile(
  name: string,
  data: { userAgent?: string; viewport?: string },
): Promise<BrowserProfileRow> {
  const storage = getStorage();
  const repo = storage.getRepository<BrowserProfileRow>("browser", "profiles");

  const profile = await ensureProfile(name);
  return repo.update(profile.id, {
    ...data,
    updatedAt: Date.now(),
  });
}

/**
 * Replace all cookies for a profile (transaction: delete + insert)
 */
export async function replaceCookies(name: string, cookies: BrowserCookie[]): Promise<void> {
  const storage = getStorage();
  const profile = await ensureProfile(name);

  // Transaction: delete all existing cookies, then insert new ones
  await storage.transaction(async (txStorage) => {
    const cookieRepo = txStorage.getRepository<BrowserCookieRow>("browser", "cookies");

    // Delete all cookies for this profile
    await cookieRepo.deleteMany({ profileId: profile.id });

    // Insert new cookies
    if (cookies.length > 0) {
      const rows: BrowserCookieRow[] = cookies.map((c) => ({
        id: randomUUID(),
        profileId: profile.id,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expiresAt: c.expires ? c.expires * 1000 : undefined, // Convert s → ms
        httpOnly: c.httpOnly ? 1 : 0,
        secure: c.secure ? 1 : 0,
        sameSite: c.sameSite,
      }));
      await cookieRepo.insertMany(rows);
    }
  });
}

/**
 * Get all cookies for a profile
 */
export async function getCookies(name: string): Promise<BrowserCookie[]> {
  const storage = getStorage();
  const profile = await ensureProfile(name);
  const cookieRepo = storage.getRepository<BrowserCookieRow>("browser", "cookies");

  const rows = await cookieRepo.findMany({ profileId: profile.id });
  return rows.map((r) => ({
    name: r.name,
    value: r.value,
    domain: r.domain,
    path: r.path,
    expires: r.expiresAt ? Math.floor(r.expiresAt / 1000) : undefined, // Convert ms → s
    httpOnly: r.httpOnly === 1,
    secure: r.secure === 1,
    sameSite: r.sameSite as "Strict" | "Lax" | "None" | undefined,
  }));
}

/**
 * Replace all localStorage entries for a profile
 */
export async function replaceLocalStorage(name: string, data: LocalStorageData): Promise<void> {
  const storage = getStorage();
  const profile = await ensureProfile(name);

  await storage.transaction(async (txStorage) => {
    const lsRepo = txStorage.getRepository<BrowserLocalStorageRow>("browser", "localStorage");

    // Delete all localStorage for this profile
    await lsRepo.deleteMany({ profileId: profile.id });

    // Insert new entries
    const rows: BrowserLocalStorageRow[] = [];
    for (const [origin, kvMap] of Object.entries(data)) {
      for (const [key, value] of Object.entries(kvMap)) {
        rows.push({
          id: randomUUID(),
          profileId: profile.id,
          origin,
          key,
          value,
        });
      }
    }
    if (rows.length > 0) {
      await lsRepo.insertMany(rows);
    }
  });
}

/**
 * Get all localStorage entries for a profile
 */
export async function getLocalStorage(name: string): Promise<LocalStorageData> {
  const storage = getStorage();
  const profile = await ensureProfile(name);
  const lsRepo = storage.getRepository<BrowserLocalStorageRow>("browser", "localStorage");

  const rows = await lsRepo.findMany({ profileId: profile.id });

  const result: LocalStorageData = {};
  for (const row of rows) {
    if (!result[row.origin]) {
      result[row.origin] = {};
    }
    result[row.origin][row.key] = row.value;
  }
  return result;
}

/**
 * List all profile names
 */
export async function listProfileNames(): Promise<string[]> {
  const storage = getStorage();
  const repo = storage.getRepository<BrowserProfileRow>("browser", "profiles");
  const profiles = await repo.findMany();
  return profiles.map((p) => p.name);
}

/**
 * Load a full browser profile (metadata + cookies + localStorage)
 */
export async function loadProfile(name: string): Promise<BrowserProfile> {
  const profile = await ensureProfile(name);
  const cookies = await getCookies(name);
  const localStorage = await getLocalStorage(name);

  return {
    name,
    cookies,
    localStorage,
    updatedAt: profile.updatedAt,
  };
}

/**
 * Save a full browser profile (update cookies and localStorage)
 */
export async function saveProfile(profile: BrowserProfile): Promise<void> {
  await ensureProfile(profile.name);
  await replaceCookies(profile.name, profile.cookies);
  await replaceLocalStorage(profile.name, profile.localStorage);
  await updateProfile(profile.name, {});
}
