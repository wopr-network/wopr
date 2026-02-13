/**
 * Browser profile persistence for the browser A2A tools.
 *
 * Stores cookies and local-storage snapshots per profile name so that
 * sessions survive across tool invocations.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../../logger.js";
import { WOPR_HOME } from "../../paths.js";

const PROFILES_DIR = join(WOPR_HOME, "browser-profiles");

export interface BrowserProfile {
  name: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
  localStorage: Record<string, Record<string, string>>;
  updatedAt: number;
}

function ensureDir(): void {
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function profilePath(name: string): string {
  // Sanitize profile name to prevent path traversal
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(PROFILES_DIR, `${safe}.json`);
}

export function loadProfile(name: string): BrowserProfile {
  ensureDir();
  const p = profilePath(name);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as BrowserProfile;
    } catch (err) {
      logger.warn(`[browser-profile] Failed to load profile "${name}", starting fresh: ${err}`);
    }
  }
  return { name, cookies: [], localStorage: {}, updatedAt: Date.now() };
}

export function saveProfile(profile: BrowserProfile): void {
  ensureDir();
  profile.updatedAt = Date.now();
  writeFileSync(profilePath(profile.name), JSON.stringify(profile, null, 2));
}

export function listProfiles(): string[] {
  ensureDir();
  return readdirSync(PROFILES_DIR)
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace(/\.json$/, ""));
}
