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
} = await import("../../src/auth.js");

describe("Authentication Module", () => {
  beforeEach(() => {
    mockFs.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
});
