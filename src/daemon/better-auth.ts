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
 * Validate BETTER_AUTH_SECRET at startup.
 * Must be set and at least 32 characters to prevent weak/default secrets.
 */
function validateAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error("BETTER_AUTH_SECRET must be set (min 32 chars). Generate with: openssl rand -base64 32");
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (got ${secret.length}). Generate with: openssl rand -base64 32`,
    );
  }
  return secret;
}

const authSecret = validateAuthSecret();

export const auth = betterAuth({
  database: new DatabaseSync(AUTH_DB_PATH),
  basePath: "/api/auth",
  secret: authSecret,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID || "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
      enabled: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
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
