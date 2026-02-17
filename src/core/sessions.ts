/**
 * Core session management and injection with provider routing
 */
import { existsSync, mkdirSync } from "node:fs";
import { logger } from "../logger.js";
import { SESSIONS_DIR } from "../paths.js";
import {
  checkSessionAccess,
  clearContext,
  createInjectionSource,
  createSecurityContext,
  isEnforcementEnabled,
  storeContext,
} from "../security/index.js";
import type { ProviderConfig } from "../types/provider.js";
import type { ChannelRef, ConversationEntry, StreamMessage } from "../types.js";
import { getA2AMcpServer, isA2AEnabled, setSessionFunctions } from "./a2a-mcp.js";
import { assembleContext, initContextSystem, type MessageInfo } from "./context.js";
import {
  emitMutableIncoming,
  emitMutableOutgoing,
  emitSessionCreate,
  emitSessionDestroy,
  emitSessionResponseChunk,
} from "./events.js";
import { providerRegistry } from "./providers.js";
import {
  appendMessageAsync,
  deleteSessionIdAsync,
  getSessionContextAsync,
  getSessionCreatedAsync,
  getSessionProviderAsync,
  getSessionsAsync,
  listSessionsAsync,
  readConversationLogAsync,
  saveSessionIdAsync,
  setSessionContextAsync,
  setSessionProviderAsync,
} from "./session-repository.js";

// Re-export A2A tool registration for plugins
export {
  listA2ATools,
  registerA2ATool,
  type ToolContext,
  unregisterA2ATool,
} from "./a2a-mcp.js";

// Initialize context system with defaults (async)
initContextSystem();
// Don't block - let it initialize in background

// Export functions for A2A MCP server (deferred to avoid circular imports)
// This is called after module initialization
let sessionFunctionsInitialized = false;
function initSessionFunctions(): void {
  if (sessionFunctionsInitialized) return;
  sessionFunctionsInitialized = true;
  setSessionFunctions({
    inject,
    getSessions,
    readConversationLog: (session: string, limit: number) => readConversationLog(session, limit),
    setSessionContext,
  });
}

// Ensure directories exist
if (!existsSync(SESSIONS_DIR)) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

// ============================================================================
// Session Queue - FIFO Promise Chain (no timeout-cancel!)
// ============================================================================

import { type InjectOptions, type InjectResult, type MultimodalMessage, queueManager } from "./queue/index.js";

// Flag to track if queue executor has been initialized
let queueInitialized = false;

/**
 * Initialize the queue system with the inject executor
 * Called lazily on first inject to avoid circular imports
 */
function initQueue(): void {
  if (queueInitialized) return;
  queueInitialized = true;

  queueManager.setExecutor(executeInjectInternal);

  // Subscribe to queue events for logging
  queueManager.on((event) => {
    if (event.type === "error") {
      const errorDetail = event.data?.error ? `: ${String(event.data.error)}` : "";
      logger.error({
        msg: `[queue] error${errorDetail}`,
        sessionKey: event.sessionKey,
        injectId: event.injectId,
        data: event.data,
      });
    } else if (event.type === "cancel") {
      logger.warn({
        msg: `[queue] ${event.type}`,
        sessionKey: event.sessionKey,
        injectId: event.injectId,
        data: event.data,
      });
    }
  });

  logger.info("[sessions] Queue system initialized");
}

/**
 * Cancel any running inject for a session
 */
export function cancelInject(session: string): boolean {
  return queueManager.cancelActive(session);
}

/**
 * Check if a session has a pending inject (active or queued)
 */
export function hasPendingInject(session: string): boolean {
  return queueManager.hasPending(session);
}

/**
 * Get queue statistics for monitoring
 */
export function getQueueStats(session?: string) {
  if (session) {
    return queueManager.getStats(session);
  }
  return queueManager.getAllStats();
}

export interface Session {
  name: string;
  id?: string;
  context?: string;
  created: number;
  provider?: ProviderConfig;
}

export async function getSessions(): Promise<Record<string, string>> {
  return getSessionsAsync();
}

export async function saveSessionId(name: string, id: string): Promise<void> {
  return saveSessionIdAsync(name, id);
}

export async function deleteSessionId(name: string): Promise<void> {
  return deleteSessionIdAsync(name);
}

export async function getSessionCreated(name: string): Promise<number> {
  return getSessionCreatedAsync(name);
}

export async function getSessionContext(name: string): Promise<string | undefined> {
  return getSessionContextAsync(name);
}

export async function setSessionContext(name: string, context: string): Promise<void> {
  return setSessionContextAsync(name, context);
}

export async function getSessionProvider(name: string): Promise<ProviderConfig | undefined> {
  return getSessionProviderAsync(name);
}

export async function setSessionProvider(name: string, provider: ProviderConfig): Promise<void> {
  return setSessionProviderAsync(name, provider);
}

export async function deleteSession(name: string, reason?: string): Promise<void> {
  // Get conversation history before deletion
  const history = await readConversationLog(name);

  await deleteSessionId(name);

  // Emit session:destroy event
  await emitSessionDestroy(name, history, reason);
}

export async function listSessions(): Promise<Session[]> {
  return listSessionsAsync();
}

// Conversation log functions
export async function appendToConversationLog(name: string, entry: ConversationEntry): Promise<void> {
  return appendMessageAsync(name, entry);
}

/**
 * Log a message to conversation history without triggering a response
 * Used by plugins to capture context from messages not directed at the bot
 */
export async function logMessage(
  session: string,
  content: string,
  options?: { from?: string; senderId?: string; channel?: ChannelRef },
): Promise<void> {
  await appendToConversationLog(session, {
    ts: Date.now(),
    from: options?.from || "unknown",
    senderId: options?.senderId,
    content,
    type: "message",
    channel: options?.channel,
  });
}

export async function readConversationLog(name: string, limit?: number): Promise<ConversationEntry[]> {
  return readConversationLogAsync(name, limit);
}

// Re-export types from queue module for backwards compatibility
export type { InjectOptions, InjectResult, MultimodalMessage } from "./queue/types.js";

export async function inject(
  name: string,
  message: string | MultimodalMessage,
  options?: InjectOptions,
): Promise<InjectResult> {
  // Initialize queue system on first inject
  initQueue();

  // Queue handles everything: FIFO ordering, cancellation
  return queueManager.inject(name, message, options);
}

/**
 * Internal inject execution - called by queue manager
 * @internal
 */
async function executeInjectInternal(
  name: string,
  message: string | MultimodalMessage,
  options: InjectOptions | undefined,
  abortSignal: AbortSignal,
): Promise<InjectResult> {
  const sessions = await getSessions();
  const existingSessionId = sessions[name];
  const context = await getSessionContext(name);
  const silent = options?.silent ?? false;
  const onStream = options?.onStream;
  const from = options?.from ?? "cli";
  const channel = options?.channel;
  const collected: string[] = [];
  let sessionId = existingSessionId || "";

  // SECURITY: Create security context from source (defaults to CLI/owner)
  const injectionSource = options?.source ?? createInjectionSource("cli");
  const securityContext = createSecurityContext(injectionSource, name);

  // Store security context for this session (accessible during request)
  storeContext(securityContext);

  try {
    // SECURITY: Check session access
    const accessCheck = checkSessionAccess(injectionSource, name);
    if (!accessCheck.allowed) {
      if (isEnforcementEnabled()) {
        securityContext.recordEvent("access_denied", {
          allowed: false,
          reason: accessCheck.reason,
        });
        throw new Error(`Access denied: ${accessCheck.reason}`);
      } else {
        // Warn mode - log but continue
        logger.warn(`[security] ${securityContext.requestId}: Access would be denied - ${accessCheck.reason}`);
      }
    } else {
      securityContext.recordEvent("access_granted", {
        allowed: true,
      });
    }

    // Check if aborted
    if (abortSignal?.aborted) {
      throw new Error("Inject cancelled");
    }

    // Normalize message to MultimodalMessage format
    let messageText: string;
    let messageImages: string[] = options?.images || [];

    if (typeof message === "string") {
      messageText = message;
    } else {
      messageText = message.text;
      if (message.images) {
        messageImages = messageImages.concat(message.images);
      }
    }

    // Emit session:create event for new sessions
    if (!existingSessionId) {
      await emitSessionCreate(name, { context, provider: await getSessionProvider(name) });
    }

    if (!silent) {
      logger.info(`[wopr] Injecting into session: ${name}`);
      if (existingSessionId) {
        logger.info(`[wopr] Resuming session: ${existingSessionId}`);
      } else {
        logger.info(`[wopr] Creating new session`);
      }
      if (messageImages.length > 0) {
        logger.info(`[wopr] Images: ${messageImages.length}`);
      }
    }

    // Assemble context using the new provider system
    // Plugins can control which providers to use via contextProviders option
    const messageInfo: MessageInfo = {
      content: messageText,
      from,
      channel,
      timestamp: Date.now(),
    };

    // Plugins can control which providers to use via contextProviders option
    const assembled = await assembleContext(name, messageInfo, {
      providers: options?.contextProviders,
    });

    if (!silent) {
      if (assembled.sources.length > 0) {
        logger.info(`[wopr] Context sources: ${assembled.sources.join(", ")}`);
      }
      if (assembled.warnings.length > 0) {
        for (const w of assembled.warnings) {
          logger.warn(`[wopr] Warning: ${w}`);
        }
      }
    }

    // Log context to conversation log
    if (assembled.context) {
      await appendToConversationLog(name, {
        ts: Date.now(),
        from: "system",
        content: assembled.context,
        type: "context",
        channel,
      });
    }

    // Emit incoming message event for hooks (can transform or block)
    const incomingResult = await emitMutableIncoming(name, messageText, from, channel);

    if (incomingResult.prevented) {
      await appendToConversationLog(name, {
        ts: Date.now(),
        from: "system",
        content: "Message blocked by hook.",
        type: "context",
        channel,
      });
      return { response: "", sessionId };
    }

    const processedMessage = incomingResult.message;

    await appendToConversationLog(name, {
      ts: Date.now(),
      from,
      content: processedMessage + (messageImages.length > 0 ? `\n[Images: ${messageImages.join(", ")}]` : ""),
      type: "message",
      channel,
    });

    // Build full message (context + user message)
    // Context from providers goes before the actual message for conversation flow
    // EXCEPT for slash commands - they must be at the start to be recognized by the SDK
    const isSlashCommand = processedMessage.trim().startsWith("/");

    // Prefix message with sender identity so Claude knows who is speaking
    // Format: "Username: message" (matches conversation_history format)
    const senderPrefix = from && from !== "cli" && from !== "unknown" ? `${from}: ` : "";
    const prefixedMessage = senderPrefix + processedMessage;

    if (!silent) {
      logger.debug({
        msg: "sender prefix",
        from,
        senderPrefix: senderPrefix || "(empty)",
        messagePreview: prefixedMessage.slice(0, 100),
      });
    }

    const fullMessage =
      assembled.context && !isSlashCommand ? `${assembled.context}\n\n${prefixedMessage}` : prefixedMessage;

    // System context is the assembled system + any session file context as fallback
    const fullContext = assembled.system || context || `You are WOPR session "${name}".`;

    // Load provider config from session or auto-detect available provider
    let providerConfig = await getSessionProvider(name);
    if (!providerConfig) {
      // Auto-detect: use first available provider
      const available = providerRegistry.listProviders().filter((p) => p.available);
      if (available.length > 0) {
        providerConfig = {
          name: available[0].id,
        };
        // Save this provider config for the session
        await setSessionProvider(name, providerConfig);
      } else {
        throw new Error(
          "No AI providers available. Install a provider plugin (e.g., wopr plugin install wopr-plugin-provider-anthropic) and restart.",
        );
      }
    }

    // Resolve provider with fallback chain
    const resolvedProvider = await providerRegistry.resolveProvider(providerConfig);
    const providerUsed = resolvedProvider.name;
    if (!silent) logger.info(`[wopr] Using provider: ${providerUsed}`);

    // Initialize session functions for the MCP server (deferred to avoid circular imports)
    initSessionFunctions();

    // Get A2A MCP server if enabled
    const a2aMcpServer = isA2AEnabled() ? getA2AMcpServer(name) : null;
    const mcpServers = a2aMcpServer ? { "wopr-a2a": a2aMcpServer } : undefined;

    // Helper to create query with optional session resume
    // Uses V2 API when available for active session injection support
    const createQuery = (resumeSessionId?: string): AsyncIterable<unknown> => {
      const queryOpts = {
        prompt: fullMessage,
        systemPrompt: fullContext,
        resume: resumeSessionId,
        model: providerConfig?.model || resolvedProvider.provider.defaultModel,
        images: messageImages.length > 0 ? messageImages : undefined,
        mcpServers,
      };

      // Use V1 query with resume + includePartialMessages for incremental streaming.
      // V2 sessions don't support includePartialMessages, so text arrives all at once.
      // V1 with resume gives us both session persistence AND progressive streaming.
      logger.info(
        `[wopr] Using V1 query (streaming) for: ${name}${resumeSessionId ? ` (resume: ${resumeSessionId})` : ""}`,
      );
      return resolvedProvider.client.query(queryOpts) as AsyncIterable<unknown>;
    };

    let q: AsyncIterable<unknown> = createQuery(existingSessionId);
    let sessionResumeRetried = false;

    // Idle timeout - if no message received for 10 minutes, abort
    const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

    // Helper to iterate with idle timeout
    async function* withIdleTimeout<T>(
      iter: AsyncIterable<T>,
      timeoutMs: number,
      signal?: AbortSignal,
    ): AsyncGenerator<T> {
      const iterator = iter[Symbol.asyncIterator]();
      while (true) {
        if (signal?.aborted) {
          throw new Error("Inject cancelled");
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Idle timeout: no message received for ${timeoutMs / 1000}s`)), timeoutMs);
        });

        try {
          const result = await Promise.race([iterator.next(), timeoutPromise]);
          if (result.done) break;
          yield result.value;
        } catch (e) {
          // Try to clean up the iterator
          iterator.return?.();
          throw e;
        }
      }
    }

    try {
      for await (const msgUnknown of withIdleTimeout(q, IDLE_TIMEOUT_MS, abortSignal)) {
        // Check for cancellation
        if (abortSignal?.aborted) {
          logger.info(`[wopr] Inject cancelled mid-stream for session: ${name}`);
          throw new Error("Inject cancelled");
        }

        const msg = msgUnknown as Record<string, unknown> & { type?: string; subtype?: string };
        logger.info(
          `[inject] Got msg type: ${msg.type}, subtype: ${msg.subtype || "none"}, keys: ${Object.keys(msg).join(",")}`,
        );
        switch (msg.type) {
          case "system":
            if (msg.subtype === "init") {
              sessionId = (msg as { session_id?: string }).session_id || "";
              await saveSessionId(name, sessionId);
              if (!silent) logger.info(`[wopr] Session ID: ${sessionId}`);
            }
            // Log compact_metadata for debugging
            if (msg.subtype === "compact_boundary" && (msg as { compact_metadata?: unknown }).compact_metadata) {
              logger.info(
                `[inject] compact_metadata: ${JSON.stringify((msg as { compact_metadata?: unknown }).compact_metadata)}`,
              );
            }
            // Pass all system messages to onStream (including compact_boundary, status, etc.)
            {
              const metadata =
                (msg as { compact_metadata?: Record<string, unknown>; metadata?: Record<string, unknown> })
                  .compact_metadata || (msg as { metadata?: Record<string, unknown> }).metadata;
              const streamMsg: StreamMessage = {
                type: "system",
                content: msg.subtype || "",
                subtype: msg.subtype,
                metadata: metadata || undefined,
              };
              if (onStream) onStream(streamMsg);
            }
            break;
          case "stream_event": {
            // Incremental streaming: extract text deltas from partial messages
            const event = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
            if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
              const delta = event.delta.text;
              if (delta) {
                const streamMsg: StreamMessage = { type: "text", content: delta };
                if (onStream) onStream(streamMsg);
              }
            }
            break;
          }
          case "assistant": {
            // With includePartialMessages, text was already streamed incrementally via stream_event.
            // Here we just collect the final text for the result and handle tool_use blocks.
            const assistantMsg = msg as {
              message?: { content?: Array<{ type: string; text?: string; name?: string }> };
            };
            logger.info(
              `[inject] Processing assistant msg, content blocks: ${assistantMsg.message?.content?.length || 0}`,
            );
            for (const block of assistantMsg.message?.content || []) {
              logger.info(`[inject]   Block type: ${block.type}`);
              if (block.type === "text" && block.text) {
                collected.push(block.text);
                // Emit the response chunk event (for memory capture etc.) but don't re-stream to Discord
                await emitSessionResponseChunk(name, messageText, collected.join(""), from, block.text);
              } else if (block.type === "tool_use" && block.name) {
                // MCP server handles tool execution automatically
                // We just log and stream the tool use for visibility
                if (!silent) logger.info(`[tool] ${block.name}`);
                const streamMsg: StreamMessage = { type: "tool_use", content: "", toolName: block.name };
                if (onStream) onStream(streamMsg);
              }
            }
            break;
          }
          case "result": {
            const resultMsg = msg as { subtype?: string; errors?: unknown; permission_denials?: unknown };
            if (resultMsg.subtype === "success") {
              if (!silent) logger.info(`\n[wopr] Complete (${providerUsed}).`);
              const streamMsg: StreamMessage = { type: "complete", content: "" };
              if (onStream) onStream(streamMsg);
            } else {
              if (!silent) logger.error(`[wopr] Error: ${resultMsg.subtype}`);
              if (resultMsg.errors) {
                logger.error(`[wopr] Error details: ${JSON.stringify(resultMsg.errors)}`);
              }
              if (resultMsg.permission_denials) {
                logger.error(`[wopr] Permission denials: ${JSON.stringify(resultMsg.permission_denials)}`);
              }
              const streamMsg: StreamMessage = { type: "error", content: resultMsg.subtype || "" };
              if (onStream) onStream(streamMsg);
            }
            break;
          }
        }
      }
    } catch (sdkError: unknown) {
      // Check if this is a "No conversation found" error from trying to resume a stale session
      const errorMsg = sdkError instanceof Error ? sdkError.message : "";
      if (!sessionResumeRetried && existingSessionId && errorMsg.includes("process exited with code 1")) {
        // The session might be stale - clear it and retry without resume
        logger.warn(`[wopr] Session resume may have failed, clearing session ID and retrying...`);
        await deleteSessionId(name);
        sessionResumeRetried = true;

        // Create new query without resume
        q = createQuery(undefined);

        // Re-iterate with new query (also with idle timeout)
        for await (const msgUnknown of withIdleTimeout(q, IDLE_TIMEOUT_MS, abortSignal)) {
          if (abortSignal?.aborted) {
            throw new Error("Inject cancelled");
          }

          const msg = msgUnknown as Record<string, unknown> & { type?: string; subtype?: string };
          logger.info(`[inject] Retry msg type: ${msg.type}, subtype: ${msg.subtype || "none"}`);
          switch (msg.type) {
            case "system":
              if (msg.subtype === "init") {
                sessionId = (msg as { session_id?: string }).session_id || "";
                await saveSessionId(name, sessionId);
                if (!silent) logger.info(`[wopr] New session ID: ${sessionId}`);
              }
              // Pass all system messages to onStream
              {
                const metadata =
                  (msg as { compact_metadata?: Record<string, unknown>; metadata?: Record<string, unknown> })
                    .compact_metadata || (msg as { metadata?: Record<string, unknown> }).metadata;
                const streamMsg: StreamMessage = {
                  type: "system",
                  content: msg.subtype || "",
                  subtype: msg.subtype,
                  metadata: metadata || undefined,
                };
                if (onStream) onStream(streamMsg);
              }
              break;
            case "stream_event": {
              const event = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
              if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
                const delta = event.delta.text;
                if (delta) {
                  const streamMsg: StreamMessage = { type: "text", content: delta };
                  if (onStream) onStream(streamMsg);
                }
              }
              break;
            }
            case "assistant": {
              const assistantMsg = msg as {
                message?: { content?: Array<{ type: string; text?: string; name?: string }> };
              };
              for (const block of assistantMsg.message?.content || []) {
                if (block.type === "text" && block.text) {
                  collected.push(block.text);
                  await emitSessionResponseChunk(name, messageText, collected.join(""), from, block.text);
                } else if (block.type === "tool_use" && block.name) {
                  if (!silent) logger.info(`[tool] ${block.name}`);
                  const streamMsg: StreamMessage = { type: "tool_use", content: "", toolName: block.name };
                  if (onStream) onStream(streamMsg);
                }
              }
              break;
            }
            case "result":
              if (msg.subtype === "success") {
                if (!silent) logger.info(`[wopr] Complete (retry).`);
              }
              break;
          }
        }
      } else {
        const error = sdkError instanceof Error ? sdkError : new Error(String(sdkError));
        logger.error(`[wopr] SDK error during query iteration: ${error.message}`);
        if (error.stack) {
          logger.error(`[wopr] SDK error stack: ${error.stack}`);
        }
        throw error;
      }
    }

    let response = collected.join("");

    // Emit outgoing response event for hooks (can transform or block)
    const outgoingResult = await emitMutableOutgoing(name, response, from, channel);

    if (outgoingResult.prevented) {
      await appendToConversationLog(name, {
        ts: Date.now(),
        from: "system",
        content: "Response blocked by hook.",
        type: "context",
        channel,
      });
      return { response: "", sessionId };
    }

    response = outgoingResult.response;

    // Log response to conversation log
    if (response) {
      await appendToConversationLog(name, {
        ts: Date.now(),
        from: "WOPR",
        content: response,
        type: "response",
        channel,
      });
    }

    // Update last trigger timestamp for progressive context
    // This marks the end of this interaction, so next trigger gets context since now
    const { updateLastTriggerTimestamp } = await import("./context.js");
    updateLastTriggerTimestamp(name);

    return { response, sessionId };
  } finally {
    // SECURITY: Always clear context when request completes
    clearContext(name);
  }
}
