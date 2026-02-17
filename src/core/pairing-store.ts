/**
 * Pairing store - SQL-based storage for identities and pairing codes
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import { WOPR_HOME } from "../paths.js";
import type { Repository } from "../storage/api/plugin-storage.js";
import { getStorage } from "../storage/index.js";
import type { PairingCode, PlatformLink, WoprIdentity } from "./pairing.js";
import type { PairingCodeRecord, PairingIdentityRecord } from "./pairing-schema.js";
import { pairingPluginSchema } from "./pairing-schema.js";

let identitiesRepo: Repository<PairingIdentityRecord> | null = null;
let codesRepo: Repository<PairingCodeRecord> | null = null;

/**
 * Pairing store - CRUD operations for identities and codes
 */
export class PairingStore {
  constructor(
    private readonly identities: Repository<PairingIdentityRecord>,
    private readonly codes: Repository<PairingCodeRecord>,
  ) {}

  // ==================== Identity Operations ====================

  async createIdentity(identity: WoprIdentity): Promise<WoprIdentity> {
    const record: PairingIdentityRecord = {
      id: identity.id,
      name: identity.name,
      trustLevel: identity.trustLevel,
      links: JSON.stringify(identity.links),
      createdAt: identity.createdAt,
      updatedAt: identity.updatedAt,
    };
    const saved = await this.identities.insert(record);
    return this.recordToIdentity(saved);
  }

  async getIdentity(id: string): Promise<WoprIdentity | null> {
    const record = await this.identities.findById(id);
    return record ? this.recordToIdentity(record) : null;
  }

  async getIdentityByName(name: string): Promise<WoprIdentity | null> {
    const record = await this.identities.findFirst({ name });
    return record ? this.recordToIdentity(record) : null;
  }

  /**
   * Find identity by platform sender using raw SQL with json_each()
   * This avoids loading all identities into memory
   */
  async findIdentityBySender(channelType: string, senderId: string): Promise<WoprIdentity | null> {
    // Use raw SQL to search inside JSON array
    const sql = `
      SELECT i.*
      FROM pairing_identities i,
           json_each(i.links) AS link
      WHERE json_extract(link.value, '$.channelType') = ?
        AND json_extract(link.value, '$.senderId') = ?
      LIMIT 1
    `;
    const results = await this.identities.raw(sql, [channelType, senderId]);
    if (results.length === 0) return null;
    return this.recordToIdentity(results[0] as PairingIdentityRecord);
  }

  async listIdentities(): Promise<WoprIdentity[]> {
    const records = await this.identities.findMany();
    return records.map((r) => this.recordToIdentity(r));
  }

  async updateIdentity(id: string, updates: Partial<WoprIdentity>): Promise<WoprIdentity> {
    const record: Partial<PairingIdentityRecord> = {
      updatedAt: Date.now(),
    };
    if (updates.name !== undefined) record.name = updates.name;
    if (updates.trustLevel !== undefined) record.trustLevel = updates.trustLevel;
    if (updates.links !== undefined) record.links = JSON.stringify(updates.links);

    const updated = await this.identities.update(id, record);
    return this.recordToIdentity(updated);
  }

  async removeIdentity(id: string): Promise<boolean> {
    // Also remove any pending codes for this identity
    await this.codes.deleteMany({ identityId: id });
    return this.identities.delete(id);
  }

  // ==================== Pairing Code Operations ====================

  async createCode(code: PairingCode): Promise<PairingCode> {
    const record: PairingCodeRecord = {
      code: code.code,
      identityId: code.identityId,
      trustLevel: code.trustLevel,
      createdAt: code.createdAt,
      expiresAt: code.expiresAt,
    };
    await this.codes.insert(record);
    return code;
  }

  async getCode(code: string): Promise<PairingCode | null> {
    const record = await this.codes.findById(code);
    return record ? this.recordToCode(record) : null;
  }

  async listPendingCodes(): Promise<PairingCode[]> {
    const now = Date.now();
    const records = await this.codes.findMany({ expiresAt: { $gt: now } });
    return records.map((r) => this.recordToCode(r));
  }

  async revokeCode(code: string): Promise<boolean> {
    return this.codes.delete(code);
  }

  /**
   * Clean up expired codes
   */
  async cleanExpiredCodes(): Promise<number> {
    const now = Date.now();
    return this.codes.deleteMany({ expiresAt: { $lte: now } });
  }

  // ==================== Helpers ====================

  private recordToIdentity(record: PairingIdentityRecord): WoprIdentity {
    return {
      id: record.id,
      name: record.name,
      trustLevel: record.trustLevel,
      links: JSON.parse(record.links) as PlatformLink[],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private recordToCode(record: PairingCodeRecord): PairingCode {
    return {
      code: record.code,
      identityId: record.identityId,
      trustLevel: record.trustLevel,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    };
  }
}

/**
 * Initialize the pairing storage schema.
 * This MUST be called during daemon startup.
 */
export async function initPairing(): Promise<void> {
  const storage = getStorage();
  await storage.register(pairingPluginSchema);
  identitiesRepo = storage.getRepository<PairingIdentityRecord>("pairing", "identities");
  codesRepo = storage.getRepository<PairingCodeRecord>("pairing", "codes");

  // Migration: Import from identities.json if it exists
  await migrateFromJson();
}

/**
 * Get a PairingStore instance. Must call initPairing() first.
 */
export function getPairingStore(): PairingStore {
  if (!identitiesRepo || !codesRepo) {
    throw new Error("Pairing storage not initialized - call initPairing() first");
  }
  return new PairingStore(identitiesRepo, codesRepo);
}

/**
 * One-time migration from identities.json to SQL
 */
async function migrateFromJson(): Promise<void> {
  const IDENTITIES_FILE = join(WOPR_HOME, "pairing", "identities.json");
  if (!existsSync(IDENTITIES_FILE)) return;

  const store = getPairingStore();
  try {
    const data = JSON.parse(readFileSync(IDENTITIES_FILE, "utf-8"));
    const { identities = [], pendingCodes = [] } = data;

    // Import identities
    for (const identity of identities) {
      const existing = await store.getIdentity(identity.id);
      if (!existing) {
        await store.createIdentity(identity);
        logger.info(`[pairing] Migrated identity: ${identity.name}`);
      }
    }

    // Import pending codes
    for (const code of pendingCodes) {
      const existing = await store.getCode(code.code);
      if (!existing && code.expiresAt > Date.now()) {
        await store.createCode(code);
        logger.info(`[pairing] Migrated pairing code: ${code.code}`);
      }
    }

    logger.info(`[pairing] Migration complete: ${identities.length} identities, ${pendingCodes.length} codes`);
  } catch (err) {
    logger.warn(`[pairing] Migration failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Reset initialization state (for testing)
 */
export function resetPairingStoreState(): void {
  identitiesRepo = null;
  codesRepo = null;
}
