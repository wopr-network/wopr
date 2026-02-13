/**
 * ACP Types Tests
 *
 * Tests Zod schema validation for ACP protocol messages:
 * - Initialize request/response
 * - Chat message request/response
 * - Chat cancel
 * - Context update
 * - JSON-RPC helpers
 */
import { describe, expect, it } from "vitest";
import {
  ACP_PROTOCOL_VERSION,
  AcpChatCancelRequestSchema,
  AcpChatMessageRequestSchema,
  AcpContextUpdateRequestSchema,
  AcpInitializeRequestSchema,
  AcpRequestSchema,
  RPC_INTERNAL_ERROR,
  RPC_PARSE_ERROR,
  createError,
  createResponse,
} from "../../../src/core/acp/types.js";

describe("ACP Types", () => {
  describe("AcpInitializeRequestSchema", () => {
    it("validates a correct initialize request", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "zed", version: "1.0.0" },
        },
      };
      const result = AcpInitializeRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("validates with capabilities", () => {
      const msg = {
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "vscode", version: "2.0.0" },
          capabilities: { context: true, streaming: true },
        },
      };
      const result = AcpInitializeRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects missing clientInfo", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "0.1.0" },
      };
      const result = AcpInitializeRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects wrong method", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "init",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "zed", version: "1.0.0" },
        },
      };
      const result = AcpInitializeRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("AcpChatMessageRequestSchema", () => {
    it("validates a minimal chat message", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: { message: "Hello" },
      };
      const result = AcpChatMessageRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("validates with full context", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 3,
        method: "chat/message",
        params: {
          sessionId: "acp-1",
          message: "Fix this bug",
          context: {
            files: [{ path: "/src/main.ts", content: "const x = 1;", language: "typescript" }],
            selection: { path: "/src/main.ts", startLine: 1, endLine: 1, text: "const x = 1;" },
            diagnostics: [{ path: "/src/main.ts", line: 1, severity: "error", message: "unused variable" }],
            cursorPosition: { path: "/src/main.ts", line: 1, column: 7 },
          },
        },
      };
      const result = AcpChatMessageRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects missing message", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: {},
      };
      const result = AcpChatMessageRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("AcpChatCancelRequestSchema", () => {
    it("validates a cancel request", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 4,
        method: "chat/cancel",
        params: { sessionId: "acp-1" },
      };
      const result = AcpChatCancelRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects missing sessionId", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 4,
        method: "chat/cancel",
        params: {},
      };
      const result = AcpChatCancelRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("AcpContextUpdateRequestSchema", () => {
    it("validates a context update", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 5,
        method: "context/update",
        params: {
          sessionId: "acp-1",
          context: {
            files: [{ path: "/src/app.ts" }],
          },
        },
      };
      const result = AcpContextUpdateRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("validates with diagnostics", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 6,
        method: "context/update",
        params: {
          sessionId: "acp-1",
          context: {
            diagnostics: [{ path: "/src/app.ts", line: 10, severity: "warning", message: "unused import" }],
          },
        },
      };
      const result = AcpContextUpdateRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("AcpRequestSchema union", () => {
    it("discriminates initialize", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "zed", version: "1.0.0" },
        },
      };
      const result = AcpRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("discriminates chat/message", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: { message: "hi" },
      };
      const result = AcpRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("JSON-RPC helpers", () => {
    it("createResponse creates valid response", () => {
      const resp = createResponse(1, { ok: true });
      expect(resp).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    });

    it("createResponse with string id", () => {
      const resp = createResponse("abc", "result");
      expect(resp.id).toBe("abc");
      expect(resp.result).toBe("result");
    });

    it("createError creates valid error", () => {
      const resp = createError(2, RPC_PARSE_ERROR, "Parse error");
      expect(resp).toEqual({
        jsonrpc: "2.0",
        id: 2,
        error: { code: RPC_PARSE_ERROR, message: "Parse error" },
      });
    });

    it("createError with data", () => {
      const resp = createError(3, RPC_INTERNAL_ERROR, "Internal error", { detail: "stack" });
      expect(resp.error?.data).toEqual({ detail: "stack" });
    });
  });

  describe("ACP_PROTOCOL_VERSION", () => {
    it("is defined", () => {
      expect(ACP_PROTOCOL_VERSION).toBe("0.1.0");
    });
  });
});
