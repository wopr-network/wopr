/**
 * Session tools: sessions_list, sessions_send, sessions_history, sessions_spawn
 */

import {
  getContext,
  getSessions,
  injectFn,
  isEnforcementEnabled,
  logger,
  readConversationLog,
  setSessionContext,
  tool,
  withSecurityCheck,
  z,
} from "./_base.js";

export function createSessionTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  tools.push(
    tool(
      "sessions_list",
      "List all active WOPR sessions with metadata. Use this to discover other sessions/agents you can communicate with.",
      {
        limit: z.number().optional().describe("Maximum number of sessions to return (default: 50)"),
      },
      async (args: { limit?: number }) => {
        if (!getSessions) throw new Error("Session functions not initialized");
        const sessions = await getSessions();
        let sessionList = Object.keys(sessions).map((key) => ({
          name: key,
          id: sessions[key],
        }));
        const limit = args.limit ?? 50;
        if (limit > 0 && sessionList.length > limit) {
          sessionList = sessionList.slice(0, limit);
        }
        return {
          content: [
            { type: "text", text: JSON.stringify({ sessions: sessionList, count: sessionList.length }, null, 2) },
          ],
        };
      },
    ),
  );

  tools.push(
    tool(
      "sessions_send",
      "Send a message to another WOPR session. Use this to delegate tasks, ask questions, or coordinate with other sessions.",
      {
        session: z.string().describe("Target session name (e.g., 'code-reviewer', 'discord-123456')"),
        message: z.string().describe("The message to send to the target session"),
      },
      async (args: { session: string; message: string }) => {
        return withSecurityCheck("sessions_send", sessionName, async () => {
          if (!injectFn) throw new Error("Session functions not initialized");
          const { session, message } = args;

          logger.info(`[a2a-mcp] sessions_send: ${sessionName} -> ${session} (${message.length} chars)`);

          if (session === sessionName) {
            logger.warn(`[a2a-mcp] sessions_send: Blocking self-inject attempt from ${sessionName}`);
            return {
              content: [{ type: "text", text: "Error: Cannot send message to yourself - this would cause a deadlock" }],
              isError: true,
            };
          }

          try {
            const response = await injectFn(session, message, { from: sessionName, silent: true });
            logger.info(`[a2a-mcp] sessions_send: ${sessionName} -> ${session} completed`);
            return {
              content: [{ type: "text", text: `Response from ${session}:\n${response.response}` }],
            };
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(`[a2a-mcp] sessions_send: ${sessionName} -> ${session} failed: ${errMsg}`);
            return {
              content: [{ type: "text", text: `Error sending to ${session}: ${errMsg}` }],
              isError: true,
            };
          }
        });
      },
    ),
  );

  tools.push(
    tool(
      "sessions_history",
      "Fetch conversation history from a session. Use full=true to get complete untruncated history (the session mirror). Requires cross.read capability for reading other sessions' history.",
      {
        session: z.string().describe("Session name to fetch history from"),
        limit: z
          .number()
          .optional()
          .describe("Number of recent messages to fetch (default: 10, ignored when full=true)"),
        full: z.boolean().optional().describe("Return complete untruncated history - the full mirror (default: false)"),
        offset: z
          .number()
          .optional()
          .describe("Skip this many messages from the start (for pagination, only with full=true)"),
      },
      async (args: { session: string; limit?: number; full?: boolean; offset?: number }) => {
        return withSecurityCheck("sessions_history", sessionName, async () => {
          if (!readConversationLog) throw new Error("Session functions not initialized");
          const { session, limit = 10, full = false, offset = 0 } = args;

          if (session !== sessionName) {
            const ctx = getContext(sessionName);
            if (ctx && !ctx.hasCapability("cross.read")) {
              if (isEnforcementEnabled()) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Access denied: Reading other sessions' history requires 'cross.read' capability`,
                    },
                  ],
                  isError: true,
                };
              } else {
                logger.warn(
                  `[a2a-mcp] sessions_history: ${sessionName} reading ${session} history without cross.read capability`,
                );
              }
            }
          }

          if (full) {
            const allEntries = await readConversationLog(session, 0);
            const totalCount = allEntries.length;
            const pageSize = limit > 0 ? limit : 100;
            const startIdx = offset;
            const endIdx = startIdx + pageSize;
            const entries = allEntries.slice(startIdx, endIdx);
            const hasMore = endIdx < totalCount;
            const nextOffset = hasMore ? endIdx : null;

            const history = entries.map((e) => ({
              ts: e.ts,
              iso: new Date(e.ts).toISOString(),
              from: e.from,
              type: e.type,
              content: e.content,
              channel: e.channel,
            }));

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      session,
                      total: totalCount,
                      offset: startIdx,
                      pageSize,
                      returned: history.length,
                      hasMore,
                      nextOffset,
                      history,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } else {
            const entries = await readConversationLog(session, Math.min(limit, 50));
            const formatted = entries
              .map(
                (e) =>
                  `[${new Date(e.ts).toISOString()}] ${e.from}: ${e.content?.substring(0, 200)}${e.content?.length > 200 ? "..." : ""}`,
              )
              .join("\n");
            return {
              content: [{ type: "text", text: formatted || "No history found for this session." }],
            };
          }
        });
      },
    ),
  );

  tools.push(
    tool(
      "sessions_spawn",
      "Create a new session with a specific purpose. The new session will be initialized with your description.",
      {
        name: z.string().describe("Name for the new session (e.g., 'python-reviewer')"),
        purpose: z.string().describe("Describe what this session should do (becomes its system context)"),
      },
      async (args: { name: string; purpose: string }) => {
        return withSecurityCheck("sessions_spawn", sessionName, async () => {
          if (!setSessionContext) throw new Error("Session functions not initialized");
          const { name, purpose } = args;
          await setSessionContext(name, purpose);
          return {
            content: [{ type: "text", text: `Session '${name}' created successfully with purpose: ${purpose}` }],
          };
        });
      },
    ),
  );

  return tools;
}
