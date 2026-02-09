# Anthropic Provider V2 Session Support

## Overview

V2 session support allows injecting messages into active streaming sessions.
When Claude is mid-response, a new message can be sent that Claude sees immediately.

## Implementation for `wopr-plugin-provider-anthropic`

### Add to `index.ts`:

```typescript
// =============================================================================
// V2 Active Session Support
// =============================================================================

interface ActiveSession {
  sessionKey: string;
  sessionId: string;  // Claude's internal session ID
  startTime: number;
  /** Queue for messages to inject into the stream */
  pendingMessages: Array<{
    message: string;
    resolve: () => void;
    reject: (error: Error) => void;
  }>;
  /** Signal that this session is still streaming */
  isStreaming: boolean;
}

// Track active streaming sessions by WOPR session key
const activeSessions = new Map<string, ActiveSession>();

/**
 * Check if there's an active streaming session for this key
 */
function hasActiveSession(sessionKey: string): boolean {
  const session = activeSessions.get(sessionKey);
  return session?.isStreaming ?? false;
}

/**
 * Send a message to an active streaming session
 * The message will be queued and injected when the SDK supports it
 *
 * NOTE: The Claude Code SDK doesn't currently support mid-stream injection.
 * This is a placeholder for when that feature becomes available.
 * For now, we queue messages and they get processed on the next turn.
 */
async function sendToActiveSession(sessionKey: string, message: string): Promise<void> {
  const session = activeSessions.get(sessionKey);
  if (!session?.isStreaming) {
    throw new Error(`No active session for key: ${sessionKey}`);
  }

  logger.info({
    msg: "[anthropic] V2 sendToActiveSession",
    sessionKey,
    sessionId: session.sessionId,
    messageLength: message.length,
  });

  // For now, queue the message - it will be sent on next query
  // When SDK supports mid-stream injection, this will change
  return new Promise((resolve, reject) => {
    session.pendingMessages.push({ message, resolve, reject });
  });
}

// =============================================================================
// Updated AnthropicClient with V2 Support
// =============================================================================

class AnthropicClient implements ModelClient {
  private authType: string;

  constructor(private credential: string, private options?: Record<string, unknown>) {
    // ... existing constructor code ...
  }

  /**
   * V2: Check if there's an active streaming session
   */
  hasActiveSession(sessionKey: string): boolean {
    return hasActiveSession(sessionKey);
  }

  /**
   * V2: Send to active session
   */
  async sendToActiveSession(sessionKey: string, message: string): Promise<void> {
    return sendToActiveSession(sessionKey, message);
  }

  /**
   * V2 Query - tracks session state for V2 injection support
   */
  async *queryV2(opts: ModelQueryOptions & { sessionKey: string }): AsyncGenerator<unknown> {
    const { sessionKey, ...queryOpts } = opts;
    const model = opts.model || anthropicProvider.defaultModel;

    // Check for pending V2 messages to prepend
    const existingSession = activeSessions.get(sessionKey);
    let pendingContext = "";
    if (existingSession?.pendingMessages.length) {
      // Drain pending messages and prepend to prompt
      const messages = existingSession.pendingMessages.splice(0);
      pendingContext = messages.map(m => m.message).join("\n\n") + "\n\n";
      // Resolve all pending promises
      messages.forEach(m => m.resolve());
      logger.info({
        msg: "[anthropic] Prepending V2 queued messages",
        sessionKey,
        count: messages.length,
      });
    }

    const prompt = pendingContext + opts.prompt;

    const queryOptions: any = {
      max_tokens: opts.maxTokens || 4096,
      model,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    };

    if (opts.systemPrompt) queryOptions.systemPrompt = opts.systemPrompt;
    if (opts.resume) queryOptions.resume = opts.resume;
    if (opts.temperature !== undefined) queryOptions.temperature = opts.temperature;
    if (opts.topP !== undefined) queryOptions.topP = opts.topP;
    if (opts.mcpServers) queryOptions.mcpServers = opts.mcpServers;

    // Handle images...
    // (existing image handling code)

    try {
      const q = query({ prompt, options: queryOptions });

      // Track this as an active session
      let sessionId = "";

      for await (const msg of q) {
        // Capture session ID on init
        if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
          sessionId = msg.session_id;
          logger.info(`[anthropic] V2 session initialized: ${sessionId} (key: ${sessionKey})`);

          // Register as active session
          activeSessions.set(sessionKey, {
            sessionKey,
            sessionId,
            startTime: Date.now(),
            pendingMessages: existingSession?.pendingMessages || [],
            isStreaming: true,
          });
        }

        yield msg;

        // Check for completion
        if (msg.type === "result") {
          // Mark session as no longer streaming
          const session = activeSessions.get(sessionKey);
          if (session) {
            session.isStreaming = false;
            // Don't delete - keep for resume support
            logger.info({
              msg: "[anthropic] V2 session complete",
              sessionKey,
              sessionId: session.sessionId,
              duration: Date.now() - session.startTime,
            });
          }
        }
      }
    } catch (error) {
      // Clean up on error
      const session = activeSessions.get(sessionKey);
      if (session) {
        session.isStreaming = false;
        // Reject any pending V2 messages
        session.pendingMessages.forEach(m =>
          m.reject(new Error(`Session ended with error: ${error}`))
        );
        session.pendingMessages = [];
      }
      throw error;
    }
  }

  // ... existing methods ...
}
```

### Update ModelClient interface in types:

```typescript
interface ModelClient {
  query(options: ModelQueryOptions): AsyncGenerator<unknown>;
  listModels(): Promise<string[]>;
  healthCheck(): Promise<boolean>;

  // V2 Session Support (optional)
  hasActiveSession?(sessionKey: string): boolean;
  sendToActiveSession?(sessionKey: string, message: string): Promise<void>;
  queryV2?(options: ModelQueryOptions & { sessionKey: string }): AsyncGenerator<unknown>;
}
```

## How It Works

1. **Query starts** → Session registered in `activeSessions` with `isStreaming: true`
2. **Mid-stream message** → `sendToActiveSession()` queues the message
3. **Next query** → Queued messages prepended to prompt
4. **Query ends** → `isStreaming` set to false

## Limitations

The Claude Code SDK doesn't currently support true mid-stream message injection.
This implementation queues messages and includes them in the next query.

For true mid-stream injection, we would need:
- SDK support for sending messages to an active stream
- Or a custom implementation using the raw Anthropic API

## Future Enhancement

When SDK supports it, `sendToActiveSession` would directly inject:

```typescript
async function sendToActiveSession(sessionKey: string, message: string): Promise<void> {
  const session = activeSessions.get(sessionKey);
  if (!session?.isStreaming) {
    throw new Error(`No active session for key: ${sessionKey}`);
  }

  // Future: Direct injection
  // await session.queryInstance.sendMessage(message);
}
```
