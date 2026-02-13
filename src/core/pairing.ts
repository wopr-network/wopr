/**
 * Cross-Channel DM Pairing - Unified Identity System
 *
 * Links platform-specific sender IDs (Discord user ID, Telegram user ID, etc.)
 * to a single WOPR identity. Users pair via a short-lived pairing code that
 * can be generated from any channel and verified from any other channel.
 *
 * Flow:
 * 1. Owner generates a pairing code for a user: `!pair generate <name> [trustLevel]`
 * 2. User sends the code from any channel: `!pair verify <code>`
 * 3. System links that channel's sender ID to the WOPR identity
 * 4. Trust level is applied consistently across all linked channels
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import { WOPR_HOME } from "../paths.js";
import type { TrustLevel } from "../security/types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A platform-specific identity link (e.g., Discord user ID, Telegram user ID)
 */
export interface PlatformLink {
  /** Channel type (e.g., "discord", "telegram", "slack") */
  channelType: string;

  /** Platform-specific sender ID */
  senderId: string;

  /** When this link was created */
  linkedAt: number;
}

/**
 * A unified WOPR identity that can span multiple channels
 */
export interface WoprIdentity {
  /** Unique identity ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Trust level for this identity */
  trustLevel: TrustLevel;

  /** Platform links - one per channel type */
  links: PlatformLink[];

  /** When this identity was created */
  createdAt: number;

  /** When this identity was last updated */
  updatedAt: number;
}

/**
 * A pending pairing code waiting to be verified
 */
export interface PairingCode {
  /** The short code (e.g., "A1B2C3") */
  code: string;

  /** Identity ID this code pairs to */
  identityId: string;

  /** Trust level to assign on successful pairing */
  trustLevel: TrustLevel;

  /** When this code was created */
  createdAt: number;

  /** When this code expires */
  expiresAt: number;
}

/**
 * Serializable state for the pairing store
 */
interface PairingStoreData {
  identities: WoprIdentity[];
  pendingCodes: PairingCode[];
}

// ============================================================================
// Constants
// ============================================================================

const PAIRING_DIR = join(WOPR_HOME, "pairing");
const IDENTITIES_FILE = join(PAIRING_DIR, "identities.json");
const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const PAIRING_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No 0/O/1/I confusion

// ============================================================================
// Storage
// ============================================================================

function ensureDir(): void {
  if (!existsSync(PAIRING_DIR)) {
    mkdirSync(PAIRING_DIR, { recursive: true });
  }
}

function loadStore(): PairingStoreData {
  ensureDir();
  if (!existsSync(IDENTITIES_FILE)) {
    return { identities: [], pendingCodes: [] };
  }
  try {
    return JSON.parse(readFileSync(IDENTITIES_FILE, "utf-8"));
  } catch {
    logger.warn("[pairing] Failed to parse identities file, starting fresh");
    return { identities: [], pendingCodes: [] };
  }
}

function saveStore(data: PairingStoreData): void {
  ensureDir();
  writeFileSync(IDENTITIES_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Pairing Code Generation
// ============================================================================

/**
 * Generate a cryptographically random pairing code
 */
function generateCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_CHARSET[bytes[i] % PAIRING_CODE_CHARSET.length];
  }
  return code;
}

/**
 * Generate a unique identity ID
 */
function generateId(): string {
  return randomBytes(16).toString("hex");
}

// ============================================================================
// Identity Management
// ============================================================================

/**
 * Create a new WOPR identity
 */
export function createIdentity(name: string, trustLevel: TrustLevel = "semi-trusted"): WoprIdentity {
  const store = loadStore();

  // Check for duplicate name
  if (store.identities.some((id) => id.name === name)) {
    throw new Error(`Identity with name "${name}" already exists`);
  }

  const identity: WoprIdentity = {
    id: generateId(),
    name,
    trustLevel,
    links: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  store.identities.push(identity);
  saveStore(store);

  logger.info(`[pairing] Created identity: ${name} (trust: ${trustLevel})`);
  return identity;
}

/**
 * Get an identity by ID
 */
export function getIdentity(id: string): WoprIdentity | undefined {
  const store = loadStore();
  return store.identities.find((i) => i.id === id);
}

/**
 * Get an identity by name
 */
export function getIdentityByName(name: string): WoprIdentity | undefined {
  const store = loadStore();
  return store.identities.find((i) => i.name === name);
}

/**
 * Find the identity linked to a specific platform sender
 */
export function findIdentityBySender(channelType: string, senderId: string): WoprIdentity | undefined {
  const store = loadStore();
  return store.identities.find((i) => i.links.some((l) => l.channelType === channelType && l.senderId === senderId));
}

/**
 * Get all identities
 */
export function listIdentities(): WoprIdentity[] {
  const store = loadStore();
  return store.identities;
}

/**
 * Update an identity's trust level
 */
export function setIdentityTrustLevel(id: string, trustLevel: TrustLevel): WoprIdentity {
  const store = loadStore();
  const identity = store.identities.find((i) => i.id === id);
  if (!identity) {
    throw new Error(`Identity not found: ${id}`);
  }

  identity.trustLevel = trustLevel;
  identity.updatedAt = Date.now();
  saveStore(store);

  logger.info(`[pairing] Updated trust level for ${identity.name}: ${trustLevel}`);
  return identity;
}

/**
 * Remove an identity and all its links
 */
export function removeIdentity(id: string): boolean {
  const store = loadStore();
  const idx = store.identities.findIndex((i) => i.id === id);
  if (idx === -1) return false;

  const removed = store.identities[idx];
  store.identities.splice(idx, 1);

  // Also remove any pending codes for this identity
  store.pendingCodes = store.pendingCodes.filter((c) => c.identityId !== id);

  saveStore(store);
  logger.info(`[pairing] Removed identity: ${removed.name}`);
  return true;
}

// ============================================================================
// Platform Linking
// ============================================================================

/**
 * Link a platform sender to an identity
 */
export function linkPlatform(identityId: string, channelType: string, senderId: string): WoprIdentity {
  const store = loadStore();
  const identity = store.identities.find((i) => i.id === identityId);
  if (!identity) {
    throw new Error(`Identity not found: ${identityId}`);
  }

  // Check if this sender is already linked to another identity
  const existing = store.identities.find(
    (i) => i.id !== identityId && i.links.some((l) => l.channelType === channelType && l.senderId === senderId),
  );
  if (existing) {
    throw new Error(`Sender ${channelType}:${senderId} is already linked to identity "${existing.name}"`);
  }

  // Check if this identity already has a link for this channel type
  const existingLink = identity.links.find((l) => l.channelType === channelType);
  if (existingLink) {
    // Update existing link
    existingLink.senderId = senderId;
    existingLink.linkedAt = Date.now();
  } else {
    // Add new link
    identity.links.push({
      channelType,
      senderId,
      linkedAt: Date.now(),
    });
  }

  identity.updatedAt = Date.now();
  saveStore(store);

  logger.info(`[pairing] Linked ${channelType}:${senderId} to identity ${identity.name}`);
  return identity;
}

/**
 * Unlink a platform from an identity
 */
export function unlinkPlatform(identityId: string, channelType: string): boolean {
  const store = loadStore();
  const identity = store.identities.find((i) => i.id === identityId);
  if (!identity) return false;

  const idx = identity.links.findIndex((l) => l.channelType === channelType);
  if (idx === -1) return false;

  identity.links.splice(idx, 1);
  identity.updatedAt = Date.now();
  saveStore(store);

  logger.info(`[pairing] Unlinked ${channelType} from identity ${identity.name}`);
  return true;
}

// ============================================================================
// Pairing Code Flow
// ============================================================================

/**
 * Generate a pairing code for an identity.
 * If the identity does not exist yet, creates it.
 */
export function generatePairingCode(
  name: string,
  trustLevel: TrustLevel = "semi-trusted",
  expiryMs: number = PAIRING_CODE_EXPIRY_MS,
): PairingCode {
  const store = loadStore();

  // Find or create identity
  let identity = store.identities.find((i) => i.name === name);
  if (!identity) {
    identity = {
      id: generateId(),
      name,
      trustLevel,
      links: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.identities.push(identity);
  }

  // Revoke any existing pending codes for this identity
  store.pendingCodes = store.pendingCodes.filter((c) => c.identityId !== identity.id);

  // Generate new code
  const code: PairingCode = {
    code: generateCode(),
    identityId: identity.id,
    trustLevel,
    createdAt: Date.now(),
    expiresAt: Date.now() + expiryMs,
  };

  store.pendingCodes.push(code);
  saveStore(store);

  logger.info(`[pairing] Generated pairing code for ${name} (expires in ${expiryMs / 1000}s)`);
  return code;
}

/**
 * Verify a pairing code and link the sender to the identity.
 * Returns the identity on success, or null if the code is invalid/expired.
 */
export function verifyPairingCode(
  code: string,
  channelType: string,
  senderId: string,
): { identity: WoprIdentity; trustLevel: TrustLevel } | null {
  const store = loadStore();
  const now = Date.now();

  // Clean up expired codes
  store.pendingCodes = store.pendingCodes.filter((c) => c.expiresAt > now);

  // Find matching code (case-insensitive)
  const codeUpper = code.toUpperCase();
  const codeIdx = store.pendingCodes.findIndex((c) => c.code === codeUpper);
  if (codeIdx === -1) {
    saveStore(store); // Save cleanup
    return null;
  }

  const pairingCode = store.pendingCodes[codeIdx];
  const identity = store.identities.find((i) => i.id === pairingCode.identityId);
  if (!identity) {
    // Orphaned code — clean up
    store.pendingCodes.splice(codeIdx, 1);
    saveStore(store);
    return null;
  }

  // Check if this sender is already linked to another identity
  const existingIdentity = store.identities.find(
    (i) => i.id !== identity.id && i.links.some((l) => l.channelType === channelType && l.senderId === senderId),
  );
  if (existingIdentity) {
    logger.warn(
      `[pairing] Sender ${channelType}:${senderId} already linked to "${existingIdentity.name}", cannot pair to "${identity.name}"`,
    );
    return null;
  }

  // Link the sender
  const existingLink = identity.links.find((l) => l.channelType === channelType);
  if (existingLink) {
    existingLink.senderId = senderId;
    existingLink.linkedAt = Date.now();
  } else {
    identity.links.push({
      channelType,
      senderId,
      linkedAt: Date.now(),
    });
  }

  // Apply trust level from code
  identity.trustLevel = pairingCode.trustLevel;
  identity.updatedAt = Date.now();

  // Consume the code
  store.pendingCodes.splice(codeIdx, 1);
  saveStore(store);

  logger.info(`[pairing] Verified pairing code: ${channelType}:${senderId} -> ${identity.name} (${pairingCode.trustLevel})`);
  return { identity, trustLevel: pairingCode.trustLevel };
}

/**
 * Get all pending pairing codes (for admin listing)
 */
export function listPendingCodes(): PairingCode[] {
  const store = loadStore();
  const now = Date.now();
  // Return only non-expired codes
  return store.pendingCodes.filter((c) => c.expiresAt > now);
}

/**
 * Revoke a pending pairing code
 */
export function revokePairingCode(code: string): boolean {
  const store = loadStore();
  const idx = store.pendingCodes.findIndex((c) => c.code === code.toUpperCase());
  if (idx === -1) return false;

  store.pendingCodes.splice(idx, 1);
  saveStore(store);
  return true;
}

// ============================================================================
// Trust Level Resolution
// ============================================================================

/**
 * Resolve the trust level for a sender on a given channel.
 * Returns the trust level from their paired identity, or "untrusted" if not paired.
 */
export function resolveTrustLevel(channelType: string, senderId: string): TrustLevel {
  const identity = findIdentityBySender(channelType, senderId);
  return identity?.trustLevel ?? "untrusted";
}

// ============================================================================
// Exports for testing
// ============================================================================

export const _testing = {
  PAIRING_DIR,
  IDENTITIES_FILE,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_EXPIRY_MS,
  PAIRING_CODE_CHARSET,
  generateCode,
  generateId,
  loadStore,
  saveStore,
};
