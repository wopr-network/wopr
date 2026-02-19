/**
 * Shared Zod schemas for OpenAPI documentation.
 *
 * These schemas define request/response shapes for the daemon API.
 * They are used by describeRoute() to generate the OpenAPI spec.
 */
import { z } from "zod";

// --- Common ---
export const ErrorResponse = z.object({
  error: z.string(),
});

export const ErrorResponseWithDetails = z.object({
  error: z.string(),
  details: z.unknown().optional(),
});

// --- Auth ---
export const AuthStatusResponse = z.object({
  authenticated: z.boolean(),
  type: z.enum(["oauth", "api_key"]).optional(),
  source: z.string().optional(),
  email: z.string().nullable().optional(),
  expiresAt: z.number().nullable().optional(),
  keyPrefix: z.string().optional(),
});

export const LoginResponse = z.object({
  authUrl: z.string(),
  state: z.string(),
});

export const CallbackRequest = z.object({
  code: z.string(),
  state: z.string(),
});

export const CallbackResponse = z.object({
  success: z.boolean(),
  expiresIn: z.number().optional(),
});

export const ApiKeyRequest = z.object({
  apiKey: z.string(),
});

// --- Sessions ---
export const SessionSummary = z.object({
  name: z.string(),
  id: z.string().nullable(),
  context: z.string().nullable(),
});

export const SessionListResponse = z.object({
  sessions: z.array(z.unknown()),
});

export const CreateSessionRequest = z.object({
  name: z.string(),
  context: z.string().optional(),
});

export const CreateSessionResponse = z.object({
  name: z.string(),
  context: z.string(),
  created: z.boolean(),
});

export const InjectRequest = z.object({
  message: z.string(),
  from: z.string().optional(),
});

export const InjectResponse = z.object({
  session: z.string(),
  sessionId: z.string(),
  response: z.string(),
});

// --- Plugins ---
export const PluginInstallRequest = z.object({
  source: z.string(),
});

export const PluginInfo = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().nullable().optional(),
  source: z.string(),
  enabled: z.boolean(),
  loaded: z.boolean().optional(),
});

// --- Providers ---
export const ProviderInfo = z.object({
  id: z.string(),
  name: z.string(),
  available: z.boolean(),
});

export const SetCredentialRequest = z.object({
  providerId: z.string(),
  credential: z.unknown(),
});

// --- API Keys ---
export const CreateApiKeyRequest = z.object({
  name: z.string(),
  scope: z.enum(["full", "read-only"]).optional(),
  expiresAt: z.number().optional(),
});

// --- OpenAI Compatible ---
export const ChatCompletionRequest = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    }),
  ),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
});
