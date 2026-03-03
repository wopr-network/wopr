import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for the OpenAI-compatible API routes.
 *
 * We mock the core dependencies (providerRegistry, sessions, security)
 * and test the Hono routes directly using app.request().
 */

// Mock providerRegistry
vi.mock("../../src/core/providers.js", () => {
  const registry = {
    listProviders: vi.fn(() => [
      { id: "anthropic", name: "Anthropic", available: true, lastChecked: Date.now() },
      { id: "openai", name: "OpenAI", available: false, lastChecked: Date.now() },
    ]),
    getProvider: vi.fn((id: string) => {
      if (id === "anthropic") {
        return {
          provider: {
            id: "anthropic",
            name: "Anthropic",
            defaultModel: "claude-sonnet-4-5-20250929",
            supportedModels: ["claude-sonnet-4-5-20250929"],
          },
          available: true,
          lastChecked: Date.now(),
        };
      }
      return undefined;
    }),
    getCredential: vi.fn(() => ({ providerId: "anthropic", credential: "sk-test" })),
    resolveProvider: vi.fn(async () => ({
      name: "anthropic",
      provider: { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4-5-20250929" },
      client: {
        listModels: vi.fn(async () => ["claude-sonnet-4-5-20250929", "claude-opus-4-20250514"]),
        healthCheck: vi.fn(async () => true),
      },
      credential: "sk-test",
      fallbackChain: [],
    })),
  };
  return {
    providerRegistry: registry,
    ProviderRegistry: { getInstance: () => registry },
  };
});

// Mock config
vi.mock("../../src/core/config.js", () => ({
  config: {
    get: vi.fn(() => ({
      routingStrategy: undefined,
      providers: {},
    })),
  },
}));

// Mock sessions
vi.mock("../../src/core/sessions.js", () => ({
  inject: vi.fn(async (_name: string, _message: string, options?: any) => {
    // Simulate streaming if onStream callback is provided
    if (options?.onStream) {
      options.onStream({ type: "text", content: "Hello" });
      options.onStream({ type: "text", content: " world" });
      options.onStream({ type: "complete", content: "" });
    }
    return { response: "Hello world", sessionId: "test-session-id" };
  }),
  deleteSession: vi.fn(async () => {}),
  setSessionContext: vi.fn(),
  setSessionProvider: vi.fn(),
  getSessionProvider: vi.fn(() => null),
}));

// Mock security
vi.mock("../../src/security/index.js", () => ({
  createInjectionSource: vi.fn((type: string) => ({ type, trustLevel: "owner" })),
}));

// Mock logger (many modules import it)
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { Hono } from "hono";
import { openaiRouter } from "../../src/daemon/routes/openai.js";
import { deleteSession, inject, setSessionContext, setSessionProvider } from "../../src/core/sessions.js";
import { providerRegistry } from "../../src/core/providers.js";
import { config as centralConfig } from "../../src/core/config.js";

function createTestApp() {
  const app = new Hono();
  app.route("/v1", openaiRouter);
  return app;
}

describe("OpenAI Compatibility Layer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Re-apply default mocks after restoreAllMocks
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "anthropic", name: "Anthropic", available: true, lastChecked: Date.now() },
      { id: "openai", name: "OpenAI", available: false, lastChecked: Date.now() },
    ]);
    vi.mocked(providerRegistry.getProvider).mockImplementation((id: string) => {
      if (id === "anthropic") {
        return {
          provider: {
            id: "anthropic",
            name: "Anthropic",
            defaultModel: "claude-sonnet-4-5-20250929",
            supportedModels: ["claude-sonnet-4-5-20250929"],
          } as any,
          available: true,
          lastChecked: Date.now(),
        };
      }
      return undefined;
    });
    vi.mocked(centralConfig.get).mockReturnValue({
      routingStrategy: undefined,
      providers: {},
    } as any);
    vi.mocked(providerRegistry.resolveProvider).mockResolvedValue({
      name: "anthropic",
      provider: { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4-5-20250929" } as any,
      client: {
        listModels: vi.fn(async () => ["claude-sonnet-4-5-20250929", "claude-opus-4-20250514"]),
        healthCheck: vi.fn(async () => true),
        query: vi.fn() as any,
      },
      credential: "sk-test",
      fallbackChain: [],
    });
    vi.mocked(inject).mockImplementation(async (_name: string, _message: string, options?: any) => {
      if (options?.onStream) {
        options.onStream({ type: "text", content: "Hello" });
        options.onStream({ type: "text", content: " world" });
        options.onStream({ type: "complete", content: "" });
      }
      return { response: "Hello world", sessionId: "test-session-id" };
    });
    vi.mocked(deleteSession).mockResolvedValue(undefined);
  });

  // ==========================================================================
  // POST /v1/chat/completions - Non-streaming
  // ==========================================================================

  describe("POST /v1/chat/completions (non-streaming)", () => {
    it("returns a valid chat completion response", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5-20250929",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.object).toBe("chat.completion");
      expect(data.model).toBe("claude-sonnet-4-5-20250929");
      expect(data.choices).toHaveLength(1);
      expect(data.choices[0].message.role).toBe("assistant");
      expect(data.choices[0].message.content).toBe("Hello world");
      expect(data.choices[0].finish_reason).toBe("stop");
      expect(data.id).toMatch(/^chatcmpl-/);
      expect(data.usage).toBeDefined();
    });

    it("passes system prompt from messages to session context", async () => {
      const app = createTestApp();
      await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Hello" },
          ],
        }),
      });

      expect(setSessionContext).toHaveBeenCalledWith(
        expect.stringMatching(/^openai-/),
        "You are a helpful assistant.",
      );
    });

    it("sets session provider config", async () => {
      const app = createTestApp();
      await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5-20250929",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(setSessionProvider).toHaveBeenCalledWith(
        expect.stringMatching(/^openai-/),
        expect.objectContaining({ model: "claude-sonnet-4-5-20250929" }),
      );
    });

    it("calls inject with correct arguments", async () => {
      const app = createTestApp();
      await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "What is 2+2?" }],
        }),
      });

      expect(inject).toHaveBeenCalledWith(
        expect.stringMatching(/^openai-/),
        "What is 2+2?",
        expect.objectContaining({
          silent: true,
          from: "openai-api",
        }),
      );
    });

    it("concatenates multiple user messages", async () => {
      const app = createTestApp();
      await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [
            { role: "user", content: "First question" },
            { role: "assistant", content: "First answer" },
            { role: "user", content: "Follow-up" },
          ],
        }),
      });

      expect(inject).toHaveBeenCalledWith(
        expect.any(String),
        "First question\n\n[Assistant]: First answer\n\nFollow-up",
        expect.any(Object),
      );
    });

    it("cleans up ephemeral session after request completes", async () => {
      const app = createTestApp();
      await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(deleteSession).toHaveBeenCalledWith(
        expect.stringMatching(/^openai-/),
        "request-complete",
      );
    });
  });

  // ==========================================================================
  // Token usage tests
  // ==========================================================================

  describe("token usage", () => {
    it("returns token usage from inject result", async () => {
      vi.mocked(inject).mockResolvedValueOnce({
        response: "Hello world",
        sessionId: "test-session-id",
        usage: { inputTokens: 10, outputTokens: 5 },
      });

      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    });

    it("returns zero usage when provider does not report tokens", async () => {
      vi.mocked(inject).mockResolvedValueOnce({ response: "Hello", sessionId: "test-session-id" });

      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "anthropic", messages: [{ role: "user", content: "Hello" }] }),
      });

      const data = await res.json();
      expect(data.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    });

    it("includes usage in final SSE chunk when stream_options.include_usage is true", async () => {
      vi.mocked(inject).mockImplementation(async (_name: string, _message: string, options?: any) => {
        if (options?.onStream) {
          options.onStream({ type: "text", content: "Hello" });
          options.onStream({ type: "complete", content: "", usage: { inputTokens: 10, outputTokens: 5 } });
        }
        return { response: "Hello", sessionId: "test-session-id", usage: { inputTokens: 10, outputTokens: 5 } };
      });

      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
          stream_options: { include_usage: true },
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const events = text
        .split("\n\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.replace("data: ", "")));

      const finalChunk = events.find((e: any) => e.choices?.[0]?.finish_reason === "stop");
      expect(finalChunk).toBeDefined();
      expect(finalChunk.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    });

    it("returns zero usage in final SSE chunk when include_usage is true but provider reports no usage", async () => {
      vi.mocked(inject).mockImplementation(async (_name: string, _message: string, options?: any) => {
        if (options?.onStream) {
          options.onStream({ type: "text", content: "Hello" });
          options.onStream({ type: "complete", content: "" }); // no usage field
        }
        return { response: "Hello", sessionId: "test-session-id" }; // no usage field
      });

      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
          stream_options: { include_usage: true },
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const events = text
        .split("\n\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.replace("data: ", "")));

      const finalChunk = events.find((e: any) => e.choices?.[0]?.finish_reason === "stop");
      expect(finalChunk).toBeDefined();
      expect(finalChunk.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    });

    it("does NOT include usage in final SSE chunk when stream_options is absent", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "anthropic", messages: [{ role: "user", content: "Hello" }], stream: true }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      const events = text
        .split("\n\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.replace("data: ", "")));

      const finalChunk = events.find((e: any) => e.choices?.[0]?.finish_reason === "stop");
      expect(finalChunk).toBeDefined();
      expect(finalChunk.usage).toBeUndefined();
    });
  });

  // ==========================================================================
  // POST /v1/chat/completions - Validation
  // ==========================================================================

  describe("POST /v1/chat/completions (validation)", () => {
    it("rejects missing model", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("missing_field");
    });

    it("rejects missing messages", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "anthropic" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("missing_field");
    });

    it("rejects empty messages array", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "anthropic", messages: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects invalid JSON body", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.type).toBe("invalid_request_error");
    });

    it("returns 503 when no providers available", async () => {
      vi.mocked(providerRegistry.listProviders).mockReturnValueOnce([]);

      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error.code).toBe("no_providers");
    });
  });

  // ==========================================================================
  // POST /v1/chat/completions - Streaming
  // ==========================================================================

  describe("POST /v1/chat/completions (streaming)", () => {
    it("returns SSE stream with correct format", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      });

      expect(res.status).toBe(200);

      const text = await res.text();

      // Should contain SSE data lines
      expect(text).toContain("data: ");
      // Should end with [DONE]
      expect(text).toContain("data: [DONE]");

      // Parse the SSE events
      const events = text
        .split("\n\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.replace("data: ", "")));

      // Should have text chunks plus a final chunk
      expect(events.length).toBeGreaterThanOrEqual(2);

      // First text chunk
      const textChunks = events.filter((e) => e.choices?.[0]?.delta?.content);
      expect(textChunks.length).toBeGreaterThan(0);
      expect(textChunks[0].object).toBe("chat.completion.chunk");
      expect(textChunks[0].id).toMatch(/^chatcmpl-/);

      // Final chunk has finish_reason: "stop"
      const finalChunk = events[events.length - 1];
      expect(finalChunk.choices[0].finish_reason).toBe("stop");
    });

    it("sets proper SSE headers", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      });

      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
      expect(res.headers.get("Connection")).toBe("keep-alive");

      // Consume the body to avoid warnings
      await res.text();
    });

    it("cleans up ephemeral session after streaming completes", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      });

      // Consume the stream to let it complete
      await res.text();

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(deleteSession).toHaveBeenCalledWith(
        expect.stringMatching(/^openai-/),
        "request-complete",
      );
    });
  });

  // ==========================================================================
  // POST /v1/chat/completions - Error handling
  // ==========================================================================

  describe("POST /v1/chat/completions (error handling)", () => {
    it("returns 500 on inject failure (non-streaming)", async () => {
      vi.mocked(inject).mockRejectedValueOnce(new Error("Provider unavailable"));

      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.message).toBe("Provider unavailable");
      expect(data.error.type).toBe("server_error");
    });

    it("streams error on inject failure (streaming)", async () => {
      vi.mocked(inject).mockRejectedValueOnce(new Error("Provider unavailable"));

      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      });

      expect(res.status).toBe(200); // SSE always starts 200
      const text = await res.text();
      expect(text).toContain("server_error");
      expect(text).toContain("data: [DONE]");
    });
  });

  // ==========================================================================
  // GET /v1/models
  // ==========================================================================

  describe("GET /v1/models", () => {
    it("returns models from available providers", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/models");

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.object).toBe("list");
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeGreaterThan(0);

      // Models should come from the mocked anthropic provider
      const modelIds = data.data.map((m: any) => m.id);
      expect(modelIds).toContain("claude-sonnet-4-5-20250929");
      expect(modelIds).toContain("claude-opus-4-20250514");

      // Each model should have the OpenAI format
      for (const model of data.data) {
        expect(model.object).toBe("model");
        expect(model.owned_by).toBe("anthropic");
        expect(typeof model.created).toBe("number");
      }
    });

    it("returns empty list when no providers available", async () => {
      vi.mocked(providerRegistry.listProviders).mockReturnValue([]);

      const app = createTestApp();
      const res = await app.request("/v1/models");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.object).toBe("list");
      expect(data.data).toEqual([]);
    });
  });

  // ==========================================================================
  // GET /v1/models/:model
  // ==========================================================================

  describe("GET /v1/models/:model", () => {
    it("returns model info for a known model", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/models/anthropic");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("anthropic");
      expect(data.object).toBe("model");
      expect(data.owned_by).toBe("anthropic");
    });

    it("returns 404 for unknown model", async () => {
      // Make resolveProvider fail for unknown models
      vi.mocked(providerRegistry.resolveProvider).mockRejectedValue(new Error("Not found"));

      const app = createTestApp();
      const res = await app.request("/v1/models/unknown-model-xyz");

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe("model_not_found");
    });
  });

  // ==========================================================================
  // POST /v1/chat/completions - Message validation
  // ==========================================================================

  describe("POST /v1/chat/completions (message validation)", () => {
    it("rejects message with non-string, non-array content (number)", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: 42 }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.type).toBe("invalid_request_error");
      expect(data.error.code).toBe("invalid_message");
    });

    it("rejects message with object content (not array)", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: { foo: "bar" } }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("invalid_message");
    });

    it("rejects message with undefined content for user role", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user" }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("invalid_message");
    });

    it("rejects message with invalid role", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "banana", content: "hello" }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("invalid_message");
    });

    it("rejects message with missing role", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ content: "hello" }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("invalid_message");
    });

    it("accepts content array and extracts text parts", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "What is in this image?" },
                { type: "image_url", image_url: { url: "https://example.com/img.png" } },
              ],
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      expect(inject).toHaveBeenCalledWith(
        expect.any(String),
        "What is in this image?",
        expect.any(Object),
      );
    });

    it("accepts null content for assistant messages (treats as empty)", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [
            { role: "assistant", content: null },
            { role: "user", content: "Continue" },
          ],
        }),
      });

      expect(res.status).toBe(200);
    });

    it("includes message index in error for invalid message", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [
            { role: "user", content: "valid" },
            { role: "user", content: 123 },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain("messages[1]");
    });
  });

  // ==========================================================================
  // Routing strategy
  // ==========================================================================

  describe("routing strategy", () => {
    it("respects X-Routing-Strategy header for capable routing", async () => {
      // Set up two available providers
      vi.mocked(providerRegistry.listProviders).mockReturnValue([
        { id: "anthropic", name: "Anthropic", available: true, lastChecked: Date.now() },
        { id: "openai", name: "OpenAI", available: true, lastChecked: Date.now() },
      ]);
      vi.mocked(providerRegistry.getProvider).mockImplementation((id: string) => {
        if (id === "anthropic") {
          return {
            provider: {
              id: "anthropic",
              name: "Anthropic",
              defaultModel: "claude-sonnet-4-5-20250929",
              supportedModels: ["claude-sonnet-4-5-20250929"],
            } as any,
            available: true,
            lastChecked: Date.now(),
          };
        }
        if (id === "openai") {
          return {
            provider: {
              id: "openai",
              name: "OpenAI",
              defaultModel: "gpt-4o",
              supportedModels: ["gpt-4o", "gpt-4o-mini"],
            } as any,
            available: true,
            lastChecked: Date.now(),
          };
        }
        return undefined;
      });

      const app = createTestApp();
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Routing-Strategy": "capable",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(res.status).toBe(200);
      expect(setSessionProvider).toHaveBeenCalledWith(
        expect.stringMatching(/^openai-/),
        expect.objectContaining({ name: "openai" }),
      );
    });

    it("ignores invalid X-Routing-Strategy and falls back to first", async () => {
      const app = createTestApp();
      await app.request("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Routing-Strategy": "invalid-strategy",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      // Falls back to first available: anthropic
      expect(setSessionProvider).toHaveBeenCalledWith(
        expect.stringMatching(/^openai-/),
        expect.objectContaining({ name: "anthropic" }),
      );
    });
  });

  // ==========================================================================
  // Provider resolution
  // ==========================================================================

  describe("provider resolution", () => {
    it("uses provider ID as direct match", async () => {
      const app = createTestApp();
      await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      // When model matches a provider ID directly, it should set provider name without model override
      expect(setSessionProvider).toHaveBeenCalledWith(
        expect.any(String),
        { name: "anthropic" },
      );
    });

    it("passes unknown model string through to provider config", async () => {
      const app = createTestApp();
      await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      // Unknown model falls back to first available provider with model passthrough
      expect(setSessionProvider).toHaveBeenCalledWith(
        expect.any(String),
        { name: "anthropic", model: "gpt-4" },
      );
    });
  });
});
