/**
 * User Auth Service (WOP-208)
 *
 * Provides user registration, login, token refresh, logout, and profile.
 * Uses SQLite for storage, argon2 for passwords, RS256 JWT for tokens.
 */

import { createHash, randomUUID } from "node:crypto";
import { logger } from "../../logger.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { getAuthDb } from "./schema.js";
import { signAccessToken, signRefreshToken, verifyToken } from "./tokens.js";

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  created_at: number;
  updated_at: number;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  role: string;
  created_at: number;
  updated_at: number;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  revoked: number;
  created_at: number;
}

/**
 * Hash a refresh token for storage (we don't store raw tokens).
 */
function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Register a new user.
 */
export async function registerUser(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<{ user: User }> {
  const db = getAuthDb();
  const email = params.email.toLowerCase().trim();

  // Check email uniqueness
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as UserRow | undefined;
  if (existing) {
    throw new AuthError("Email already registered", 409);
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError("Invalid email format", 400);
  }

  // Validate password strength
  if (params.password.length < 8) {
    throw new AuthError("Password must be at least 8 characters", 400);
  }

  const id = randomUUID();
  const now = Date.now();
  const passwordHash = await hashPassword(params.password);

  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, email, passwordHash, params.displayName ?? null, "user", now, now);

  logger.info(`[user-auth] User registered: ${email}`);

  return {
    user: {
      id,
      email,
      display_name: params.displayName ?? null,
      role: "user",
      created_at: now,
      updated_at: now,
    },
  };
}

/**
 * Login with email and password. Returns access + refresh tokens.
 */
export async function loginUser(params: {
  email: string;
  password: string;
}): Promise<{ accessToken: string; refreshToken: string; user: User }> {
  const db = getAuthDb();
  const email = params.email.toLowerCase().trim();

  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  if (!row) {
    throw new AuthError("Invalid email or password", 401);
  }

  const valid = await verifyPassword(params.password, row.password_hash);
  if (!valid) {
    throw new AuthError("Invalid email or password", 401);
  }

  // Generate tokens
  const accessToken = await signAccessToken({
    sub: row.id,
    email: row.email,
    role: row.role,
  });

  const refreshTokenId = randomUUID();
  const refreshToken = await signRefreshToken({
    sub: row.id,
    jti: refreshTokenId,
  });

  // Store refresh token hash
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  db.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)",
  ).run(refreshTokenId, row.id, hashRefreshToken(refreshToken), now + sevenDays, now);

  logger.info(`[user-auth] User logged in: ${email}`);

  return {
    accessToken,
    refreshToken,
    user: {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      role: row.role,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  };
}

/**
 * Refresh an access token using a valid refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const db = getAuthDb();

  // Verify the JWT itself
  const payload = await verifyToken(refreshToken);
  if (!payload || !payload.jti || !payload.sub) {
    throw new AuthError("Invalid refresh token", 401);
  }

  // Check the token exists in DB and is not revoked
  const tokenRow = db.prepare("SELECT * FROM refresh_tokens WHERE id = ? AND revoked = 0").get(payload.jti) as
    | RefreshTokenRow
    | undefined;

  if (!tokenRow) {
    throw new AuthError("Refresh token revoked or not found", 401);
  }

  if (tokenRow.expires_at < Date.now()) {
    throw new AuthError("Refresh token expired", 401);
  }

  // Verify token hash matches
  const storedHash = tokenRow.token_hash;
  const providedHash = hashRefreshToken(refreshToken);
  if (storedHash !== providedHash) {
    throw new AuthError("Invalid refresh token", 401);
  }

  // Get user
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub) as UserRow | undefined;
  if (!user) {
    throw new AuthError("User not found", 401);
  }

  // Revoke old refresh token (rotation)
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE id = ?").run(payload.jti);

  // Issue new tokens
  const newAccessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const newRefreshTokenId = randomUUID();
  const newRefreshToken = await signRefreshToken({
    sub: user.id,
    jti: newRefreshTokenId,
  });

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  db.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, 0, ?)",
  ).run(newRefreshTokenId, user.id, hashRefreshToken(newRefreshToken), now + sevenDays, now);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

/**
 * Logout: revoke all refresh tokens for a user.
 */
export function logoutUser(userId: string): void {
  const db = getAuthDb();
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?").run(userId);
  logger.info(`[user-auth] User logged out: ${userId}`);
}

/**
 * Get user profile by ID.
 */
export function getUserProfile(userId: string): User | null {
  const db = getAuthDb();
  const row = db
    .prepare("SELECT id, email, display_name, role, created_at, updated_at FROM users WHERE id = ?")
    .get(userId) as User | undefined;
  return row ?? null;
}

/**
 * Typed error for auth operations.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export { closeAuthDb, getAuthDb } from "./schema.js";
export { verifyToken } from "./tokens.js";
