/**
 * Bot profile persistence — JSON file in daemon data directory
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WOPR_HOME } from "../../paths.js";
import type { BotProfile, CreateBotInput, UpdateBotInput } from "./types.js";

const FLEET_DIR = join(WOPR_HOME, "fleet");
const PROFILES_FILE = join(FLEET_DIR, "profiles.json");

const DEFAULT_IMAGE = "ghcr.io/wopr-network/wopr";
const DEFAULT_CHANNEL = "stable";

function ensureDir(): void {
  if (!existsSync(FLEET_DIR)) {
    mkdirSync(FLEET_DIR, { recursive: true });
  }
}

function loadProfiles(): BotProfile[] {
  ensureDir();
  if (!existsSync(PROFILES_FILE)) return [];
  const raw = readFileSync(PROFILES_FILE, "utf-8");
  return JSON.parse(raw) as BotProfile[];
}

function saveProfiles(profiles: BotProfile[]): void {
  ensureDir();
  writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

export function listProfiles(): BotProfile[] {
  return loadProfiles();
}

export function getProfile(id: string): BotProfile | undefined {
  return loadProfiles().find((p) => p.id === id);
}

export function createProfile(input: CreateBotInput): BotProfile {
  const profiles = loadProfiles();
  const now = new Date().toISOString();
  const profile: BotProfile = {
    id: randomUUID(),
    name: input.name,
    image: input.image || DEFAULT_IMAGE,
    releaseChannel: input.releaseChannel || DEFAULT_CHANNEL,
    env: input.env || {},
    restartPolicy: input.restartPolicy || "unless-stopped",
    volume: input.volume,
    healthcheck: input.healthcheck,
    labels: input.labels,
    createdAt: now,
    updatedAt: now,
  };
  profiles.push(profile);
  saveProfiles(profiles);
  return profile;
}

export function updateProfile(id: string, input: UpdateBotInput): BotProfile | undefined {
  const profiles = loadProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;

  const existing = profiles[idx];
  const updated: BotProfile = {
    ...existing,
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    id: existing.id, // immutable
    createdAt: existing.createdAt, // immutable
    updatedAt: new Date().toISOString(),
  };
  profiles[idx] = updated;
  saveProfiles(profiles);
  return updated;
}

export function deleteProfile(id: string): boolean {
  const profiles = loadProfiles();
  const filtered = profiles.filter((p) => p.id !== id);
  if (filtered.length === profiles.length) return false;
  saveProfiles(filtered);
  return true;
}
