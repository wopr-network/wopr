/**
 * Test mock helpers for WOPR core tests
 */
import { vi } from "vitest";

/**
 * Create a mock filesystem that intercepts fs calls
 * Returns an object where you can set file contents
 */
export function createMockFs() {
  const files = new Map<string, string>();

  return {
    files,
    set(path: string, content: string) {
      files.set(path, content);
    },
    get(path: string) {
      return files.get(path);
    },
    has(path: string) {
      return files.has(path);
    },
    delete(path: string) {
      files.delete(path);
    },
    clear() {
      files.clear();
    },
    existsSync: (path: string) => files.has(path),
    readFileSync: (path: string, _encoding?: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return files.get(path)!;
    },
    writeFileSync: (path: string, content: string) => {
      files.set(path, content);
    },
  };
}

/**
 * Create a mock fetch that returns configurable responses
 */
export function createMockFetch() {
  const responses: Array<{ ok: boolean; body: any; status?: number }> = [];

  const mockFn = vi.fn(async () => {
    const response = responses.shift();
    if (!response) {
      return {
        ok: false,
        status: 500,
        text: async () => "No mock response configured",
        json: async () => ({}),
      };
    }
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      text: async () => (typeof response.body === "string" ? response.body : JSON.stringify(response.body)),
      json: async () => (typeof response.body === "string" ? JSON.parse(response.body) : response.body),
    };
  });

  return {
    fn: mockFn,
    addResponse(ok: boolean, body: any, status?: number) {
      responses.push({ ok, body, status });
    },
    reset() {
      responses.length = 0;
      mockFn.mockClear();
    },
  };
}

/**
 * Auth test fixtures
 */
export const AUTH_FIXTURES = {
  validApiKeyAuth: {
    type: "api_key" as const,
    apiKey: "sk-ant-test-key-123",
    updatedAt: Date.now(),
  },
  validOAuthAuth: {
    type: "oauth" as const,
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: Date.now() + 3600 * 1000,
    email: "test@example.com",
    updatedAt: Date.now(),
  },
  expiredOAuthAuth: {
    type: "oauth" as const,
    accessToken: "expired-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: Date.now() - 1000,
    email: "test@example.com",
    updatedAt: Date.now(),
  },
  claudeCodeCredentials: {
    claudeAiOauth: {
      accessToken: "claude-code-access-token",
      refreshToken: "claude-code-refresh-token",
      expiresAt: Date.now() + 3600 * 1000,
      email: "claude@example.com",
    },
  },
  tokenExchangeResponse: {
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
    expires_in: 3600,
  },
};
