/**
 * OpenAI-compatible API routes
 *
 * Provides /v1/chat/completions and /v1/models endpoints that conform
 * to the OpenAI API specification, allowing any OpenAI-compatible client
 * (Cursor, Continue, Cody, etc.) to use WOPR as a backend.
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { providerRegistry } from "../../core/providers.js";
import { deleteSession, inject, setSessionContext, setSessionProvider } from "../../core/sessions.js";
import { createInjectionSource } from "../../security/index.js";
import type { ProviderConfig } from "../../types/provider.js";

export const openaiRouter = new Hono();

/**
 * OpenAI Chat Completion request body
 */
interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * Derive a deterministic session name from model + a per-request UUID.
 * OpenAI clients don't have a concept of WOPR sessions, so each request
 * gets its own ephemeral session to avoid cross-request state leakage.
 */
function makeSessionName(): string {
  return `openai-${randomUUID().slice(0, 12)}`;
}

/**
 * Resolve which WOPR provider to use for a given OpenAI model string.
 *
 * Strategy:
 * 1. If the model string matches a registered provider ID, use that provider.
 * 2. If a provider's supportedModels includes the model, use that provider.
 * 3. Otherwise fall back to the first available provider.
 */
function resolveProviderConfig(model: string): ProviderConfig | null {
  const providers = providerRegistry.listProviders();
  const available = providers.filter((p) => p.available);

  if (available.length === 0) return null;

  // Direct match on provider ID (e.g. model="anthropic")
  const directMatch = available.find((p) => p.id === model);
  if (directMatch) {
    return { name: directMatch.id };
  }

  // Use first available provider, pass the model string through
  return { name: available[0].id, model };
}

/**
 * Build the prompt and system prompt from OpenAI-style messages array.
 */
function buildPrompts(messages: ChatCompletionRequest["messages"]): {
  systemPrompt: string | undefined;
  userPrompt: string;
} {
  const systemMessages: string[] = [];
  const conversationParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(msg.content);
    } else if (msg.role === "user") {
      conversationParts.push(msg.content);
    } else if (msg.role === "assistant") {
      conversationParts.push(`[Assistant]: ${msg.content}`);
    }
  }

  return {
    systemPrompt: systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined,
    userPrompt: conversationParts.join("\n\n") || "",
  };
}

// ============================================================================
// POST /v1/chat/completions
// ============================================================================

openaiRouter.post("/chat/completions", async (c) => {
  let body: ChatCompletionRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { message: "Invalid JSON in request body", type: "invalid_request_error", code: "invalid_json" } },
      400,
    );
  }

  // Validate required fields
  if (!body.model) {
    return c.json(
      { error: { message: "'model' is required", type: "invalid_request_error", code: "missing_field" } },
      400,
    );
  }
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json(
      {
        error: {
          message: "'messages' must be a non-empty array",
          type: "invalid_request_error",
          code: "missing_field",
        },
      },
      400,
    );
  }

  // Resolve provider
  const providerConfig = resolveProviderConfig(body.model);
  if (!providerConfig) {
    return c.json(
      {
        error: {
          message: "No AI providers available. Install a provider plugin and restart the daemon.",
          type: "server_error",
          code: "no_providers",
        },
      },
      503,
    );
  }

  const sessionName = makeSessionName();
  const { systemPrompt, userPrompt } = buildPrompts(body.messages);
  const requestId = `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  // Set up the ephemeral session
  if (systemPrompt) {
    await setSessionContext(sessionName, systemPrompt);
  }
  await setSessionProvider(sessionName, providerConfig);

  if (body.stream) {
    // ---- Streaming response (SSE) ----
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    return stream(c, async (s) => {
      // Clean up the ephemeral session when the client disconnects
      s.onAbort(() => {
        deleteSession(sessionName, "client-disconnect").catch(() => {});
      });

      try {
        await inject(sessionName, userPrompt, {
          silent: true,
          from: "openai-api",
          source: createInjectionSource("daemon"),
          onStream: (msg) => {
            if (msg.type === "text" && msg.content) {
              const chunk = {
                id: requestId,
                object: "chat.completion.chunk",
                created,
                model: body.model,
                choices: [
                  {
                    index: 0,
                    delta: { content: msg.content },
                    finish_reason: null,
                  },
                ],
              };
              s.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          },
        });

        // Final chunk with finish_reason
        const finalChunk = {
          id: requestId,
          object: "chat.completion.chunk",
          created,
          model: body.model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        };
        s.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        s.write("data: [DONE]\n\n");
      } catch (err) {
        const errorChunk = {
          error: {
            message: err instanceof Error ? err.message : "Internal server error",
            type: "server_error",
          },
        };
        s.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
        s.write("data: [DONE]\n\n");
      } finally {
        // Clean up the ephemeral session after streaming completes
        await deleteSession(sessionName, "request-complete").catch(() => {});
      }
    });
  }

  // ---- Non-streaming response ----
  try {
    const result = await inject(sessionName, userPrompt, {
      silent: true,
      from: "openai-api",
      source: createInjectionSource("daemon"),
    });

    return c.json({
      id: requestId,
      object: "chat.completion",
      created,
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: result.response,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  } catch (err) {
    return c.json(
      {
        error: {
          message: err instanceof Error ? err.message : "Internal server error",
          type: "server_error",
        },
      },
      500,
    );
  } finally {
    // Clean up the ephemeral session after request completes
    deleteSession(sessionName, "request-complete").catch(() => {});
  }
});

// ============================================================================
// GET /v1/models
// ============================================================================

openaiRouter.get("/models", async (c) => {
  const providers = providerRegistry.listProviders();
  const models: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }> = [];

  for (const provider of providers) {
    if (!provider.available) continue;

    try {
      // Resolve the provider to get the client and list models
      const resolved = await providerRegistry.resolveProvider({ name: provider.id });
      const providerModels = await resolved.client.listModels();

      for (const modelId of providerModels) {
        models.push({
          id: modelId,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: provider.id,
        });
      }
    } catch {
      // If we can't list models for a provider, add the provider itself as a model
      models.push({
        id: provider.id,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: provider.id,
      });
    }
  }

  return c.json({
    object: "list",
    data: models,
  });
});

// ============================================================================
// GET /v1/models/:model - Get single model info
// ============================================================================

openaiRouter.get("/models/:model", async (c) => {
  const modelId = c.req.param("model");
  const providers = providerRegistry.listProviders().filter((p) => p.available);

  // Check if model matches a provider or a provider's model
  for (const provider of providers) {
    if (provider.id === modelId) {
      return c.json({
        id: modelId,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: provider.id,
      });
    }

    try {
      const resolved = await providerRegistry.resolveProvider({ name: provider.id });
      const models = await resolved.client.listModels();
      if (models.includes(modelId)) {
        return c.json({
          id: modelId,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: provider.id,
        });
      }
    } catch {
      // skip
    }
  }

  return c.json(
    {
      error: {
        message: `The model '${modelId}' does not exist`,
        type: "invalid_request_error",
        code: "model_not_found",
      },
    },
    404,
  );
});
