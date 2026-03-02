/**
 * OpenAI-compatible routes for non-LLM capabilities (TTS, STT, ImageGen, Embeddings).
 *
 * Each endpoint resolves the appropriate provider via the capability registry,
 * then delegates to the plugin's handler extension. Plugins must register
 * a "<capability>:handler" extension (e.g., "tts:handler") to be routable.
 *
 * NOTE: Capabilities without a registered handler extension are discoverable
 * in the capability registry but NOT routable through these endpoints (WOP-1509).
 *
 * DEVIATION: /v1/audio/transcriptions accepts JSON with base64-encoded audio
 * instead of multipart/form-data (simpler, avoids multipart parsing complexity).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolveCapability } from "../../core/capability-resolver.js";
import { logger } from "../../logger.js";
import { getPluginExtension } from "../../plugins/extensions.js";

export const openaiCapabilitiesRouter = new Hono();

// ---- Shared helpers ----

function noProviderError(capability: string) {
  return {
    error: {
      message: `No ${capability} providers available. Install a ${capability} provider plugin and restart the daemon.`,
      type: "server_error",
      code: "no_providers",
    },
  };
}

function notImplementedError(capability: string, providerId: string) {
  return {
    error: {
      message: `Provider "${providerId}" is registered for ${capability} but does not expose a routing handler. The plugin must register a "${capability}:handler" extension.`,
      type: "server_error",
      code: "not_implemented",
    },
  };
}

function serverError(err: unknown) {
  return {
    error: {
      message: err instanceof Error ? err.message : "Internal server error",
      type: "server_error",
      code: "provider_error",
    },
  };
}

const VALID_AUDIO_FORMATS = new Set(["mp3", "opus", "aac", "flac", "wav", "pcm"]);

// ============================================================================
// POST /v1/audio/speech — Text-to-Speech
// ============================================================================

openaiCapabilitiesRouter.post(
  "/audio/speech",
  describeRoute({
    tags: ["OpenAI Compatible"],
    summary: "Create speech (OpenAI-compatible)",
    description: "Generates audio from input text using a TTS provider plugin.",
    responses: {
      200: { description: "Audio file (binary)" },
      400: { description: "Invalid request" },
      501: { description: "Provider registered but handler not implemented" },
      503: { description: "No TTS providers available" },
      500: { description: "Provider error" },
    },
  }),
  async (c) => {
    let body: { input?: string; model?: string; voice?: string; response_format?: string; speed?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { message: "Invalid JSON", type: "invalid_request_error", code: "invalid_json" } }, 400);
    }

    if (!body.input || typeof body.input !== "string") {
      return c.json(
        {
          error: {
            message: "'input' is required and must be a string",
            type: "invalid_request_error",
            code: "missing_field",
          },
        },
        400,
      );
    }

    const responseFormat = body.response_format ?? "mp3";
    if (!VALID_AUDIO_FORMATS.has(responseFormat)) {
      return c.json(
        {
          error: {
            message: `Invalid response_format '${responseFormat}'. Must be one of: ${[...VALID_AUDIO_FORMATS].join(", ")}`,
            type: "invalid_request_error",
            code: "invalid_response_format",
          },
        },
        400,
      );
    }

    const resolved = resolveCapability("tts");
    if (!resolved) {
      return c.json(noProviderError("tts"), 503);
    }

    const handler = getPluginExtension<{ speak: (params: Record<string, unknown>) => Promise<Buffer> }>("tts:handler");
    if (!handler?.speak) {
      return c.json(notImplementedError("tts", resolved.provider.id), 501);
    }

    try {
      const audio = await handler.speak({
        input: body.input,
        model: body.model,
        voice: body.voice,
        response_format: responseFormat,
        speed: body.speed,
      });
      c.header("Content-Type", `audio/${responseFormat}`);
      return c.body(new Uint8Array(audio));
    } catch (err) {
      logger.error(`[openai-capabilities] TTS error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json(serverError(err), 500);
    }
  },
);

// ============================================================================
// POST /v1/audio/transcriptions — Speech-to-Text
// ============================================================================

openaiCapabilitiesRouter.post(
  "/audio/transcriptions",
  describeRoute({
    tags: ["OpenAI Compatible"],
    summary: "Create transcription (OpenAI-compatible)",
    description:
      "Transcribes audio using an STT provider plugin. Accepts JSON with base64-encoded audio (not multipart/form-data).",
    responses: {
      200: { description: "Transcription result" },
      400: { description: "Invalid request" },
      501: { description: "Provider registered but handler not implemented" },
      503: { description: "No STT providers available" },
      500: { description: "Provider error" },
    },
  }),
  async (c) => {
    let body: { file?: string; model?: string; language?: string; response_format?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { message: "Invalid JSON", type: "invalid_request_error", code: "invalid_json" } }, 400);
    }

    if (!body.file || typeof body.file !== "string") {
      return c.json(
        {
          error: {
            message: "'file' is required (base64-encoded audio)",
            type: "invalid_request_error",
            code: "missing_field",
          },
        },
        400,
      );
    }

    const resolved = resolveCapability("stt");
    if (!resolved) {
      return c.json(noProviderError("stt"), 503);
    }

    const handler = getPluginExtension<{ transcribe: (params: Record<string, unknown>) => Promise<{ text: string }> }>(
      "stt:handler",
    );
    if (!handler?.transcribe) {
      return c.json(notImplementedError("stt", resolved.provider.id), 501);
    }

    try {
      const audioBuffer = Buffer.from(body.file, "base64");
      const result = await handler.transcribe({
        file: audioBuffer,
        model: body.model,
        language: body.language,
        response_format: body.response_format,
      });
      return c.json({ text: result.text });
    } catch (err) {
      logger.error(`[openai-capabilities] STT error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json(serverError(err), 500);
    }
  },
);

// ============================================================================
// POST /v1/images/generations — Image Generation
// ============================================================================

openaiCapabilitiesRouter.post(
  "/images/generations",
  describeRoute({
    tags: ["OpenAI Compatible"],
    summary: "Create image (OpenAI-compatible)",
    description: "Generates images from a text prompt using an image-gen provider plugin.",
    responses: {
      200: { description: "Image generation result" },
      400: { description: "Invalid request" },
      501: { description: "Provider registered but handler not implemented" },
      503: { description: "No image-gen providers available" },
      500: { description: "Provider error" },
    },
  }),
  async (c) => {
    let body: { prompt?: string; model?: string; n?: number; size?: string; response_format?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { message: "Invalid JSON", type: "invalid_request_error", code: "invalid_json" } }, 400);
    }

    if (!body.prompt || typeof body.prompt !== "string") {
      return c.json(
        { error: { message: "'prompt' is required", type: "invalid_request_error", code: "missing_field" } },
        400,
      );
    }

    const resolved = resolveCapability("image-gen");
    if (!resolved) {
      return c.json(noProviderError("image-gen"), 503);
    }

    const handler = getPluginExtension<{
      generate: (params: Record<string, unknown>) => Promise<{ data: Array<{ url?: string; b64_json?: string }> }>;
    }>("image-gen:handler");
    if (!handler?.generate) {
      return c.json(notImplementedError("image-gen", resolved.provider.id), 501);
    }

    try {
      const result = await handler.generate({
        prompt: body.prompt,
        model: body.model,
        n: body.n,
        size: body.size,
        response_format: body.response_format,
      });
      return c.json({
        created: Math.floor(Date.now() / 1000),
        data: result.data,
      });
    } catch (err) {
      logger.error(`[openai-capabilities] ImageGen error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json(serverError(err), 500);
    }
  },
);

// ============================================================================
// POST /v1/embeddings — Embeddings
// ============================================================================

openaiCapabilitiesRouter.post(
  "/embeddings",
  describeRoute({
    tags: ["OpenAI Compatible"],
    summary: "Create embeddings (OpenAI-compatible)",
    description: "Creates embedding vectors from input text using an embeddings provider plugin.",
    responses: {
      200: { description: "Embedding result" },
      400: { description: "Invalid request" },
      501: { description: "Provider registered but handler not implemented" },
      503: { description: "No embeddings providers available" },
      500: { description: "Provider error" },
    },
  }),
  async (c) => {
    let body: { input?: string | string[]; model?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { message: "Invalid JSON", type: "invalid_request_error", code: "invalid_json" } }, 400);
    }

    if (body.input === undefined || body.input === null) {
      return c.json(
        { error: { message: "'input' is required", type: "invalid_request_error", code: "missing_field" } },
        400,
      );
    }

    const resolved = resolveCapability("embeddings");
    if (!resolved) {
      return c.json(noProviderError("embeddings"), 503);
    }

    const handler = getPluginExtension<{
      embed: (params: Record<string, unknown>) => Promise<{
        data: Array<{ embedding: number[]; index: number }>;
        model: string;
        usage: { prompt_tokens: number; total_tokens: number };
      }>;
    }>("embeddings:handler");
    if (!handler?.embed) {
      return c.json(notImplementedError("embeddings", resolved.provider.id), 501);
    }

    try {
      const result = await handler.embed({
        input: body.input,
        model: body.model,
      });
      return c.json({
        object: "list",
        data: result.data.map((d) => ({ object: "embedding", ...d })),
        model: result.model,
        usage: result.usage,
      });
    } catch (err) {
      logger.error(`[openai-capabilities] Embeddings error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json(serverError(err), 500);
    }
  },
);
