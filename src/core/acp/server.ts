/**
 * ACP Server — NDJSON-over-stdio transport for IDE integration.
 *
 * Reads JSON-RPC requests from stdin (newline-delimited), processes them,
 * and writes JSON-RPC responses/notifications to stdout.
 *
 * Designed to be launched by editors (Zed, VS Code) as a subprocess.
 */
import type { Readable, Writable } from "node:stream";
import { logger } from "../../logger.js";
import { clearEditorContext, formatEditorContext, updateEditorContext } from "./context.js";
import {
  ACP_PROTOCOL_VERSION,
  AcpChatCancelRequestSchema,
  AcpChatMessageRequestSchema,
  AcpContextUpdateRequestSchema,
  AcpInitializeRequestSchema,
  type AcpInitializeResult,
  createError,
  createResponse,
  type JsonRpcResponse,
  RPC_INTERNAL_ERROR,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
} from "./types.js";

// ============================================================================
// Session bridge interface — decouples ACP from direct session imports
// ============================================================================

export interface AcpSessionBridge {
  inject(
    session: string,
    message: string,
    options?: {
      silent?: boolean;
      from?: string;
      onStream?: (msg: { type: string; content: string }) => void;
    },
  ): Promise<{ response: string; sessionId: string; cost: number }>;
  cancelInject(session: string): boolean;
}

// ============================================================================
// NDJSON Parser
// ============================================================================

/**
 * Parse a single NDJSON line into a JSON object.
 * Returns null on parse failure.
 */
export function parseNdjsonLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Serialize a JSON-RPC message to an NDJSON line (with trailing newline).
 */
export function serializeNdjson(msg: unknown): string {
  return `${JSON.stringify(msg)}\n`;
}

// ============================================================================
// ACP Server
// ============================================================================

export interface AcpServerOptions {
  bridge: AcpSessionBridge;
  defaultSession?: string;
  input?: Readable;
  output?: Writable;
}

export class AcpServer {
  private bridge: AcpSessionBridge;
  private defaultSession: string;
  private input: Readable;
  private output: Writable;
  private initialized = false;
  private buffer = "";
  private closed = false;

  // Track active sessions created via ACP (sessionId -> wopr session name)
  private sessions = new Map<string, string>();
  private sessionCounter = 0;

  constructor(options: AcpServerOptions) {
    this.bridge = options.bridge;
    this.defaultSession = options.defaultSession ?? "acp";
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
  }

  /**
   * Start listening for NDJSON messages on stdin.
   */
  start(): void {
    this.input.setEncoding("utf-8");
    this.input.on("data", (chunk: string) => this.onData(chunk));
    this.input.on("end", () => this.close());
    this.input.on("error", (err) => {
      logger.error(`[acp] stdin error: ${err.message}`);
      this.close();
    });
    logger.info("[acp] Server started, listening on stdin");
  }

  /**
   * Gracefully shut down the server.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Clean up stored editor context for all sessions
    for (const sessionId of this.sessions.keys()) {
      clearEditorContext(sessionId);
    }
    this.sessions.clear();
    logger.info("[acp] Server closed");
  }

  /**
   * Whether the server has been closed.
   */
  isClosed(): boolean {
    return this.closed;
  }

  // ---- Internal ----

  private onData(chunk: string): void {
    this.buffer += chunk;
    // Split on newlines - each complete line is one NDJSON message
    const lines = this.buffer.split("\n");
    // Last element is incomplete (or empty if chunk ended with \n)
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      void this.handleLine(line);
    }
  }

  private async handleLine(line: string): Promise<void> {
    const parsed = parseNdjsonLine(line);
    if (parsed === null) {
      this.send(createError(undefined, RPC_PARSE_ERROR, "Parse error"));
      return;
    }

    const msg = parsed as Record<string, unknown>;
    if (msg.jsonrpc !== "2.0") {
      this.send(createError(msg.id as string | number | undefined, RPC_INVALID_REQUEST, "Invalid JSON-RPC version"));
      return;
    }

    const method = msg.method as string | undefined;
    const id = msg.id as string | number | undefined;

    try {
      switch (method) {
        case "initialize":
          await this.handleInitialize(msg, id);
          break;
        case "chat/message":
          await this.handleChatMessage(msg, id);
          break;
        case "chat/cancel":
          await this.handleChatCancel(msg, id);
          break;
        case "context/update":
          await this.handleContextUpdate(msg, id);
          break;
        default:
          this.send(createError(id, RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`));
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[acp] Error handling ${method}: ${errMsg}`);
      this.send(createError(id, RPC_INTERNAL_ERROR, errMsg));
    }
  }

  private async handleInitialize(msg: Record<string, unknown>, id: string | number | undefined): Promise<void> {
    const result = AcpInitializeRequestSchema.safeParse(msg);
    if (!result.success) {
      this.send(createError(id, RPC_INVALID_PARAMS, "Invalid initialize params"));
      return;
    }

    this.initialized = true;

    const response: AcpInitializeResult = {
      protocolVersion: ACP_PROTOCOL_VERSION,
      serverInfo: {
        name: "wopr-acp",
        version: "1.0.0",
      },
      capabilities: {
        context: true,
        streaming: true,
      },
    };

    logger.info(
      `[acp] Initialized with client: ${result.data.params.clientInfo.name} ${result.data.params.clientInfo.version}`,
    );
    this.send(createResponse(id, response));
  }

  private async handleChatMessage(msg: Record<string, unknown>, id: string | number | undefined): Promise<void> {
    if (!this.initialized) {
      this.send(createError(id, RPC_INVALID_REQUEST, "Not initialized"));
      return;
    }

    const result = AcpChatMessageRequestSchema.safeParse(msg);
    if (!result.success) {
      this.send(createError(id, RPC_INVALID_PARAMS, "Invalid chat/message params"));
      return;
    }

    const params = result.data.params;

    // Resolve or create session
    const sessionId = params.sessionId ?? this.createSessionId();
    const woprSession = this.resolveWoprSession(sessionId);

    // Build context-enriched message
    const editorContext = formatEditorContext(params, sessionId);
    const fullMessage = editorContext ? `${editorContext}\n\n${params.message}` : params.message;

    // Inject into WOPR session with streaming
    const injectResult = await this.bridge.inject(woprSession, fullMessage, {
      silent: true,
      from: "acp",
      onStream: (streamMsg) => {
        if (streamMsg.type === "text") {
          // Send streaming notification
          this.sendNotification("chat/streamChunk", {
            sessionId,
            delta: streamMsg.content,
          });
        }
      },
    });

    // Send stream end notification
    this.sendNotification("chat/streamEnd", { sessionId });

    // Send final response
    this.send(
      createResponse(id, {
        sessionId,
        content: injectResult.response,
        cost: injectResult.cost,
      }),
    );
  }

  private async handleChatCancel(msg: Record<string, unknown>, id: string | number | undefined): Promise<void> {
    if (!this.initialized) {
      this.send(createError(id, RPC_INVALID_REQUEST, "Not initialized"));
      return;
    }

    const result = AcpChatCancelRequestSchema.safeParse(msg);
    if (!result.success) {
      this.send(createError(id, RPC_INVALID_PARAMS, "Invalid chat/cancel params"));
      return;
    }

    const woprSession = this.sessions.get(result.data.params.sessionId);
    if (woprSession) {
      const cancelled = this.bridge.cancelInject(woprSession);
      this.send(createResponse(id, { cancelled }));
    } else {
      this.send(createResponse(id, { cancelled: false }));
    }
  }

  private async handleContextUpdate(msg: Record<string, unknown>, id: string | number | undefined): Promise<void> {
    if (!this.initialized) {
      this.send(createError(id, RPC_INVALID_REQUEST, "Not initialized"));
      return;
    }

    const result = AcpContextUpdateRequestSchema.safeParse(msg);
    if (!result.success) {
      this.send(createError(id, RPC_INVALID_PARAMS, "Invalid context/update params"));
      return;
    }

    const sessionId = result.data.params.sessionId;
    // Ensure session is tracked so close() will clear its context
    this.resolveWoprSession(sessionId);
    updateEditorContext(sessionId, result.data.params);
    this.send(createResponse(id, { ok: true }));
  }

  private createSessionId(): string {
    const id = `acp-${++this.sessionCounter}`;
    this.sessions.set(id, `${this.defaultSession}-${this.sessionCounter}`);
    return id;
  }

  private resolveWoprSession(sessionId: string): string {
    let woprSession = this.sessions.get(sessionId);
    if (!woprSession) {
      woprSession = `${this.defaultSession}-${sessionId}`;
      this.sessions.set(sessionId, woprSession);
    }
    return woprSession;
  }

  private send(msg: JsonRpcResponse): void {
    if (this.closed) return;
    this.output.write(serializeNdjson(msg));
  }

  private sendNotification(method: string, params: unknown): void {
    if (this.closed) return;
    this.output.write(serializeNdjson({ jsonrpc: "2.0", method, params }));
  }
}
