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
import { describeRoute } from "hono-openapi";
import { config as centralConfig } from "../../core/config.js";
import { providerRegistry } from "../../core/providers.js";
import { deleteSession, inject, setSessionContext, setSessionProvider } from "../../core/sessions.js";
import { createInjectionSource } from "../../security/index.js";
import type { ProviderConfig } from "../../types/provider.js";
import { requireWriteScope } from "../middleware/auth.js";
import { type RoutableProvider, type RoutingStrategy, selectProvider } from "./openai-routing.js";

type AuthEnv = {
  Variables: {
    user: { id: string } | undefined;
    role: string;
    session: unknown;
    authMethod: string;
    apiKeyScope: string;
  };
};

export const openaiRouter = new Hono<AuthEnv>();

/** Valid roles for OpenAI chat messages */
const VALID_ROLES = new Set(["system", "user", "assistant", "tool"]);

/**
 * OpenAI Chat Completion request body (pre-validation).
 * `content` is `unknown` until validated — callers send arbitrary JSON.
 */
interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role?: unknown;
    content?: unknown;
  }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

/** Post-validation message with guaranteed string content */
interface ValidatedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/**
 * Validate and normalize OpenAI-style messages.
 *
 * Returns normalized messages with string content, or an error string
 * describing the first invalid message.
 */
function validateMessages(
  messages: ChatCompletionRequest["messages"],
): { ok: true; messages: ValidatedMessage[] } | { ok: false; error: string } {
  const validated: ValidatedMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Validate role
    if (typeof msg.role !== "string" || !VALID_ROLES.has(msg.role)) {
      return {
        ok: false,
        error: `messages[${i}].role must be one of: system, user, assistant, tool — got ${JSON.stringify(msg.role)}`,
      };
    }
    const role = msg.role as ValidatedMessage["role"];

    // Validate and normalize content
    const content = msg.content;

    // null/undefined content: allowed for assistant/tool, rejected for user/system
    if (content === null || content === undefined) {
      if (role === "user" || role === "system") {
        return {
          ok: false,
          error: `messages[${i}].content is required for role "${role}"`,
        };
      }
      validated.push({ role, content: "" });
      continue;
    }

    // String content: pass through
    if (typeof content === "string") {
      validated.push({ role, content });
      continue;
    }

    // Array content: extract text parts (OpenAI multimodal format)
    if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const part of content) {
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as Record<string, unknown>).type === "text" &&
          "text" in part &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          textParts.push((part as Record<string, unknown>).text as string);
        }
        // Skip non-text parts (image_url, etc.) silently
      }
      validated.push({ role, content: textParts.join("\n") });
      continue;
    }

    // Anything else (number, boolean, non-array object): reject
    return {
      ok: false,
      error: `messages[${i}].content must be a string or content array — got ${typeof content}`,
    };
  }

  return { ok: true, messages: validated };
}

/**
 * Derive a deterministic session name from model + a per-request UUID.
 * OpenAI clients don't have a concept of WOPR sessions, so each request
 * gets its own ephemeral session to avoid cross-request state leakage.
 */
function makeSessionName(): string {
  return `openai-${randomUUID().slice(0, 12)}`;
}

const VALID_STRATEGIES = new Set<RoutingStrategy>(["first", "cheapest", "capable", "preferred"]);

/**
 * Resolve which WOPR provider to use for a given OpenAI model string.
 *
 * Routing strategy precedence: per-request header > config default > "first"
 */
function resolveProviderConfig(model: string, strategyOverride?: string): ProviderConfig | null {
  const providers = providerRegistry.listProviders();
  const available = providers.filter((p) => p.available);

  if (available.length === 0) return null;

  // Build RoutableProvider list with supportedModels from registry
  const routable: RoutableProvider[] = available.map((p) => {
    const reg = providerRegistry.getProvider(p.id);
    return {
      id: p.id,
      name: p.name,
      available: p.available,
      supportedModels: reg?.provider.supportedModels ?? [],
    };
  });

  // Determine strategy: header override > config > default "first"
  const configStrategy = centralConfig.get().routingStrategy;
  const rawStrategy = strategyOverride ?? configStrategy ?? "first";
  const strategy: RoutingStrategy = VALID_STRATEGIES.has(rawStrategy as RoutingStrategy)
    ? (rawStrategy as RoutingStrategy)
    : "first";

  // Get per-provider configs for cost/preferred data
  const providerConfigs = centralConfig.get().providers ?? {};

  const selected = selectProvider(routable, model, strategy, providerConfigs);
  if (!selected) return null;

  // If the selected provider's ID matches the model, no model override needed
  if (selected.id === model) {
    return { name: selected.id };
  }
  return { name: selected.id, model };
}

/**
 * Build the prompt and system prompt from validated messages.
 */
function buildPrompts(messages: ValidatedMessage[]): {
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

openaiRouter.post(
  "/chat/completions",
  describeRoute({
    tags: ["OpenAI Compatible"],
    summary: "Chat completions (OpenAI-compatible)",
    description:
      "OpenAI-compatible chat completions endpoint. Supports streaming via Accept: text/event-stream or stream: true in body.",
    responses: {
      200: { description: "Chat completion response (or SSE stream)" },
      400: { description: "Invalid request" },
      503: { description: "No AI providers available" },
      500: { description: "Provider error" },
    },
  }),
  requireWriteScope({ format: "openai" }),
  async (c) => {
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

    // Validate individual messages
    const validation = validateMessages(body.messages);
    if (!validation.ok) {
      return c.json(
        {
          error: {
            message: validation.error,
            type: "invalid_request_error",
            code: "invalid_message",
          },
        },
        400,
      );
    }

    // Resolve provider
    const routingStrategy = c.req.header("X-Routing-Strategy");
    const providerConfig = resolveProviderConfig(body.model, routingStrategy);
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

    const apiKeyScope = c.get("apiKeyScope") as string | undefined;
    const sessionName = makeSessionName();
    const { systemPrompt, userPrompt } = buildPrompts(validation.messages);
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
        let aborted = false;

        // Clean up the ephemeral session when the client disconnects
        s.onAbort(() => {
          aborted = true;
          deleteSession(sessionName, "client-disconnect").catch(() => {});
        });

        try {
          let streamUsage: { inputTokens: number; outputTokens: number } | undefined;

          await inject(sessionName, userPrompt, {
            silent: true,
            from: "openai-api",
            source:
              apiKeyScope === "full"
                ? createInjectionSource("daemon", { trustLevel: "owner" })
                : createInjectionSource("daemon"),
            onStream: (msg) => {
              if (aborted) return;
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
              } else if (msg.type === "complete" && msg.usage) {
                streamUsage = msg.usage;
              }
            },
          });

          if (!aborted) {
            // Final chunk with finish_reason
            const finalChunk: Record<string, unknown> = {
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
            if (body.stream_options?.include_usage) {
              finalChunk.usage = {
                prompt_tokens: streamUsage?.inputTokens ?? 0,
                completion_tokens: streamUsage?.outputTokens ?? 0,
                total_tokens: (streamUsage?.inputTokens ?? 0) + (streamUsage?.outputTokens ?? 0),
              };
            }
            s.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            s.write("data: [DONE]\n\n");
          }
        } catch (err) {
          if (!aborted) {
            const errorChunk = {
              error: {
                message: err instanceof Error ? err.message : "Internal server error",
                type: "server_error",
              },
            };
            s.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
            s.write("data: [DONE]\n\n");
          }
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
        source:
          apiKeyScope === "full"
            ? createInjectionSource("daemon", { trustLevel: "owner" })
            : createInjectionSource("daemon"),
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
          prompt_tokens: result.usage?.inputTokens ?? 0,
          completion_tokens: result.usage?.outputTokens ?? 0,
          total_tokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
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
  },
);

// ============================================================================
// GET /v1/models
// ============================================================================

openaiRouter.get(
  "/models",
  describeRoute({
    tags: ["OpenAI Compatible"],
    summary: "List available models",
    responses: {
      200: { description: "List of models in OpenAI format" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
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
  },
);

// ============================================================================
// GET /v1/models/:model - Get single model info
// ============================================================================

openaiRouter.get(
  "/models/:model",
  describeRoute({
    tags: ["OpenAI Compatible"],
    summary: "Get model info",
    responses: {
      200: { description: "Model details in OpenAI format" },
      404: { description: "Model not found" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
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
  },
);
