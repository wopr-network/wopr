/**
 * ACP (Agent Client Protocol) types and Zod schemas.
 *
 * Defines the wire protocol for IDE integration over NDJSON/stdio.
 * Compatible with Zed, VS Code, and other editors supporting ACP.
 */
import { z } from "zod";

// ============================================================================
// Protocol Version
// ============================================================================

export const ACP_PROTOCOL_VERSION = "0.1.0";

// ============================================================================
// Base Message Schema
// ============================================================================

export const AcpBaseMessageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
});

// ============================================================================
// Initialize
// ============================================================================

export const AcpInitializeParamsSchema = z.object({
  protocolVersion: z.string(),
  clientInfo: z.object({
    name: z.string(),
    version: z.string(),
  }),
  capabilities: z
    .object({
      context: z.boolean().optional(),
      streaming: z.boolean().optional(),
    })
    .optional(),
});

export const AcpInitializeRequestSchema = AcpBaseMessageSchema.extend({
  method: z.literal("initialize"),
  params: AcpInitializeParamsSchema,
});

export const AcpInitializeResultSchema = z.object({
  protocolVersion: z.string(),
  serverInfo: z.object({
    name: z.string(),
    version: z.string(),
  }),
  capabilities: z.object({
    context: z.boolean(),
    streaming: z.boolean(),
  }),
});

// ============================================================================
// Chat Messages
// ============================================================================

export const AcpChatMessageParamsSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string(),
  context: z
    .object({
      files: z
        .array(
          z.object({
            path: z.string(),
            content: z.string().optional(),
            language: z.string().optional(),
          }),
        )
        .optional(),
      selection: z
        .object({
          path: z.string(),
          startLine: z.number(),
          endLine: z.number(),
          text: z.string(),
        })
        .optional(),
      diagnostics: z
        .array(
          z.object({
            path: z.string(),
            line: z.number(),
            severity: z.enum(["error", "warning", "info", "hint"]),
            message: z.string(),
          }),
        )
        .optional(),
      cursorPosition: z
        .object({
          path: z.string(),
          line: z.number(),
          column: z.number(),
        })
        .optional(),
    })
    .optional(),
});

export const AcpChatMessageRequestSchema = AcpBaseMessageSchema.extend({
  method: z.literal("chat/message"),
  params: AcpChatMessageParamsSchema,
});

export const AcpChatResponseSchema = z.object({
  sessionId: z.string(),
  content: z.string(),
});

// ============================================================================
// Chat Cancel
// ============================================================================

export const AcpChatCancelParamsSchema = z.object({
  sessionId: z.string(),
});

export const AcpChatCancelRequestSchema = AcpBaseMessageSchema.extend({
  method: z.literal("chat/cancel"),
  params: AcpChatCancelParamsSchema,
});

// ============================================================================
// Context Update
// ============================================================================

export const AcpContextUpdateParamsSchema = z.object({
  sessionId: z.string(),
  context: z.object({
    files: z
      .array(
        z.object({
          path: z.string(),
          content: z.string().optional(),
          language: z.string().optional(),
        }),
      )
      .optional(),
    selection: z
      .object({
        path: z.string(),
        startLine: z.number(),
        endLine: z.number(),
        text: z.string(),
      })
      .optional(),
    diagnostics: z
      .array(
        z.object({
          path: z.string(),
          line: z.number(),
          severity: z.enum(["error", "warning", "info", "hint"]),
          message: z.string(),
        }),
      )
      .optional(),
    cursorPosition: z
      .object({
        path: z.string(),
        line: z.number(),
        column: z.number(),
      })
      .optional(),
  }),
});

export const AcpContextUpdateRequestSchema = AcpBaseMessageSchema.extend({
  method: z.literal("context/update"),
  params: AcpContextUpdateParamsSchema,
});

// ============================================================================
// Streaming Notifications (server -> client)
// ============================================================================

export const AcpStreamChunkSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("chat/streamChunk"),
  params: z.object({
    sessionId: z.string(),
    delta: z.string(),
  }),
});

export const AcpStreamEndSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("chat/streamEnd"),
  params: z.object({
    sessionId: z.string(),
  }),
});

// ============================================================================
// Union / Discriminated Types
// ============================================================================

export const AcpRequestSchema = z.union([
  AcpInitializeRequestSchema,
  AcpChatMessageRequestSchema,
  AcpChatCancelRequestSchema,
  AcpContextUpdateRequestSchema,
]);

// ============================================================================
// Inferred TypeScript Types
// ============================================================================

export type AcpBaseMessage = z.infer<typeof AcpBaseMessageSchema>;
export type AcpInitializeParams = z.infer<typeof AcpInitializeParamsSchema>;
export type AcpInitializeRequest = z.infer<typeof AcpInitializeRequestSchema>;
export type AcpInitializeResult = z.infer<typeof AcpInitializeResultSchema>;
export type AcpChatMessageParams = z.infer<typeof AcpChatMessageParamsSchema>;
export type AcpChatMessageRequest = z.infer<typeof AcpChatMessageRequestSchema>;
export type AcpChatResponse = z.infer<typeof AcpChatResponseSchema>;
export type AcpChatCancelParams = z.infer<typeof AcpChatCancelParamsSchema>;
export type AcpChatCancelRequest = z.infer<typeof AcpChatCancelRequestSchema>;
export type AcpContextUpdateParams = z.infer<typeof AcpContextUpdateParamsSchema>;
export type AcpContextUpdateRequest = z.infer<typeof AcpContextUpdateRequestSchema>;
export type AcpStreamChunk = z.infer<typeof AcpStreamChunkSchema>;
export type AcpStreamEnd = z.infer<typeof AcpStreamEndSchema>;
export type AcpRequest = z.infer<typeof AcpRequestSchema>;

// ============================================================================
// JSON-RPC Response Helpers
// ============================================================================

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number | undefined;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export function createResponse<T>(id: string | number | undefined, result: T): JsonRpcResponse<T> {
  return { jsonrpc: "2.0", id, result };
}

export function createError(
  id: string | number | undefined,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

// Standard JSON-RPC error codes
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;
