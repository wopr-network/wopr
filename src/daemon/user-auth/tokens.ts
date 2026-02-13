/**
 * JWT Token Management (WOP-208)
 *
 * RS256 asymmetric JWT signing/verification using the jose library.
 * Keys are generated on first use and persisted to WOPR_HOME.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CryptoKey as JoseCryptoKey } from "jose";
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";
import { WOPR_HOME } from "../../paths.js";

const KEY_DIR = join(WOPR_HOME, "keys");
const PRIVATE_KEY_FILE = join(KEY_DIR, "auth-private.pem");
const PUBLIC_KEY_FILE = join(KEY_DIR, "auth-public.pem");

const ALGORITHM = "RS256";
const ISSUER = "wopr-daemon";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY = "7d";

let _privateKey: JoseCryptoKey | null = null;
let _publicKey: JoseCryptoKey | null = null;

/**
 * Ensure the RSA key pair exists. Generate if missing, load from disk.
 */
async function ensureKeys(): Promise<{ privateKey: JoseCryptoKey; publicKey: JoseCryptoKey }> {
  if (_privateKey && _publicKey) {
    return { privateKey: _privateKey, publicKey: _publicKey };
  }

  if (existsSync(PRIVATE_KEY_FILE) && existsSync(PUBLIC_KEY_FILE)) {
    const privatePem = readFileSync(PRIVATE_KEY_FILE, "utf-8");
    const publicPem = readFileSync(PUBLIC_KEY_FILE, "utf-8");
    _privateKey = await importPKCS8(privatePem, ALGORITHM);
    _publicKey = await importSPKI(publicPem, ALGORITHM);
    return { privateKey: _privateKey, publicKey: _publicKey };
  }

  // Generate new key pair (extractable so we can persist to PEM)
  const { privateKey, publicKey } = await generateKeyPair(ALGORITHM, {
    modulusLength: 2048,
    extractable: true,
  });

  // Persist to disk
  const dir = dirname(PRIVATE_KEY_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const privatePem = await exportPKCS8(privateKey);
  const publicPem = await exportSPKI(publicKey);

  writeFileSync(PRIVATE_KEY_FILE, privatePem, { mode: 0o600 });
  writeFileSync(PUBLIC_KEY_FILE, publicPem, { mode: 0o644 });

  _privateKey = privateKey;
  _publicKey = publicKey;
  return { privateKey, publicKey };
}

export interface AccessTokenPayload {
  sub: string; // user ID
  email: string;
  role: string;
}

/**
 * Sign an access token (short-lived, 15 minutes).
 */
export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  const { privateKey } = await ensureKeys();
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(privateKey);
}

/**
 * Sign a refresh token (long-lived, 7 days).
 */
export async function signRefreshToken(payload: { sub: string; jti: string }): Promise<string> {
  const { privateKey } = await ensureKeys();
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(privateKey);
}

/**
 * Verify and decode a JWT. Returns the payload or null if invalid/expired.
 */
export async function verifyToken(token: string): Promise<{
  sub: string;
  email?: string;
  role?: string;
  jti?: string;
  exp?: number;
} | null> {
  try {
    const { publicKey } = await ensureKeys();
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: ISSUER,
      algorithms: [ALGORITHM],
    });
    return {
      sub: payload.sub as string,
      email: payload.email as string | undefined,
      role: payload.role as string | undefined,
      jti: payload.jti,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Reset cached keys (used in testing).
 */
export function resetKeyCache(): void {
  _privateKey = null;
  _publicKey = null;
}
