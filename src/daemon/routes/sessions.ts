/**
 * Sessions API routes
 */

import { Hono } from "hono";
import { stream } from "hono/streaming";
import {
  deleteSession,
  getSessionContext,
  getSessions,
  inject,
  listSessions,
  logMessage,
  readConversationLog,
  setSessionContext,
} from "../../core/sessions.js";
import { createInjectionSource } from "../../security/index.js";
import { validateSessionName } from "../validation.js";
import { broadcastInjection, broadcastStream } from "../ws.js";

export const sessionsRouter = new Hono();

// List all sessions
sessionsRouter.get("/", async (c) => {
  const sessions = await listSessions();
  return c.json({ sessions });
});

// Get session details
sessionsRouter.get("/:name", async (c) => {
  const name = c.req.param("name");
  validateSessionName(name);
  const sessions = await getSessions();
  const context = await getSessionContext(name);

  if (!sessions[name] && !context) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json({
    name,
    id: sessions[name] || null,
    context: context || null,
  });
});

// Get conversation history
sessionsRouter.get("/:name/conversation", async (c) => {
  const name = c.req.param("name");
  validateSessionName(name);
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const entries = await readConversationLog(name, limit);

  return c.json({
    name,
    entries,
    count: entries.length,
  });
});

// Create session
sessionsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const { name, context } = body;

  if (!name) {
    return c.json({ error: "Name is required" }, 400);
  }

  validateSessionName(name);

  const defaultContext = context || `You are WOPR session "${name}".`;
  await setSessionContext(name, defaultContext);

  return c.json(
    {
      name,
      context: defaultContext,
      created: true,
    },
    201,
  );
});

// Update session context
sessionsRouter.put("/:name", async (c) => {
  const name = c.req.param("name");
  validateSessionName(name);
  const body = await c.req.json();
  const { context } = body;

  if (!context) {
    return c.json({ error: "Context is required" }, 400);
  }

  await setSessionContext(name, context);

  return c.json({
    name,
    context,
    updated: true,
  });
});

// Delete session
sessionsRouter.delete("/:name", async (c) => {
  const name = c.req.param("name");
  validateSessionName(name);
  await deleteSession(name, "api_delete");
  return c.json({ deleted: true });
});

// Inject message - returns streaming response via SSE
sessionsRouter.post("/:name/inject", async (c) => {
  const name = c.req.param("name");
  validateSessionName(name);
  const body = await c.req.json();
  const { message, from = "api" } = body;

  if (!message) {
    return c.json({ error: "Message is required" }, 400);
  }

  // Check if client wants streaming
  const acceptSSE = c.req.header("Accept")?.includes("text/event-stream");

  if (acceptSSE) {
    // Streaming response via SSE
    return stream(c, async (stream) => {
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");

      const result = await inject(name, message, {
        silent: true,
        from,
        // SECURITY: API requests come from daemon with owner trust level
        // (daemon is local, authenticated implicitly)
        source: createInjectionSource("daemon"),
        onStream: (msg) => {
          // Send SSE event
          const data = JSON.stringify({
            type: msg.type,
            content: msg.content,
            toolName: msg.toolName,
          });
          stream.write(`data: ${data}\n\n`);

          // Broadcast to WebSocket clients
          broadcastStream(name, from, msg);
        },
      });

      // Send completion event
      stream.write(
        `data: ${JSON.stringify({
          type: "done",
          sessionId: result.sessionId,
        })}\n\n`,
      );

      // Broadcast injection completion
      broadcastInjection(name, from, message, result.response);
    });
  } else {
    // Non-streaming response
    const result = await inject(name, message, {
      silent: true,
      from,
      // SECURITY: API requests come from daemon with owner trust level
      source: createInjectionSource("daemon"),
      onStream: (msg) => {
        broadcastStream(name, from, msg);
      },
    });

    broadcastInjection(name, from, message, result.response);

    return c.json({
      session: name,
      sessionId: result.sessionId,
      response: result.response,
    });
  }
});

// Log message without triggering a response
sessionsRouter.post("/:name/log", async (c) => {
  const name = c.req.param("name");
  validateSessionName(name);
  const body = await c.req.json();
  const { message, from = "api" } = body;

  if (!message) {
    return c.json({ error: "Message is required" }, 400);
  }

  await logMessage(name, message, { from });

  return c.json({
    session: name,
    logged: true,
  });
});

// Initialize self-documentation files in SQL (SOUL.md, AGENTS.md, etc.) — WOP-556
sessionsRouter.post("/:name/init-docs", async (c) => {
  const name = c.req.param("name");
  validateSessionName(name);
  const body = await c.req.json();
  const { agentName, userName } = body;

  // Check session exists
  const sessions = await getSessions();
  const context = await getSessionContext(name);
  if (!sessions[name] && !context) {
    return c.json({ error: "Session not found" }, 404);
  }

  const {
    getSessionContext: getSqlContext,
    setSessionContext: setSqlContext,
    initSessionContextStorage,
  } = await import("../../core/session-context-repository.js");

  await initSessionContextStorage();

  const createdFiles: string[] = [];

  const writeIfMissing = async (filename: string, content: string) => {
    const existing = await getSqlContext(name, filename);
    if (existing === null) {
      await setSqlContext(name, filename, content, "session");
      createdFiles.push(filename);
    }
  };

  // IDENTITY.md - Agent self-definition
  await writeIfMissing(
    "IDENTITY.md",
    `# IDENTITY.md - About Yourself

## Identity
**Name:** ${agentName || `${name} Assistant`}
**Vibe:** Helpful, concise, occasionally witty
**Emoji:** \u{1F916}
**Version:** 1.0

## Purpose
You are a WOPR session - an AI assistant that helps your human with tasks,
remembers context across conversations, and can be extended through plugins.

## Capabilities
- Execute shell commands
- Read and write files
- Search and analyze code
- Communicate via multiple channels`,
  );

  // AGENTS.md - Session instructions
  await writeIfMissing(
    "AGENTS.md",
    `# AGENTS.md - Session Instructions

## Every Session

Before doing anything else:
1. **Read SOUL.md** — this is who you are
2. **Read USER.md** — this is who you're helping
3. **Read MEMORY.md** — long-term important memories
4. **Check memory/YYYY-MM-DD.md** — recent daily notes

Do not ask permission to read these files. Just do it.

## Safety Rules

- Never expose API keys, tokens, or credentials in responses
- Confirm destructive actions before executing
- Respect file permissions and privacy
- If unsure about a command, ask before executing

## Tool Usage

- Prefer reading files over asking "what's in the file?"
- Use search to find relevant code before modifying
- Batch related file operations when possible
- Clean up temporary files after use`,
  );

  // USER.md - User profile
  await writeIfMissing(
    "USER.md",
    `# USER.md - About Your Human

## Profile
**Name:** ${userName || "Unknown"}

## Context

*This file is populated over time as you learn about your human.*

## Preferences
- *To be filled in as learned*

## Important Facts
- *To be filled in as learned*`,
  );

  // MEMORY.md - Long-term memory (empty initially)
  await writeIfMissing(
    "MEMORY.md",
    `# MEMORY.md - Long-term Memories

## Important Decisions

## Key Learnings

## User Preferences (persisted facts)

## Project Context`,
  );

  // Note: `path` field is intentionally omitted — files are stored in SQL (WOP-556),
  // not on the filesystem, so there is no meaningful path to return. No client
  // (src/client.ts initSessionDocs) or CLI consumer reads a `path` field.
  return c.json({
    session: name,
    created: createdFiles,
  });
});
