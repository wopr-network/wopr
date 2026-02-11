/**
 * Authentication Module Tests (WOP-12)
 *
 * Tests PKCE generation, OAuth URL building, token exchange/refresh,
 * credential loading priority, and token expiry detection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_FIXTURES, createMockFetch, createMockFs } from "../mocks/index.js";

// Mock the logger to suppress output during tests
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock providers to avoid loading real provider registry
vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    loadCredentials: vi.fn(),
    setCredential: vi.fn(),
    getCredential: vi.fn(),
  },
}));

// Set up filesystem mock before importing auth module
const mockFs = createMockFs();

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    existsSync: (p: string) => mockFs.existsSync(p),
    readFileSync: (p: string, enc?: string) => mockFs.readFileSync(p, enc),
    writeFileSync: (p: string, content: string) => mockFs.writeFileSync(p, content),
  };
});

// Mock paths to use predictable values
vi.mock("../../src/paths.js", () => ({
  AUTH_FILE: "/mock/wopr/auth.json",
  WOPR_HOME: "/mock/wopr",
}));

// Import after mocks are set up
const {
  generatePKCE,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  loadAuth,
  loadAuthFromEnv,
  loadClaudeCodeCredentials,
  saveAuth,
  clearAuth,
  isTokenExpired,
  getAccessToken,
  getAuthType,
  isAuthenticated,
  getBetaHeaders,
  saveOAuthTokens,
  saveApiKey,
  encryptData,
  decryptData,
  isEncryptedData,
  parsePluginConfig,
} = await import("../../src/auth.js");

describe("Authentication Module", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    mockFs.clear();
    // Snapshot env vars we may modify
    for (const key of [
      "WOPR_CLAUDE_OAUTH_TOKEN",
      "WOPR_CLAUDE_REFRESH_TOKEN",
      "WOPR_CLAUDE_OAUTH_EXPIRES_AT",
      "WOPR_API_KEY",
      "WOPR_PLUGIN_CONFIG",
      "WOPR_CREDENTIAL_KEY",
    ]) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore env vars
    for (const [key, val] of Object.entries(envBackup)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  // ========================================================================
  // PKCE Generation
  // ========================================================================
  describe("generatePKCE", () => {
    it("should return state, codeVerifier, and codeChallenge", () => {
      const pkce = generatePKCE();
      expect(pkce).toHaveProperty("state");
      expect(pkce).toHaveProperty("codeVerifier");
      expect(pkce).toHaveProperty("codeChallenge");
    });

    it("should generate URL-safe base64 verifier (43+ chars)", () => {
      const pkce = generatePKCE();
      // base64url of 32 bytes = 43 chars
      expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(pkce.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("should generate challenge as SHA256 of verifier in base64url", async () => {
      const { createHash } = await import("node:crypto");
      const pkce = generatePKCE();
      const expected = createHash("sha256").update(pkce.codeVerifier).digest("base64url");
      expect(pkce.codeChallenge).toBe(expected);
    });

    it("should generate unique values on each call", () => {
      const a = generatePKCE();
      const b = generatePKCE();
      expect(a.state).not.toBe(b.state);
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
    });
  });

  // ========================================================================
  // OAuth URL Building
  // ========================================================================
  describe("buildAuthUrl", () => {
    it("should include client_id, redirect_uri, code_challenge, and scope", () => {
      const pkce = generatePKCE();
      const url = buildAuthUrl(pkce, "http://localhost:9876/callback");

      expect(url).toContain("client_id=");
      expect(url).toContain("redirect_uri=");
      expect(url).toContain("code_challenge=");
      expect(url).toContain("scope=");
      expect(url).toContain("code_challenge_method=S256");
      expect(url).toContain("response_type=code");
    });

    it("should use the correct authorization URL base", () => {
      const pkce = generatePKCE();
      const url = buildAuthUrl(pkce, "http://localhost:9876/callback");
      expect(url).toContain("https://claude.ai/oauth/authorize");
    });

    it("should include the PKCE state parameter", () => {
      const pkce = generatePKCE();
      const url = buildAuthUrl(pkce, "http://localhost:9876/callback");
      expect(url).toContain(`state=${pkce.state}`);
    });
  });

  // ========================================================================
  // Token Exchange
  // ========================================================================
  describe("exchangeCode", () => {
    it("should POST to token endpoint and return tokens", async () => {
      const mockFetch = createMockFetch();
      mockFetch.addResponse(true, AUTH_FIXTURES.tokenExchangeResponse);
      vi.stubGlobal("fetch", mockFetch.fn);

      const result = await exchangeCode("auth-code-123", "verifier-123", "http://localhost:9876/callback");

      expect(result.accessToken).toBe("new-access-token");
      expect(result.refreshToken).toBe("new-refresh-token");
      expect(result.expiresIn).toBe(3600);

      expect(mockFetch.fn).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.fn.mock.calls[0];
      expect(url).toContain("token");
      expect(options.method).toBe("POST");
    });

    it("should throw on failed token exchange", async () => {
      const mockFetch = createMockFetch();
      mockFetch.addResponse(false, "Invalid grant", 400);
      vi.stubGlobal("fetch", mockFetch.fn);

      await expect(exchangeCode("bad-code", "verifier", "http://localhost/callback")).rejects.toThrow(
        "Token exchange failed",
      );
    });
  });

  // ========================================================================
  // Token Refresh
  // ========================================================================
  describe("refreshAccessToken", () => {
    it("should POST refresh_token grant and return new tokens", async () => {
      const mockFetch = createMockFetch();
      mockFetch.addResponse(true, {
        access_token: "refreshed-token",
        refresh_token: "new-refresh",
        expires_in: 7200,
      });
      vi.stubGlobal("fetch", mockFetch.fn);

      const result = await refreshAccessToken("old-refresh-token");

      expect(result.accessToken).toBe("refreshed-token");
      expect(result.refreshToken).toBe("new-refresh");
      expect(result.expiresIn).toBe(7200);
    });

    it("should keep old refresh token if new one not returned", async () => {
      const mockFetch = createMockFetch();
      mockFetch.addResponse(true, {
        access_token: "refreshed-token",
        expires_in: 3600,
      });
      vi.stubGlobal("fetch", mockFetch.fn);

      const result = await refreshAccessToken("keep-this-refresh");
      expect(result.refreshToken).toBe("keep-this-refresh");
    });

    it("should throw on refresh failure", async () => {
      const mockFetch = createMockFetch();
      mockFetch.addResponse(false, "Token expired");
      vi.stubGlobal("fetch", mockFetch.fn);

      await expect(refreshAccessToken("bad-refresh")).rejects.toThrow("Token refresh failed");
    });
  });

  // ========================================================================
  // Token Expiry Detection
  // ========================================================================
  describe("isTokenExpired", () => {
    it("should return true when expiresAt is in the past", () => {
      expect(isTokenExpired({ ...AUTH_FIXTURES.expiredOAuthAuth })).toBe(true);
    });

    it("should return true when within 5 minute buffer", () => {
      const auth = {
        ...AUTH_FIXTURES.validOAuthAuth,
        expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes from now (within 5-min buffer)
      };
      expect(isTokenExpired(auth)).toBe(true);
    });

    it("should return false when token has plenty of time", () => {
      const auth = {
        ...AUTH_FIXTURES.validOAuthAuth,
        expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes from now
      };
      expect(isTokenExpired(auth)).toBe(false);
    });

    it("should return true when expiresAt is undefined", () => {
      const auth = { ...AUTH_FIXTURES.validOAuthAuth, expiresAt: undefined };
      expect(isTokenExpired(auth)).toBe(true);
    });
  });

  // ========================================================================
  // Credential Loading Priority
  // ========================================================================
  describe("loadAuth", () => {
    it("should return null when no auth file exists", () => {
      expect(loadAuth()).toBeNull();
    });

    it("should prefer WOPR API key over Claude Code OAuth", () => {
      // Set up WOPR auth file with API key
      mockFs.set("/mock/wopr/auth.json", JSON.stringify(AUTH_FIXTURES.validApiKeyAuth));

      // Set up Claude Code credentials
      const claudeCredPath = `${process.env.HOME || "/root"}/.claude/.credentials.json`;
      mockFs.set(claudeCredPath, JSON.stringify(AUTH_FIXTURES.claudeCodeCredentials));

      const auth = loadAuth();
      expect(auth?.type).toBe("api_key");
      expect(auth?.apiKey).toBe("sk-ant-test-key-123");
    });

    it("should fall back to Claude Code OAuth when no WOPR API key", async () => {
      // Set up Claude Code credentials
      const { homedir } = await import("node:os");
      const claudeCredPath = `${homedir()}/.claude/.credentials.json`;
      mockFs.set(claudeCredPath, JSON.stringify(AUTH_FIXTURES.claudeCodeCredentials));

      const auth = loadAuth();
      expect(auth?.type).toBe("oauth");
      expect(auth?.accessToken).toBe("claude-code-access-token");
    });

    it("should fall back to WOPR OAuth when no API key and no Claude Code creds", () => {
      mockFs.set("/mock/wopr/auth.json", JSON.stringify(AUTH_FIXTURES.validOAuthAuth));

      const auth = loadAuth();
      expect(auth?.type).toBe("oauth");
      expect(auth?.accessToken).toBe("test-access-token");
    });
  });

  // ========================================================================
  // Save & Clear Auth
  // ========================================================================
  describe("saveAuth / clearAuth", () => {
    it("should save auth state to AUTH_FILE", () => {
      saveAuth(AUTH_FIXTURES.validApiKeyAuth);
      const saved = JSON.parse(mockFs.get("/mock/wopr/auth.json")!);
      expect(saved.type).toBe("api_key");
      expect(saved.apiKey).toBe("sk-ant-test-key-123");
    });

    it("should clear auth by writing empty object", () => {
      mockFs.set("/mock/wopr/auth.json", JSON.stringify(AUTH_FIXTURES.validApiKeyAuth));
      clearAuth();
      expect(mockFs.get("/mock/wopr/auth.json")).toBe("{}");
    });
  });

  // ========================================================================
  // Convenience Functions
  // ========================================================================
  describe("getAuthType", () => {
    it("should return 'api_key' for API key auth", () => {
      mockFs.set("/mock/wopr/auth.json", JSON.stringify(AUTH_FIXTURES.validApiKeyAuth));
      expect(getAuthType()).toBe("api_key");
    });

    it("should return 'oauth' for OAuth auth", () => {
      mockFs.set("/mock/wopr/auth.json", JSON.stringify(AUTH_FIXTURES.validOAuthAuth));
      expect(getAuthType()).toBe("oauth");
    });

    it("should return null when no auth", () => {
      expect(getAuthType()).toBeNull();
    });
  });

  describe("isAuthenticated", () => {
    it("should return true for valid API key", () => {
      mockFs.set("/mock/wopr/auth.json", JSON.stringify(AUTH_FIXTURES.validApiKeyAuth));
      expect(isAuthenticated()).toBe(true);
    });

    it("should return true for valid OAuth", () => {
      mockFs.set("/mock/wopr/auth.json", JSON.stringify(AUTH_FIXTURES.validOAuthAuth));
      expect(isAuthenticated()).toBe(true);
    });

    it("should return false when no auth", () => {
      expect(isAuthenticated()).toBe(false);
    });
  });

  describe("getBetaHeaders", () => {
    it("should return comma-separated beta header string", () => {
      const headers = getBetaHeaders();
      expect(headers).toContain("oauth-2025-04-20");
      expect(headers).toContain("claude-code-20250219");
      expect(headers.split(",").length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("saveOAuthTokens", () => {
    it("should save OAuth tokens with computed expiresAt", () => {
      const before = Date.now();
      saveOAuthTokens("access-tok", "refresh-tok", 3600, "user@example.com");
      const after = Date.now();

      const saved = JSON.parse(mockFs.get("/mock/wopr/auth.json")!);
      expect(saved.type).toBe("oauth");
      expect(saved.accessToken).toBe("access-tok");
      expect(saved.refreshToken).toBe("refresh-tok");
      expect(saved.email).toBe("user@example.com");
      expect(saved.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
      expect(saved.expiresAt).toBeLessThanOrEqual(after + 3600 * 1000);
    });
  });

  describe("saveApiKey", () => {
    it("should save API key auth state", () => {
      saveApiKey("sk-ant-my-key");
      const saved = JSON.parse(mockFs.get("/mock/wopr/auth.json")!);
      expect(saved.type).toBe("api_key");
      expect(saved.apiKey).toBe("sk-ant-my-key");
    });
  });

  // ========================================================================
  // Environment Variable Credential Injection (WOP-68)
  // ========================================================================
  describe("loadAuthFromEnv", () => {
    it("should return null when no env vars set", () => {
      expect(loadAuthFromEnv()).toBeNull();
    });

    it("should return OAuth state from WOPR_CLAUDE_OAUTH_TOKEN", () => {
      process.env.WOPR_CLAUDE_OAUTH_TOKEN = "env-oauth-token";
      const auth = loadAuthFromEnv();
      expect(auth).not.toBeNull();
      expect(auth!.type).toBe("oauth");
      expect(auth!.accessToken).toBe("env-oauth-token");
    });

    it("should include refresh token and expiresAt from env", () => {
      process.env.WOPR_CLAUDE_OAUTH_TOKEN = "env-oauth-token";
      process.env.WOPR_CLAUDE_REFRESH_TOKEN = "env-refresh";
      process.env.WOPR_CLAUDE_OAUTH_EXPIRES_AT = "9999999999999";
      const auth = loadAuthFromEnv();
      expect(auth!.refreshToken).toBe("env-refresh");
      expect(auth!.expiresAt).toBe(9999999999999);
    });

    it("should return API key state from WOPR_API_KEY", () => {
      process.env.WOPR_API_KEY = "sk-ant-env-key";
      const auth = loadAuthFromEnv();
      expect(auth).not.toBeNull();
      expect(auth!.type).toBe("api_key");
      expect(auth!.apiKey).toBe("sk-ant-env-key");
    });

    it("should prefer WOPR_CLAUDE_OAUTH_TOKEN over WOPR_API_KEY", () => {
      process.env.WOPR_CLAUDE_OAUTH_TOKEN = "env-oauth";
      process.env.WOPR_API_KEY = "env-api-key";
      const auth = loadAuthFromEnv();
      expect(auth!.type).toBe("oauth");
      expect(auth!.accessToken).toBe("env-oauth");
    });
  });

  describe("loadAuth with env vars", () => {
    it("should prefer env var auth over file-based auth", () => {
      process.env.WOPR_API_KEY = "sk-env-priority";
      mockFs.set("/mock/wopr/auth.json", JSON.stringify(AUTH_FIXTURES.validApiKeyAuth));

      const auth = loadAuth();
      expect(auth!.apiKey).toBe("sk-env-priority");
    });

    it("should prefer env var OAuth over Claude Code credentials", async () => {
      process.env.WOPR_CLAUDE_OAUTH_TOKEN = "env-oauth-wins";
      const { homedir } = await import("node:os");
      const claudeCredPath = `${homedir()}/.claude/.credentials.json`;
      mockFs.set(claudeCredPath, JSON.stringify(AUTH_FIXTURES.claudeCodeCredentials));

      const auth = loadAuth();
      expect(auth!.type).toBe("oauth");
      expect(auth!.accessToken).toBe("env-oauth-wins");
    });

    it("should fall through to file auth when no env vars set", () => {
      mockFs.set("/mock/wopr/auth.json", JSON.stringify(AUTH_FIXTURES.validApiKeyAuth));
      const auth = loadAuth();
      expect(auth!.apiKey).toBe("sk-ant-test-key-123");
    });
  });

  // ========================================================================
  // Encryption at Rest (WOP-68)
  // ========================================================================
  describe("encryptData / decryptData", () => {
    it("should round-trip encrypt and decrypt", () => {
      const plaintext = '{"type":"api_key","apiKey":"sk-ant-secret"}';
      const passphrase = "test-passphrase-123";
      const encrypted = encryptData(plaintext, passphrase);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.startsWith("wopr:enc:")).toBe(true);

      const decrypted = decryptData(encrypted, passphrase);
      expect(decrypted).toBe(plaintext);
    });

    it("should return null for wrong passphrase", () => {
      const encrypted = encryptData("secret-data", "correct-key");
      const result = decryptData(encrypted, "wrong-key");
      expect(result).toBeNull();
    });

    it("should return null for non-encrypted data", () => {
      const result = decryptData('{"type":"api_key"}', "any-key");
      expect(result).toBeNull();
    });

    it("should return null for malformed encrypted data", () => {
      const result = decryptData("wopr:enc:bad-data", "any-key");
      expect(result).toBeNull();
    });

    it("should produce different ciphertexts for same input (random salt/IV)", () => {
      const plaintext = "same-input";
      const key = "same-key";
      const a = encryptData(plaintext, key);
      const b = encryptData(plaintext, key);
      expect(a).not.toBe(b);
    });
  });

  describe("isEncryptedData", () => {
    it("should return true for encrypted blobs", () => {
      expect(isEncryptedData("wopr:enc:abc:def:ghi:jkl")).toBe(true);
    });

    it("should return false for plaintext JSON", () => {
      expect(isEncryptedData('{"type":"api_key"}')).toBe(false);
    });
  });

  describe("saveAuth with encryption", () => {
    it("should encrypt auth.json when WOPR_CREDENTIAL_KEY is set", () => {
      process.env.WOPR_CREDENTIAL_KEY = "my-secret-key";
      saveAuth(AUTH_FIXTURES.validApiKeyAuth);

      const raw = mockFs.get("/mock/wopr/auth.json")!;
      expect(raw.startsWith("wopr:enc:")).toBe(true);
      // Should not contain plaintext API key
      expect(raw).not.toContain("sk-ant-test-key-123");
    });

    it("should save plaintext when WOPR_CREDENTIAL_KEY is not set", () => {
      saveAuth(AUTH_FIXTURES.validApiKeyAuth);
      const raw = mockFs.get("/mock/wopr/auth.json")!;
      expect(raw.startsWith("{")).toBe(true);
      const parsed = JSON.parse(raw);
      expect(parsed.apiKey).toBe("sk-ant-test-key-123");
    });
  });

  describe("loadAuth with encrypted auth.json", () => {
    it("should decrypt auth.json when WOPR_CREDENTIAL_KEY is set", () => {
      const passphrase = "decrypt-test-key";
      const json = JSON.stringify(AUTH_FIXTURES.validApiKeyAuth);
      const encrypted = encryptData(json, passphrase);
      mockFs.set("/mock/wopr/auth.json", encrypted);

      process.env.WOPR_CREDENTIAL_KEY = passphrase;
      const auth = loadAuth();
      expect(auth!.type).toBe("api_key");
      expect(auth!.apiKey).toBe("sk-ant-test-key-123");
    });

    it("should return null when encrypted but no key provided", () => {
      const encrypted = encryptData(JSON.stringify(AUTH_FIXTURES.validApiKeyAuth), "some-key");
      mockFs.set("/mock/wopr/auth.json", encrypted);

      // No WOPR_CREDENTIAL_KEY set
      const auth = loadAuth();
      expect(auth).toBeNull();
    });

    it("should return null when encrypted with wrong key", () => {
      const encrypted = encryptData(JSON.stringify(AUTH_FIXTURES.validApiKeyAuth), "correct-key");
      mockFs.set("/mock/wopr/auth.json", encrypted);

      process.env.WOPR_CREDENTIAL_KEY = "wrong-key";
      const auth = loadAuth();
      expect(auth).toBeNull();
    });
  });

  // ========================================================================
  // Plugin Config Env Var (WOP-68)
  // ========================================================================
  describe("parsePluginConfig", () => {
    it("should return null when WOPR_PLUGIN_CONFIG is not set", () => {
      expect(parsePluginConfig()).toBeNull();
    });

    it("should parse valid JSON object", () => {
      process.env.WOPR_PLUGIN_CONFIG = JSON.stringify({
        anthropic: "sk-ant-123",
        openai: "sk-openai-456",
      });
      const config = parsePluginConfig();
      expect(config).toEqual({
        anthropic: "sk-ant-123",
        openai: "sk-openai-456",
      });
    });

    it("should return null for invalid JSON", () => {
      process.env.WOPR_PLUGIN_CONFIG = "not-json";
      expect(parsePluginConfig()).toBeNull();
    });

    it("should return null for JSON array", () => {
      process.env.WOPR_PLUGIN_CONFIG = '["a","b"]';
      expect(parsePluginConfig()).toBeNull();
    });

    it("should return null for JSON string", () => {
      process.env.WOPR_PLUGIN_CONFIG = '"just-a-string"';
      expect(parsePluginConfig()).toBeNull();
    });
  });
});
