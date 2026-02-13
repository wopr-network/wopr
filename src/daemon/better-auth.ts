/**
 * Better Auth Configuration (WOP-261)
 *
 * Provides platform authentication via Better Auth:
 * - Email/password with argon2 (built-in)
 * - OAuth: GitHub, Discord, Google
 * - RBAC via organization plugin (owner/admin/viewer)
 * - Bearer token plugin for API clients
 *
 * Uses node:sqlite DatabaseSync (already used by the project).
 *
 * DB schema: Better Auth auto-creates required tables (user, session, account,
 * verification, organization, member, invitation) on first use via its internal
 * Kysely adapter. No explicit migration step is needed for SQLite.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import { bearer, organization } from "better-auth/plugins";
import { WOPR_HOME } from "../paths.js";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite");

const AUTH_DB_PATH = join(WOPR_HOME, "auth.sqlite");

const MIN_SECRET_LENGTH = 32;

/**
 * Default base URL for Better Auth when BETTER_AUTH_URL is not set.
 * Matches the default daemon listen address.
 */
const DEFAULT_AUTH_URL = "http://127.0.0.1:7437";

/**
 * Validate BETTER_AUTH_SECRET at startup.
 * Must be set and at least 32 characters to prevent weak/default secrets.
 */
function validateAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      "BETTER_AUTH_SECRET environment variable is required for signing auth tokens and sessions. Generate with: openssl rand -base64 32",
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length}). Generate with: openssl rand -base64 32`,
    );
  }
  return secret;
}

/** Cached auth singleton — created on first call to getAuth(). */
let authInstance: ReturnType<typeof betterAuth> | undefined;

/**
 * Returns the Better Auth instance, creating it lazily on first call.
 *
 * Lazy initialization prevents the daemon from crashing at import time
 * if BETTER_AUTH_SECRET or other config is not yet available (e.g. during
 * CLI commands that import shared modules but don't run the HTTP server).
 */
export function getAuth(): ReturnType<typeof betterAuth> {
  if (!authInstance) {
    const authSecret = validateAuthSecret();
    const baseURL = process.env.BETTER_AUTH_URL || DEFAULT_AUTH_URL;

    authInstance = betterAuth({
      database: new DatabaseSync(AUTH_DB_PATH),
      basePath: "/api/auth",
      secret: authSecret,
      baseURL,
      emailAndPassword: {
        enabled: true,
      },
      socialProviders: {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID as string,
          clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
          enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
        },
        discord: {
          clientId: process.env.DISCORD_CLIENT_ID as string,
          clientSecret: process.env.DISCORD_CLIENT_SECRET as string,
          enabled: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
        },
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
          enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        },
      },
      plugins: [
        organization({
          allowUserToCreateOrganization: true,
          creatorRole: "owner",
        }),
        bearer(),
      ],
    });
  }
  return authInstance;
}
