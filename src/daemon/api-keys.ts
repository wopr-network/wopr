/**
 * API Key Management (WOP-209, WOP-546)
 *
 * Provides CRUD operations for user-scoped API keys:
 * - Generate: creates a `wopr_` prefixed key, stores scrypt hash
 * - List: returns masked keys for the authenticated user
 * - Revoke: deletes a key by ID (user-scoped)
 * - Validate: verifies a raw key against stored hashes, updates last_used_at
 *
 * Migrated from raw node:sqlite to Storage API (WOP-546).
 * The raw key is never persisted — only a scrypt hash is stored.
 */

import type { AuthStore, ApiKeyScope, ApiKeyInfo, ValidatedKeyUser } from "../auth/auth-store.js";
import { KeyLimitError } from "../auth/auth-store.js";

// Re-export types for backward compatibility
export type { ApiKeyScope, ApiKeyInfo, ValidatedKeyUser };
export { KeyLimitError };

let authStoreInstance: AuthStore | null = null;

/**
 * Set the auth store instance (called during daemon init)
 */
export function setAuthStore(store: AuthStore): void {
  authStoreInstance = store;
}

function ensureStore(): AuthStore {
  if (!authStoreInstance) {
    throw new Error("Auth store not initialized - call setAuthStore() first");
  }
  return authStoreInstance;
}

/**
 * Generate a new API key for a user.
 * Returns the raw key (shown once) and the key metadata.
 */
export async function generateApiKey(
  userId: string,
  name: string,
  scope: ApiKeyScope = "full",
  expiresAt?: number | null,
): Promise<{ rawKey: string; keyInfo: ApiKeyInfo }> {
  const store = ensureStore();
  return await store.createApiKey(userId, name, scope, expiresAt);
}

/**
 * List all API keys for a user (masked — no raw key or hash returned).
 */
export async function listApiKeys(userId: string): Promise<ApiKeyInfo[]> {
  const store = ensureStore();
  return await store.listApiKeys(userId);
}

/**
 * Revoke (delete) an API key. Only succeeds if the key belongs to the user.
 * Returns true if a key was deleted, false if not found.
 */
export async function revokeApiKey(keyId: string, userId: string): Promise<boolean> {
  const store = ensureStore();
  return await store.revokeApiKey(keyId, userId);
}

/**
 * Validate a raw API key (e.g. from Authorization header).
 * Checks all non-expired keys, verifies the hash, updates last_used_at.
 * Returns the user ID and scope if valid, null otherwise.
 */
export async function validateApiKey(rawKey: string): Promise<ValidatedKeyUser | null> {
  const store = ensureStore();
  return await store.validateApiKey(rawKey);
}
