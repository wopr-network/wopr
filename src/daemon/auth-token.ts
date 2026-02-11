/**
 * Daemon Bearer Token Management
 *
 * Generates and stores a random bearer token for authenticating
 * control API requests to the daemon. Token is persisted in
 * $WOPR_HOME/daemon-token with mode 0600.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { WOPR_HOME } from "../paths.js";

export const TOKEN_FILE = join(WOPR_HOME, "daemon-token");

/**
 * Read the existing token from disk, or return null if it doesn't exist.
 */
export function getToken(): string | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const token = readFileSync(TOKEN_FILE, "utf-8").trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Ensure a token exists on disk. If one already exists, return it.
 * Otherwise generate a new 32-byte hex token and write it with mode 0600.
 */
export function ensureToken(): string {
  const existing = getToken();
  if (existing) return existing;

  const token = randomBytes(32).toString("hex");
  const dir = dirname(TOKEN_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  return token;
}
