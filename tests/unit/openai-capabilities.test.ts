import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock capability-resolver
vi.mock("../../src/core/capability-resolver.js", () => ({
  resolveCapability: vi.fn(() => null),
}));

// Mock plugin extensions
vi.mock("../../src/plugins/extensions.js", () => ({
  getPluginExtension: vi.fn(() => undefined),
}));

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Hono } from "hono";
import { openaiCapabilitiesRouter } from "../../src/daemon/routes/openai-capabilities.js";
import { resolveCapability } from "../../src/core/capability-resolver.js";
import { getPluginExtension } from "../../src/plugins/extensions.js";

function createTestApp() {
  const app = new Hono();
  app.route("/v1", openaiCapabilitiesRouter);
  return app;
}

describe("OpenAI Capabilities Router", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(resolveCapability).mockReturnValue(null);
    vi.mocked(getPluginExtension).mockReturnValue(undefined);
  });

  describe("POST /v1/audio/speech", () => {
    it("returns 503 when no TTS provider registered", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Hello world", model: "tts-1" }),
      });
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error.code).toBe("no_providers");
    });

    it("returns 501 when provider exists but no handler extension", async () => {
      vi.mocked(resolveCapability).mockReturnValue({
        capability: "tts",
        provider: { id: "chatterbox", name: "Chatterbox" },
        healthy: true,
      });

      const app = createTestApp();
      const res = await app.request("/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Hello world", model: "tts-1" }),
      });
      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.error.code).toBe("not_implemented");
    });

    it("returns 400 when input is missing", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "tts-1" }),
      });
      expect(res.status).toBe(400);
    });

    it("proxies to TTS handler and returns audio buffer", async () => {
      const audioBuffer = Buffer.from("fake-audio-data");
      const mockHandler = { speak: vi.fn(async () => audioBuffer) };

      vi.mocked(resolveCapability).mockReturnValue({
        capability: "tts",
        provider: { id: "chatterbox", name: "Chatterbox" },
        healthy: true,
      });
      vi.mocked(getPluginExtension).mockReturnValue(mockHandler);

      const app = createTestApp();
      const res = await app.request("/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Hello world", model: "tts-1", voice: "alloy" }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
      expect(mockHandler.speak).toHaveBeenCalledWith(
        expect.objectContaining({ input: "Hello world", voice: "alloy" }),
      );
    });
  });

  describe("POST /v1/audio/transcriptions", () => {
    it("returns 503 when no STT provider registered", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "base64data", model: "whisper-1" }),
      });
      expect(res.status).toBe(503);
    });

    it("proxies to STT handler and returns transcription", async () => {
      const mockHandler = { transcribe: vi.fn(async () => ({ text: "Hello world" })) };

      vi.mocked(resolveCapability).mockReturnValue({
        capability: "stt",
        provider: { id: "whisper", name: "Whisper" },
        healthy: true,
      });
      vi.mocked(getPluginExtension).mockReturnValue(mockHandler);

      const app = createTestApp();
      const res = await app.request("/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "base64audiodata", model: "whisper-1" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.text).toBe("Hello world");
    });
  });

  describe("POST /v1/images/generations", () => {
    it("returns 503 when no image-gen provider registered", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "A cat" }),
      });
      expect(res.status).toBe(503);
    });

    it("proxies to image-gen handler and returns image data", async () => {
      const mockHandler = {
        generate: vi.fn(async () => ({
          data: [{ url: "https://example.com/cat.png" }],
        })),
      };

      vi.mocked(resolveCapability).mockReturnValue({
        capability: "image-gen",
        provider: { id: "imagegen", name: "ImageGen" },
        healthy: true,
      });
      vi.mocked(getPluginExtension).mockReturnValue(mockHandler);

      const app = createTestApp();
      const res = await app.request("/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "A cat", n: 1, size: "1024x1024" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.created).toBeTypeOf("number");
      expect(data.data).toHaveLength(1);
      expect(data.data[0].url).toBe("https://example.com/cat.png");
    });
  });

  describe("POST /v1/embeddings", () => {
    it("returns 503 when no embeddings provider registered", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Hello", model: "text-embedding-ada-002" }),
      });
      expect(res.status).toBe(503);
    });

    it("returns 400 when input is missing", async () => {
      const app = createTestApp();
      const res = await app.request("/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-ada-002" }),
      });
      expect(res.status).toBe(400);
    });

    it("proxies to embeddings handler and returns embedding data", async () => {
      const mockHandler = {
        embed: vi.fn(async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
          model: "text-embedding-ada-002",
          usage: { prompt_tokens: 2, total_tokens: 2 },
        })),
      };

      vi.mocked(resolveCapability).mockReturnValue({
        capability: "embeddings",
        provider: { id: "openai-embeddings", name: "OpenAI Embeddings" },
        healthy: true,
      });
      vi.mocked(getPluginExtension).mockReturnValue(mockHandler);

      const app = createTestApp();
      const res = await app.request("/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Hello", model: "text-embedding-ada-002" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.object).toBe("list");
      expect(data.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
      expect(data.usage).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("returns 500 when handler throws", async () => {
      const mockHandler = {
        speak: vi.fn(async () => {
          throw new Error("Provider failed");
        }),
      };

      vi.mocked(resolveCapability).mockReturnValue({
        capability: "tts",
        provider: { id: "chatterbox", name: "Chatterbox" },
        healthy: true,
      });
      vi.mocked(getPluginExtension).mockReturnValue(mockHandler);

      const app = createTestApp();
      const res = await app.request("/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Hello", model: "tts-1" }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error.message).toBe("Provider failed");
    });
  });

  describe("Router integration", () => {
    it("openaiCapabilitiesRouter is exported from routes/index", async () => {
      const mod = await import("../../src/daemon/routes/index.js");
      expect((mod as Record<string, unknown>).openaiCapabilitiesRouter).toBeDefined();
    });
  });
});
