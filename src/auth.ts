import { logger } from "./logger.js";
/**
 * WOPR OAuth Authentication
 *
 * Supports:
 * - Claude Max/Pro OAuth (subscription-based, no per-token cost)
 * - API Key (pay-per-use)
 * - Multi-provider credentials via ProviderRegistry
 * - Environment variable injection for platform/container deployment
 * - Encrypted auth.json at rest (WOPR_CREDENTIAL_KEY)
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { providerRegistry } from "./core/providers.js";
import { AUTH_FILE } from "./paths.js";

// Claude Code credentials location
const CLAUDE_CODE_CREDENTIALS = join(homedir(), ".claude", ".credentials.json");

// Anthropic OAuth configuration
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_AUTH_URL = "https://claude.ai/oauth/authorize";
const OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const OAUTH_SCOPES = ["org:create_api_key", "user:profile", "user:inference"];

// Required beta headers for Claude Code
const BETA_HEADERS = [
  "oauth-2025-04-20",
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "fine-grained-tool-streaming-2025-05-14",
];

// Encryption constants
const ENCRYPTION_ALGO = "aes-256-gcm";
const ENCRYPTION_IV_LEN = 16;
const ENCRYPTION_SALT_LEN = 32;
const ENCRYPTION_KEY_LEN = 32;
// Marker prefix to distinguish encrypted data from plaintext JSON
const ENCRYPTED_PREFIX = "wopr:enc:";

/**
 * Derive an AES-256 key from a passphrase using scrypt.
 */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, ENCRYPTION_KEY_LEN);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a prefixed base64 blob: "wopr:enc:<salt>:<iv>:<tag>:<ciphertext>"
 */
export function encryptData(plaintext: string, passphrase: string): string {
  const salt = randomBytes(ENCRYPTION_SALT_LEN);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(ENCRYPTION_IV_LEN);

  const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const parts = [salt, iv, tag, encrypted].map((b) => b.toString("base64"));
  return `${ENCRYPTED_PREFIX}${parts.join(":")}`;
}

/**
 * Decrypt data produced by encryptData().
 * Returns null if decryption fails (wrong key, corrupt data, etc.).
 */
export function decryptData(blob: string, passphrase: string): string | null {
  if (!blob.startsWith(ENCRYPTED_PREFIX)) return null;

  try {
    const payload = blob.slice(ENCRYPTED_PREFIX.length);
    const [saltB64, ivB64, tagB64, cipherB64] = payload.split(":");
    if (!saltB64 || !ivB64 || !tagB64 || !cipherB64) return null;

    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(cipherB64, "base64");
    const key = deriveKey(passphrase, salt);

    const decipher = createDecipheriv(ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Check whether data on disk is encrypted (starts with the prefix).
 */
export function isEncryptedData(data: string): boolean {
  return data.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Load auth state from environment variables.
 * Returns null if no relevant env vars are set.
 *
 * Priority within env vars:
 *   1. WOPR_CLAUDE_OAUTH_TOKEN  (OAuth token for Claude Max)
 *   2. WOPR_API_KEY             (Anthropic API key)
 *
 * Additionally, WOPR_PLUGIN_CONFIG is a JSON blob that is loaded into the
 * provider registry, keyed by provider ID.
 */
export function loadAuthFromEnv(): AuthState | null {
  // WOPR_CLAUDE_OAUTH_TOKEN — direct OAuth token injection
  const oauthToken = process.env.WOPR_CLAUDE_OAUTH_TOKEN;
  if (oauthToken) {
    return {
      type: "oauth",
      accessToken: oauthToken,
      refreshToken: process.env.WOPR_CLAUDE_REFRESH_TOKEN,
      expiresAt: process.env.WOPR_CLAUDE_OAUTH_EXPIRES_AT
        ? Number(process.env.WOPR_CLAUDE_OAUTH_EXPIRES_AT)
        : undefined,
      updatedAt: Date.now(),
    };
  }

  // WOPR_API_KEY — direct API key injection
  const apiKey = process.env.WOPR_API_KEY;
  if (apiKey) {
    return {
      type: "api_key",
      apiKey,
      updatedAt: Date.now(),
    };
  }

  return null;
}

/**
 * Parse WOPR_PLUGIN_CONFIG env var and load credentials into the provider registry.
 * Expected format: JSON object keyed by provider ID, e.g.:
 *   { "anthropic": "sk-ant-...", "openai": "sk-..." }
 *
 * Returns parsed config or null if env var is not set / invalid.
 */
export function parsePluginConfig(): Record<string, string> | null {
  const raw = process.env.WOPR_PLUGIN_CONFIG;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logger.error("WOPR_PLUGIN_CONFIG must be a JSON object keyed by provider ID");
      return null;
    }
    return parsed as Record<string, string>;
  } catch {
    logger.error("WOPR_PLUGIN_CONFIG is not valid JSON");
    return null;
  }
}

export interface AuthState {
  type: "oauth" | "api_key";
  // OAuth fields
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  // API key field
  apiKey?: string;
  // Metadata
  email?: string;
  updatedAt: number;
}

export interface PKCEChallenge {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

// Generate PKCE challenge for OAuth
export function generatePKCE(): PKCEChallenge {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  return { state, codeVerifier, codeChallenge };
}

// Build the OAuth authorization URL
export function buildAuthUrl(pkce: PKCEChallenge, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES.join(" "),
    state: pkce.state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: "S256",
  });

  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

// Exchange authorization code for tokens
export async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OAUTH_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
  };
}

// Refresh an expired access token
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in || 3600,
  };
}

// Load Claude Code credentials if available
export function loadClaudeCodeCredentials(): AuthState | null {
  if (!existsSync(CLAUDE_CODE_CREDENTIALS)) return null;
  try {
    const data = JSON.parse(readFileSync(CLAUDE_CODE_CREDENTIALS, "utf-8"));
    const oauth = data.claudeAiOauth;
    if (oauth?.accessToken) {
      return {
        type: "oauth",
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt,
        email: oauth.email,
        updatedAt: Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Load auth state
// Priority: env vars > WOPR explicit API key > Claude Code OAuth > WOPR OAuth
// Env vars enable platform/container credential injection without file mounts.
export function loadAuth(): AuthState | null {
  // 1. Environment variable injection (highest priority for platform deployments)
  const envAuth = loadAuthFromEnv();
  if (envAuth) return envAuth;

  // 2. Check WOPR's own auth file (supports encrypted storage)
  let woprAuth: AuthState | null = null;
  if (existsSync(AUTH_FILE)) {
    try {
      const raw = readFileSync(AUTH_FILE, "utf-8");
      const credKey = process.env.WOPR_CREDENTIAL_KEY;

      if (isEncryptedData(raw)) {
        if (!credKey) {
          logger.error("auth.json is encrypted but WOPR_CREDENTIAL_KEY is not set");
        } else {
          const decrypted = decryptData(raw, credKey);
          if (decrypted) {
            woprAuth = JSON.parse(decrypted);
          } else {
            logger.error("Failed to decrypt auth.json — wrong WOPR_CREDENTIAL_KEY?");
          }
        }
      } else {
        woprAuth = JSON.parse(raw);
      }
    } catch {
      // ignore parse errors
    }
  }

  // 3. If WOPR has an explicit API key, prefer it over Claude Code OAuth
  if (woprAuth?.type === "api_key" && woprAuth.apiKey) {
    return woprAuth;
  }

  // 4. Otherwise try Claude Code credentials
  const claudeCodeAuth = loadClaudeCodeCredentials();
  if (claudeCodeAuth) return claudeCodeAuth;

  // 5. Fall back to whatever WOPR auth was saved (e.g. WOPR's own OAuth)
  return woprAuth;
}

// Initialize registry credentials on auth load
export async function loadAuthWithRegistry(): Promise<AuthState | null> {
  // Load provider credentials from registry
  try {
    await providerRegistry.loadCredentials();
  } catch (error) {
    logger.error("Failed to load provider credentials:", error);
  }

  // Load WOPR_PLUGIN_CONFIG env var into registry
  const pluginConfig = parsePluginConfig();
  if (pluginConfig) {
    for (const [providerId, credential] of Object.entries(pluginConfig)) {
      if (typeof credential === "string" && credential.length > 0) {
        try {
          await providerRegistry.setCredential(providerId, credential);
        } catch {
          // Provider may not be registered yet — that's OK for early boot
        }
      }
    }
  }

  // Load standard auth
  const auth = loadAuth();

  // Load Anthropic credentials into registry if present
  if (auth?.type === "api_key" && auth.apiKey) {
    try {
      await storeProviderCredential("anthropic", auth.apiKey);
    } catch (_error) {
      // Silently fail - registry may not be fully initialized yet
    }
  }

  return auth;
}

// Save auth state to disk (encrypts when WOPR_CREDENTIAL_KEY is set)
export function saveAuth(auth: AuthState): void {
  const json = JSON.stringify(auth, null, 2);
  const credKey = process.env.WOPR_CREDENTIAL_KEY;
  if (credKey) {
    writeFileSync(AUTH_FILE, encryptData(json, credKey));
  } else {
    writeFileSync(AUTH_FILE, json);
  }
}

// Clear auth state
export function clearAuth(): void {
  if (existsSync(AUTH_FILE)) {
    writeFileSync(AUTH_FILE, "{}");
  }
}

// Check if token is expired (with 5 min buffer)
export function isTokenExpired(auth: AuthState): boolean {
  if (!auth.expiresAt) return true;
  return Date.now() > auth.expiresAt - 5 * 60 * 1000;
}

// Get valid access token, refreshing if needed
export async function getAccessToken(): Promise<string | null> {
  const auth = loadAuth();
  if (!auth) return null;

  // API key mode - just return it
  if (auth.type === "api_key" && auth.apiKey) {
    return auth.apiKey;
  }

  // OAuth mode
  if (auth.type === "oauth" && auth.accessToken) {
    // Check if expired
    if (isTokenExpired(auth) && auth.refreshToken) {
      try {
        const tokens = await refreshAccessToken(auth.refreshToken);
        auth.accessToken = tokens.accessToken;
        auth.refreshToken = tokens.refreshToken;
        auth.expiresAt = Date.now() + tokens.expiresIn * 1000;
        auth.updatedAt = Date.now();
        saveAuth(auth);
      } catch (err) {
        logger.error("Failed to refresh token:", err);
        return null;
      }
    }
    return auth.accessToken;
  }

  return null;
}

// Get auth type
export function getAuthType(): "oauth" | "api_key" | null {
  const auth = loadAuth();
  return auth?.type || null;
}

// Check if authenticated
export function isAuthenticated(): boolean {
  const auth = loadAuth();
  if (!auth) return false;
  if (auth.type === "api_key") return !!auth.apiKey;
  if (auth.type === "oauth") return !!auth.accessToken;
  return false;
}

// Get beta headers for OAuth requests
export function getBetaHeaders(): string {
  return BETA_HEADERS.join(",");
}

// Save OAuth tokens after successful auth flow
export function saveOAuthTokens(accessToken: string, refreshToken: string, expiresIn: number, email?: string): void {
  const auth: AuthState = {
    type: "oauth",
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    email,
    updatedAt: Date.now(),
  };
  saveAuth(auth);
}

// Save API key
export function saveApiKey(apiKey: string): void {
  const auth: AuthState = {
    type: "api_key",
    apiKey,
    updatedAt: Date.now(),
  };
  saveAuth(auth);
}

/**
 * Store a credential for a specific provider in the registry
 * @param providerId - The provider ID (e.g., "anthropic", "openai", "google")
 * @param credential - The credential string (API key, token, etc.)
 * @throws Error if provider is not registered or credential is invalid
 */
export async function storeProviderCredential(providerId: string, credential: string): Promise<void> {
  try {
    await providerRegistry.setCredential(providerId, credential);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to store credential for provider ${providerId}: ${errorMessage}`);
    throw error;
  }
}

/**
 * Retrieve a credential for a specific provider from the registry
 * @param providerId - The provider ID (e.g., "anthropic", "openai", "google")
 * @returns The credential string, or undefined if not found
 */
export async function getProviderCredential(providerId: string): Promise<string | undefined> {
  try {
    const creds = providerRegistry.getCredential(providerId);
    return creds?.credential;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to retrieve credential for provider ${providerId}: ${errorMessage}`);
    return undefined;
  }
}
