/**
 * WoprClient Tests (WOP-1413)
 *
 * Unit tests for the HTTP client in src/client.ts.
 * Covers all public methods with happy-path and error-path tests
 * using mocked fetch and getToken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/daemon/auth-token.js", () => ({
  getToken: vi.fn(() => "test-token-abc"),
}));

import { WoprClient } from "../../src/client.js";
import { getToken } from "../../src/daemon/auth-token.js";

const mockedGetToken = vi.mocked(getToken);

function mockFetchResponse(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

function mockFetchJsonError(status: number, errorBody: { error: string }): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(errorBody),
  });
}

function mockFetchNonJsonError(status: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockRejectedValue(new Error("not json")),
  });
}

let client: WoprClient;

beforeEach(() => {
  client = new WoprClient({ baseUrl: "http://localhost:9999", token: "explicit-token" });
  mockedGetToken.mockReturnValue("test-token-abc");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WoprClient", () => {
  // --- Constructor & Auth ---
  describe("constructor", () => {
    it("should use default URL when no config provided", async () => {
      const fetchMock = mockFetchResponse({ status: "ok" });
      vi.stubGlobal("fetch", fetchMock);
      const defaultClient = new WoprClient();
      await defaultClient.isRunning();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:7437/health",
        expect.any(Object),
      );
    });

    it("should use custom baseUrl from config", async () => {
      const fetchMock = mockFetchResponse({ status: "ok" });
      vi.stubGlobal("fetch", fetchMock);
      await client.isRunning();
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:9999/health",
        expect.any(Object),
      );
    });
  });

  describe("auth headers", () => {
    it("should send Authorization header with explicit token", async () => {
      const fetchMock = mockFetchResponse({ sessions: [] });
      vi.stubGlobal("fetch", fetchMock);
      await client.getSessions();
      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBe("Bearer explicit-token");
    });

    it("should fall back to getToken() when no explicit token", async () => {
      const noTokenClient = new WoprClient({ baseUrl: "http://localhost:9999" });
      mockedGetToken.mockReturnValue("disk-token");
      const fetchMock = mockFetchResponse({ sessions: [] });
      vi.stubGlobal("fetch", fetchMock);
      await noTokenClient.getSessions();
      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBe("Bearer disk-token");
    });

    it("should send no Authorization header when no token available", async () => {
      const noTokenClient = new WoprClient({ baseUrl: "http://localhost:9999" });
      mockedGetToken.mockReturnValue(null);
      const fetchMock = mockFetchResponse({ sessions: [] });
      vi.stubGlobal("fetch", fetchMock);
      await noTokenClient.getSessions();
      const callArgs = fetchMock.mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBeUndefined();
    });
  });

  describe("request() error handling", () => {
    it("should throw with error message from JSON response", async () => {
      vi.stubGlobal("fetch", mockFetchJsonError(403, { error: "Forbidden" }));
      await expect(client.getSessions()).rejects.toThrow("Forbidden");
    });

    it("should throw with HTTP status when JSON body has no error field", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({}),
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(client.getSessions()).rejects.toThrow("HTTP 500");
    });

    it("should throw 'Request failed' when error response is not JSON", async () => {
      vi.stubGlobal("fetch", mockFetchNonJsonError(502));
      await expect(client.getSessions()).rejects.toThrow("Request failed");
    });

    it("should send Content-Type application/json on all requests", async () => {
      const fetchMock = mockFetchResponse({ sessions: [] });
      vi.stubGlobal("fetch", fetchMock);
      await client.getSessions();
      expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
    });
  });

  // --- isRunning ---
  describe("isRunning()", () => {
    it("should return true when /health succeeds", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ status: "ok" }));
      expect(await client.isRunning()).toBe(true);
    });

    it("should return false when fetch throws (connection refused)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      expect(await client.isRunning()).toBe(false);
    });

    it("should return false when server returns non-2xx", async () => {
      vi.stubGlobal("fetch", mockFetchJsonError(500, { error: "down" }));
      expect(await client.isRunning()).toBe(false);
    });
  });

  // --- getIdentity ---
  describe("getIdentity()", () => {
    it("should return identity data on success", async () => {
      const identity = { publicKey: "abc123", name: "myNode" };
      vi.stubGlobal("fetch", mockFetchResponse(identity));
      expect(await client.getIdentity()).toEqual(identity);
    });

    it("should reject when request fails (missing await in implementation)", async () => {
      // Note: getIdentity() does `return this.request(...)` without await,
      // so the catch block never fires — the rejection propagates to the caller.
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));
      await expect(client.getIdentity()).rejects.toThrow("fail");
    });
  });

  // --- getProfile ---
  describe("getProfile()", () => {
    it("should return profile data on success", async () => {
      const profile = { displayName: "WOPR" };
      vi.stubGlobal("fetch", mockFetchResponse(profile));
      expect(await client.getProfile()).toEqual(profile);
    });

    it("should reject when request fails (missing await in implementation)", async () => {
      // Note: getProfile() does `return this.request(...)` without await,
      // so the catch block never fires — the rejection propagates to the caller.
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));
      await expect(client.getProfile()).rejects.toThrow("fail");
    });
  });

  // --- Sessions ---
  describe("sessions", () => {
    it("getSessions() should return parsed sessions array", async () => {
      const sessions = [
        { name: "s1", hasContext: true },
        { name: "s2", hasContext: false },
      ];
      vi.stubGlobal("fetch", mockFetchResponse({ sessions }));
      expect(await client.getSessions()).toEqual(sessions);
    });

    it("createSession() should POST name and context", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.createSession("mySession", "some context");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:9999/sessions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "mySession", context: "some context" }),
        }),
      );
    });

    it("createSession() should work without context", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.createSession("noCtx");
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ name: "noCtx", context: undefined });
    });

    it("deleteSession() should DELETE with encoded name", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.deleteSession("my/session");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/sessions/my%2Fsession");
      expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    });

    it("getSession() should GET with encoded name", async () => {
      const session = { name: "test", id: "abc", context: "ctx" };
      vi.stubGlobal("fetch", mockFetchResponse(session));
      expect(await client.getSession("test")).toEqual(session);
    });

    it("getConversationHistory() should include limit query param when provided", async () => {
      const fetchMock = mockFetchResponse({ name: "s", entries: [], count: 0 });
      vi.stubGlobal("fetch", fetchMock);
      await client.getConversationHistory("s", 10);
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/sessions/s/conversation?limit=10");
    });

    it("getConversationHistory() should omit limit query param when not provided", async () => {
      const fetchMock = mockFetchResponse({ name: "s", entries: [], count: 0 });
      vi.stubGlobal("fetch", fetchMock);
      await client.getConversationHistory("s");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/sessions/s/conversation");
    });
  });

  // --- inject ---
  describe("inject()", () => {
    it("should POST message to correct URL (non-streaming)", async () => {
      const result = { sessionId: "s1", response: "hello" };
      const fetchMock = mockFetchResponse(result);
      vi.stubGlobal("fetch", fetchMock);
      const res = await client.inject("mySession", "hi there");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/sessions/mySession/inject");
      expect(fetchMock.mock.calls[0][1].method).toBe("POST");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: "hi there" });
      expect(res).toEqual(result);
    });

    it("should include from and silent options in body", async () => {
      const fetchMock = mockFetchResponse({ sessionId: "s1", response: "ok" });
      vi.stubGlobal("fetch", fetchMock);
      await client.inject("s", "msg", undefined, { from: "discord", silent: true });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ message: "msg", from: "discord", silent: true });
    });

    it("should handle SSE streaming when onStream callback provided", async () => {
      const events: unknown[] = [];
      const onStream = vi.fn((msg: unknown) => events.push(msg));

      const sseData = [
        'data: {"type":"text","content":"Hello"}\n\n',
        'data: {"type":"text","content":" world"}\n\n',
        'data: {"type":"complete","sessionId":"sess-1"}\n\n',
      ].join("");

      const encoder = new TextEncoder();
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: encoder.encode(sseData) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await client.inject("s1", "hello", onStream);

      // Verify Accept header for SSE
      expect(fetchMock.mock.calls[0][1].headers.Accept).toBe("text/event-stream");

      // onStream called for each SSE event
      expect(onStream).toHaveBeenCalledTimes(3);
      expect(onStream).toHaveBeenCalledWith(expect.objectContaining({ type: "text", content: "Hello" }));
      expect(onStream).toHaveBeenCalledWith(expect.objectContaining({ type: "complete", sessionId: "sess-1" }));

      // Result assembled from text chunks
      expect(result.response).toBe("Hello world");
      expect(result.sessionId).toBe("sess-1");
    });

    it("should throw on non-2xx response in streaming mode", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ error: "Server error" }),
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(client.inject("s1", "msg", vi.fn())).rejects.toThrow("Server error");
    });

    it("should throw when response body is null in streaming mode", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(client.inject("s1", "msg", vi.fn())).rejects.toThrow("No response body");
    });

    it("should ignore malformed SSE JSON lines", async () => {
      const onStream = vi.fn();
      const sseData = 'data: not-json\ndata: {"type":"text","content":"ok"}\n\n';
      const encoder = new TextEncoder();
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: encoder.encode(sseData) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          body: { getReader: () => mockReader },
        }),
      );
      const result = await client.inject("s", "m", onStream);
      // Only the valid JSON line triggers onStream
      expect(onStream).toHaveBeenCalledTimes(1);
      expect(result.response).toBe("ok");
    });
  });

  // --- Crons ---
  describe("crons", () => {
    it("getCrons() should return crons array", async () => {
      const crons = [{ name: "c1", schedule: "* * * * *", session: "s", message: "hi" }];
      vi.stubGlobal("fetch", mockFetchResponse({ crons }));
      expect(await client.getCrons()).toEqual(crons);
    });

    it("addCron() should POST cron data", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.addCron({ name: "c1", schedule: "0 * * * *", session: "s", message: "go" });
      expect(fetchMock.mock.calls[0][1].method).toBe("POST");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/crons");
    });

    it("removeCron() should DELETE with encoded name", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.removeCron("my cron");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/crons/my%20cron");
      expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    });
  });

  // --- Auth ---
  describe("getAuthStatus()", () => {
    it("should return auth status", async () => {
      const status = { authenticated: true, type: "bearer", email: "a@b.com" };
      vi.stubGlobal("fetch", mockFetchResponse(status));
      expect(await client.getAuthStatus()).toEqual(status);
    });
  });

  // --- Plugins ---
  describe("plugins", () => {
    it("getPlugins() should return plugins array", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ plugins: [{ name: "p1" }] }));
      expect(await client.getPlugins()).toEqual([{ name: "p1" }]);
    });

    it("installPlugin() should POST source", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.installPlugin("npm:my-plugin");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ source: "npm:my-plugin" });
    });

    it("removePlugin() should DELETE with encoded name", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.removePlugin("my-plugin");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/plugins/my-plugin");
      expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    });

    it("enablePlugin() should POST to /enable", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.enablePlugin("p");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/plugins/p/enable");
    });

    it("disablePlugin() should POST to /disable", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.disablePlugin("p");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/plugins/p/disable");
    });

    it("reloadPlugin() should POST to /reload", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.reloadPlugin("p");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/plugins/p/reload");
    });

    it("searchPlugins() should GET with encoded query", async () => {
      const fetchMock = mockFetchResponse({ results: [{ name: "found" }] });
      vi.stubGlobal("fetch", fetchMock);
      const results = await client.searchPlugins("my query");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/plugins/search?q=my%20query");
      expect(results).toEqual([{ name: "found" }]);
    });

    it("getPluginRegistries() should return registries", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ registries: [{ name: "r", url: "http://r" }] }));
      expect(await client.getPluginRegistries()).toEqual([{ name: "r", url: "http://r" }]);
    });

    it("addPluginRegistry() should POST name and url", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.addPluginRegistry("r", "http://r");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "r", url: "http://r" });
    });

    it("removePluginRegistry() should DELETE", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.removePluginRegistry("r");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/plugins/registries/r");
      expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    });
  });

  // --- Skills ---
  describe("skills", () => {
    it("getSkills() should return skills array", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ skills: [{ name: "s1" }] }));
      expect(await client.getSkills()).toEqual([{ name: "s1" }]);
    });

    it("installSkill() should POST source and name", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.installSkill("http://example.com/skill", "mySkill");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        source: "http://example.com/skill",
        name: "mySkill",
      });
    });

    it("removeSkill() should DELETE", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.removeSkill("s");
      expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    });

    it("createSkill() should POST name and description", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.createSkill("newSkill", "A skill");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/skills/create");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "newSkill", description: "A skill" });
    });

    it("searchSkills() should GET with encoded query", async () => {
      const fetchMock = mockFetchResponse({ results: [] });
      vi.stubGlobal("fetch", fetchMock);
      await client.searchSkills("test");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/skills/search?q=test");
    });

    it("clearSkillCache() should DELETE /skills/cache", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.clearSkillCache();
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/skills/cache");
      expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    });
  });

  // --- Config ---
  describe("config", () => {
    it("getConfig() should return config object", async () => {
      const config = { model: "claude", maxTokens: 1000 };
      vi.stubGlobal("fetch", mockFetchResponse(config));
      expect(await client.getConfig()).toEqual(config);
    });

    it("getConfigValue() should return unwrapped value", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ key: "model", value: "claude" }));
      expect(await client.getConfigValue("model")).toBe("claude");
    });

    it("setConfigValue() should PUT value", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.setConfigValue("model", "gpt-4");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/config/model");
      expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ value: "gpt-4" });
    });

    it("resetConfig() should DELETE /config", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.resetConfig();
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/config");
      expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    });
  });

  // --- Providers ---
  describe("providers", () => {
    it("getProviders() should return providers array", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ providers: [{ id: "anthropic" }] }));
      expect(await client.getProviders()).toEqual([{ id: "anthropic" }]);
    });

    it("addProviderCredential() should POST", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.addProviderCredential("openai", "sk-xxx");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ providerId: "openai", credential: "sk-xxx" });
    });

    it("removeProviderCredential() should DELETE", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.removeProviderCredential("openai");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/providers/openai");
    });

    it("checkProvidersHealth() should POST to /providers/health", async () => {
      const fetchMock = mockFetchResponse({ healthy: true });
      vi.stubGlobal("fetch", fetchMock);
      await client.checkProvidersHealth();
      expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    });

    it("setSessionProvider() should PUT provider and fallback", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.setSessionProvider("s1", "anthropic", ["openai"]);
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/sessions/s1/provider");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ providerId: "anthropic", fallback: ["openai"] });
    });
  });

  // --- Peers ---
  describe("peers", () => {
    it("getPeers() should return peers array", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ peers: [{ id: "p1" }] }));
      expect(await client.getPeers()).toEqual([{ id: "p1" }]);
    });

    it("getAccessGrants() should return grants array", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ grants: [{ peer: "p1" }] }));
      expect(await client.getAccessGrants()).toEqual([{ peer: "p1" }]);
    });

    it("revokePeer() should DELETE", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.revokePeer("peer-1");
      expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    });

    it("namePeer() should PUT name", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.namePeer("p1", "My Peer");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/peers/p1/name");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "My Peer" });
    });

    it("injectPeer() should POST peer, session, message", async () => {
      const fetchMock = mockFetchResponse({ code: 200 });
      vi.stubGlobal("fetch", fetchMock);
      const res = await client.injectPeer("p1", "s1", "hello");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ peer: "p1", session: "s1", message: "hello" });
      expect(res).toEqual({ code: 200 });
    });

    it("logMessage() should POST to /sessions/:name/log", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.logMessage("s1", "a log message", "discord");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/sessions/s1/log");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: "a log message", from: "discord" });
    });

    it("logMessage() should default from to 'cli'", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.logMessage("s1", "msg");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).from).toBe("cli");
    });
  });

  // --- Discovery ---
  describe("discovery", () => {
    it("joinTopic() should POST topic", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.joinTopic("general");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ topic: "general" });
    });

    it("leaveTopic() should POST topic", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.leaveTopic("general");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/discover/leave");
    });

    it("getTopics() should return topics array", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ topics: ["a", "b"] }));
      expect(await client.getTopics()).toEqual(["a", "b"]);
    });

    it("getDiscoveredPeers() should include topic param when provided", async () => {
      const fetchMock = mockFetchResponse({ peers: [] });
      vi.stubGlobal("fetch", fetchMock);
      await client.getDiscoveredPeers("t1");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/discover/peers?topic=t1");
    });

    it("getDiscoveredPeers() should omit topic param when not provided", async () => {
      const fetchMock = mockFetchResponse({ peers: [] });
      vi.stubGlobal("fetch", fetchMock);
      await client.getDiscoveredPeers();
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/discover/peers");
    });

    it("requestConnection() should POST peerId", async () => {
      const fetchMock = mockFetchResponse({ code: 200, sessions: ["s1"] });
      vi.stubGlobal("fetch", fetchMock);
      const res = await client.requestConnection("peer-abc");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ peerId: "peer-abc" });
      expect(res.code).toBe(200);
    });

    it("setProfile() should PUT content", async () => {
      const fetchMock = mockFetchResponse({ ok: true });
      vi.stubGlobal("fetch", fetchMock);
      await client.setProfile({ displayName: "W" });
      expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    });
  });

  // --- Identity ---
  describe("identity", () => {
    it("initIdentity() should POST with force flag", async () => {
      const fetchMock = mockFetchResponse({ publicKey: "abc" });
      vi.stubGlobal("fetch", fetchMock);
      await client.initIdentity(true);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ force: true });
    });

    it("rotateIdentity() should POST with broadcast flag", async () => {
      const fetchMock = mockFetchResponse({ publicKey: "new" });
      vi.stubGlobal("fetch", fetchMock);
      await client.rotateIdentity(true);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ broadcast: true });
    });

    it("createInvite() should POST peerPubkey and sessions", async () => {
      const fetchMock = mockFetchResponse({ token: "invite-token" });
      vi.stubGlobal("fetch", fetchMock);
      const res = await client.createInvite("pubkey123", ["s1", "s2"]);
      expect(res.token).toBe("invite-token");
    });

    it("claimInvite() should POST token", async () => {
      const fetchMock = mockFetchResponse({ code: 200, peerKey: "pk" });
      vi.stubGlobal("fetch", fetchMock);
      const res = await client.claimInvite("invite-token");
      expect(res.code).toBe(200);
    });
  });

  // --- Middleware ---
  describe("middleware", () => {
    it("getMiddlewares() should return middlewares array", async () => {
      const mw = [{ name: "m1", priority: 1, enabled: true, hasIncoming: true, hasOutgoing: false }];
      vi.stubGlobal("fetch", mockFetchResponse({ middlewares: mw }));
      expect(await client.getMiddlewares()).toEqual(mw);
    });

    it("getMiddlewareChain() should return chain array", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetchResponse({ chain: [{ name: "m1", priority: 1, enabled: true }] }),
      );
      expect(await client.getMiddlewareChain()).toEqual([{ name: "m1", priority: 1, enabled: true }]);
    });

    it("getMiddleware() should GET by name", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetchResponse({ name: "m1", priority: 1, enabled: true, hasIncoming: true, hasOutgoing: false }),
      );
      const mw = await client.getMiddleware("m1");
      expect(mw.name).toBe("m1");
    });

    it("enableMiddleware() should POST to /enable", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.enableMiddleware("m1");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/middleware/m1/enable");
    });

    it("disableMiddleware() should POST to /disable", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.disableMiddleware("m1");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/middleware/m1/disable");
    });

    it("setMiddlewarePriority() should PUT priority", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.setMiddlewarePriority("m1", 5);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ priority: 5 });
    });
  });

  // --- Context Providers ---
  describe("context providers", () => {
    it("getContextProviders() should return providers array", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetchResponse({ providers: [{ name: "cp1", priority: 1, enabled: true }] }),
      );
      expect(await client.getContextProviders()).toEqual([{ name: "cp1", priority: 1, enabled: true }]);
    });

    it("getContextProvider() should GET by name", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ name: "cp1", priority: 1, enabled: true }));
      expect((await client.getContextProvider("cp1")).name).toBe("cp1");
    });

    it("enableContextProvider() should POST", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.enableContextProvider("cp1");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/middleware/context/cp1/enable");
    });

    it("disableContextProvider() should POST", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.disableContextProvider("cp1");
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/middleware/context/cp1/disable");
    });

    it("setContextProviderPriority() should PUT priority", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.setContextProviderPriority("cp1", 3);
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/middleware/context/cp1/priority");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ priority: 3 });
    });
  });

  // --- initSessionDocs ---
  describe("initSessionDocs()", () => {
    it("should POST options to /init-docs", async () => {
      const fetchMock = mockFetchResponse({ created: ["CLAUDE.md"] });
      vi.stubGlobal("fetch", fetchMock);
      const res = await client.initSessionDocs("s1", { agentName: "wopr", userName: "alice" });
      expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:9999/sessions/s1/init-docs");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ agentName: "wopr", userName: "alice" });
      expect(res.created).toEqual(["CLAUDE.md"]);
    });

    it("should POST empty object when no options", async () => {
      const fetchMock = mockFetchResponse({ created: [] });
      vi.stubGlobal("fetch", fetchMock);
      await client.initSessionDocs("s1");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
    });
  });

  // --- Skill Registries ---
  describe("skill registries", () => {
    it("getSkillRegistries() should return registries", async () => {
      vi.stubGlobal("fetch", mockFetchResponse({ registries: [{ name: "r", url: "http://r" }] }));
      expect(await client.getSkillRegistries()).toEqual([{ name: "r", url: "http://r" }]);
    });

    it("addSkillRegistry() should POST", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.addSkillRegistry("r", "http://r");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "r", url: "http://r" });
    });

    it("removeSkillRegistry() should DELETE", async () => {
      const fetchMock = mockFetchResponse({});
      vi.stubGlobal("fetch", fetchMock);
      await client.removeSkillRegistry("r");
      expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    });
  });
}); // end WoprClient describe
