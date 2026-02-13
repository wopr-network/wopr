/**
 * Password Hashing (WOP-208)
 *
 * Uses argon2id for password hashing - the recommended algorithm
 * for password storage per OWASP guidelines.
 */

import argon2 from "argon2";

/**
 * Hash a password using argon2id.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  });
}

/**
 * Verify a password against an argon2 hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
