/**
 * ACP Server Tests
 *
 * Tests NDJSON transport and message handling:
 * - NDJSON parsing and serialization
 * - Initialize handshake
 * - Chat message routing to session bridge
 * - Chat cancel
 * - Context update
 * - Error handling (parse errors, unknown methods, pre-init requests)
 * - Graceful shutdown
 */
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcpServer, type AcpSessionBridge, parseNdjsonLine, serializeNdjson } from "../../../src/core/acp/server.js";

// Mock logger
vi.mock("../../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Helper to collect output from a PassThrough stream
function collectOutput(stream: PassThrough): string[] {
  const lines: string[] = [];
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim()) lines.push(part);
    }
  });
  // Getter for any remaining buffer
  return lines;
}

// Helper to send an NDJSON message to the input stream
function sendMessage(input: PassThrough, msg: unknown): void {
  input.push(`${JSON.stringify(msg)}\n`);
}

// Wait for async processing
function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("NDJSON Helpers", () => {
  describe("parseNdjsonLine", () => {
    it("parses valid JSON", () => {
      expect(parseNdjsonLine('{"a":1}')).toEqual({ a: 1 });
    });

    it("parses with whitespace", () => {
      expect(parseNdjsonLine('  {"a":1}  ')).toEqual({ a: 1 });
    });

    it("returns null for empty string", () => {
      expect(parseNdjsonLine("")).toBeNull();
    });

    it("returns null for whitespace only", () => {
      expect(parseNdjsonLine("   ")).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      expect(parseNdjsonLine("{invalid}")).toBeNull();
    });
  });

  describe("serializeNdjson", () => {
    it("serializes with trailing newline", () => {
      const result = serializeNdjson({ a: 1 });
      expect(result).toBe('{"a":1}\n');
    });

    it("serializes complex object", () => {
      const result = serializeNdjson({ jsonrpc: "2.0", id: 1, result: { ok: true } });
      expect(result).toContain('"jsonrpc":"2.0"');
      expect(result.endsWith("\n")).toBe(true);
    });
  });
});

describe("AcpServer", () => {
  let input: PassThrough;
  let output: PassThrough;
  let bridge: AcpSessionBridge;
  let server: AcpServer;
  let outputLines: string[];

  beforeEach(() => {
    input = new PassThrough();
    output = new PassThrough();
    outputLines = collectOutput(output);

    bridge = {
      inject: vi.fn(async (_session, _message, _options) => ({
        response: "Hello from WOPR",
        sessionId: "wopr-session-1",
        cost: 0.001,
      })),
      cancelInject: vi.fn(() => true),
    };

    server = new AcpServer({ bridge, defaultSession: "test", input, output });
  });

  function getResponses(): unknown[] {
    return outputLines.map((line) => JSON.parse(line));
  }

  async function sendAndWait(msg: unknown, ms = 50): Promise<unknown[]> {
    sendMessage(input, msg);
    await tick(ms);
    return getResponses();
  }

  const initMsg = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "0.1.0",
      clientInfo: { name: "test-editor", version: "1.0.0" },
    },
  };

  describe("initialize", () => {
    it("responds to initialize request", async () => {
      server.start();
      const responses = await sendAndWait(initMsg);

      expect(responses).toHaveLength(1);
      const resp = responses[0] as any;
      expect(resp.jsonrpc).toBe("2.0");
      expect(resp.id).toBe(1);
      expect(resp.result.protocolVersion).toBe("0.1.0");
      expect(resp.result.serverInfo.name).toBe("wopr-acp");
      expect(resp.result.capabilities.context).toBe(true);
      expect(resp.result.capabilities.streaming).toBe(true);
    });

    it("rejects invalid initialize params", async () => {
      server.start();
      const responses = await sendAndWait({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "0.1.0" },
        // Missing clientInfo
      });

      expect(responses).toHaveLength(1);
      const resp = responses[0] as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32602); // Invalid params
    });
  });

  describe("chat/message", () => {
    it("rejects before initialization", async () => {
      server.start();
      const responses = await sendAndWait({
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: { message: "Hello" },
      });

      const resp = responses[0] as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.message).toContain("Not initialized");
    });

    it("processes chat message after initialization", async () => {
      server.start();
      await sendAndWait(initMsg);
      outputLines.length = 0;

      const responses = await sendAndWait({
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: { message: "Hello WOPR" },
      });

      // Should have at least streamEnd notification + final response
      expect(responses.length).toBeGreaterThanOrEqual(2);

      // Find the final response (has id: 2)
      const finalResp = responses.find((r: any) => r.id === 2) as any;
      expect(finalResp).toBeDefined();
      expect(finalResp.result.content).toBe("Hello from WOPR");
      expect(finalResp.result.sessionId).toBeDefined();

      // Verify bridge.inject was called
      expect(bridge.inject).toHaveBeenCalled();
    });

    it("passes editor context to the bridge", async () => {
      server.start();
      await sendAndWait(initMsg);
      outputLines.length = 0;

      await sendAndWait({
        jsonrpc: "2.0",
        id: 3,
        method: "chat/message",
        params: {
          message: "Fix the bug",
          context: {
            cursorPosition: { path: "/src/main.ts", line: 10, column: 5 },
          },
        },
      });

      // Verify inject was called with context-enriched message
      const injectCall = (bridge.inject as any).mock.calls[0];
      const injectedMessage = injectCall[1] as string;
      expect(injectedMessage).toContain("Cursor: /src/main.ts:10:5");
      expect(injectedMessage).toContain("Fix the bug");
    });
  });

  describe("chat/cancel", () => {
    it("rejects before initialization", async () => {
      server.start();
      const responses = await sendAndWait({
        jsonrpc: "2.0",
        id: 3,
        method: "chat/cancel",
        params: { sessionId: "acp-1" },
      });

      const resp = responses[0] as any;
      expect(resp.error).toBeDefined();
    });

    it("cancels with known session", async () => {
      server.start();
      await sendAndWait(initMsg);
      outputLines.length = 0;

      // First, send a chat message to create a session
      await sendAndWait({
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: { message: "Hello" },
      });

      outputLines.length = 0;

      // Now cancel - the session should have been created as acp-1
      const responses = await sendAndWait({
        jsonrpc: "2.0",
        id: 3,
        method: "chat/cancel",
        params: { sessionId: "acp-1" },
      });

      const resp = responses.find((r: any) => r.id === 3) as any;
      expect(resp).toBeDefined();
      expect(resp.result.cancelled).toBe(true);
    });

    it("returns cancelled=false for unknown session", async () => {
      server.start();
      await sendAndWait(initMsg);
      outputLines.length = 0;

      const responses = await sendAndWait({
        jsonrpc: "2.0",
        id: 4,
        method: "chat/cancel",
        params: { sessionId: "nonexistent" },
      });

      const resp = responses[0] as any;
      expect(resp.result.cancelled).toBe(false);
    });
  });

  describe("context/update", () => {
    it("stores context for a session", async () => {
      server.start();
      await sendAndWait(initMsg);
      outputLines.length = 0;

      const responses = await sendAndWait({
        jsonrpc: "2.0",
        id: 5,
        method: "context/update",
        params: {
          sessionId: "acp-1",
          context: {
            files: [{ path: "/src/app.ts", content: "const x = 1;" }],
          },
        },
      });

      const resp = responses[0] as any;
      expect(resp.result.ok).toBe(true);
    });
  });

  describe("error handling", () => {
    it("returns parse error for invalid JSON", async () => {
      server.start();
      input.push("not valid json\n");
      await tick();

      const responses = getResponses();
      expect(responses).toHaveLength(1);
      const resp = responses[0] as any;
      expect(resp.error.code).toBe(-32700); // Parse error
    });

    it("returns invalid request for non-2.0 jsonrpc", async () => {
      server.start();
      const responses = await sendAndWait({ jsonrpc: "1.0", id: 1, method: "test" });

      const resp = responses[0] as any;
      expect(resp.error.code).toBe(-32600); // Invalid request
    });

    it("returns method not found for unknown methods", async () => {
      server.start();
      const responses = await sendAndWait({
        jsonrpc: "2.0",
        id: 1,
        method: "unknown/method",
      });

      const resp = responses[0] as any;
      expect(resp.error.code).toBe(-32601); // Method not found
      expect(resp.error.message).toContain("unknown/method");
    });
  });

  describe("shutdown", () => {
    it("closes cleanly", () => {
      server.start();
      expect(server.isClosed()).toBe(false);
      server.close();
      expect(server.isClosed()).toBe(true);
    });

    it("does not send after close", async () => {
      server.start();
      server.close();

      sendMessage(input, initMsg);
      await tick();

      // No output should be written after close
      expect(outputLines).toHaveLength(0);
    });

    it("close is idempotent", () => {
      server.start();
      server.close();
      server.close(); // Should not throw
      expect(server.isClosed()).toBe(true);
    });
  });

  describe("session management", () => {
    it("creates new session IDs for messages without sessionId", async () => {
      server.start();
      await sendAndWait(initMsg);
      outputLines.length = 0;

      // Send two messages without sessionId
      await sendAndWait({
        jsonrpc: "2.0",
        id: 10,
        method: "chat/message",
        params: { message: "First" },
      });

      outputLines.length = 0;

      await sendAndWait({
        jsonrpc: "2.0",
        id: 11,
        method: "chat/message",
        params: { message: "Second" },
      });

      // Both should have been injected (bridge called twice total)
      expect(bridge.inject).toHaveBeenCalledTimes(2);

      // First call session should be different from second
      const call1 = (bridge.inject as any).mock.calls[0][0];
      const call2 = (bridge.inject as any).mock.calls[1][0];
      expect(call1).not.toBe(call2);
    });

    it("reuses session when sessionId is provided", async () => {
      server.start();
      await sendAndWait(initMsg);
      outputLines.length = 0;

      await sendAndWait({
        jsonrpc: "2.0",
        id: 10,
        method: "chat/message",
        params: { sessionId: "my-session", message: "First" },
      });

      outputLines.length = 0;

      await sendAndWait({
        jsonrpc: "2.0",
        id: 11,
        method: "chat/message",
        params: { sessionId: "my-session", message: "Second" },
      });

      // Both should use the same WOPR session
      const call1 = (bridge.inject as any).mock.calls[0][0];
      const call2 = (bridge.inject as any).mock.calls[1][0];
      expect(call1).toBe(call2);
    });
  });

  describe("streaming", () => {
    it("sends stream chunks and stream end notifications", async () => {
      // Override bridge to call onStream
      bridge.inject = vi.fn(async (_session, _message, options) => {
        if (options?.onStream) {
          options.onStream({ type: "text", content: "Hello " });
          options.onStream({ type: "text", content: "world" });
        }
        return { response: "Hello world", sessionId: "s1", cost: 0.001 };
      });

      server = new AcpServer({ bridge, defaultSession: "test", input, output });
      server.start();
      await sendAndWait(initMsg);
      outputLines.length = 0;

      const responses = await sendAndWait({
        jsonrpc: "2.0",
        id: 20,
        method: "chat/message",
        params: { message: "Hi" },
      });

      // Should have: streamChunk("Hello "), streamChunk("world"), streamEnd, final response
      const streamChunks = responses.filter((r: any) => r.method === "chat/streamChunk");
      const streamEnds = responses.filter((r: any) => r.method === "chat/streamEnd");
      const finalResp = responses.find((r: any) => r.id === 20);

      expect(streamChunks).toHaveLength(2);
      expect((streamChunks[0] as any).params.delta).toBe("Hello ");
      expect((streamChunks[1] as any).params.delta).toBe("world");
      expect(streamEnds).toHaveLength(1);
      expect(finalResp).toBeDefined();
    });
  });
});
