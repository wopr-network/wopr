/**
 * Event tools: event_emit, event_list
 */

import { eventBus, tool, withSecurityCheck, z } from "./_base.js";

export function createEventTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  tools.push(
    tool(
      "event_emit",
      "Emit a custom event that other sessions/plugins can listen for.",
      {
        event: z.string().describe("Event name (e.g., 'plugin:myagent:task_complete')"),
        payload: z.record(z.string(), z.unknown()).optional().describe("Event payload data"),
      },
      async (args: { event: string; payload?: Record<string, unknown> }) => {
        return withSecurityCheck("event_emit", sessionName, async () => {
          const { event, payload } = args;
          await eventBus.emitCustom(event, payload || {}, sessionName);
          return { content: [{ type: "text", text: `Event '${event}' emitted` }] };
        });
      },
    ),
  );

  tools.push(
    tool("event_list", "List available event types.", {}, async () => {
      const coreEvents = [
        "session:create",
        "session:beforeInject",
        "session:afterInject",
        "session:responseChunk",
        "session:destroy",
        "channel:message",
        "channel:send",
        "plugin:beforeInit",
        "plugin:afterInit",
        "plugin:error",
        "config:change",
        "system:shutdown",
      ];
      return {
        content: [
          {
            type: "text",
            text: `Core events:\n${coreEvents.map((e) => `- ${e}`).join("\n")}\n\nCustom: Use 'plugin:yourname:event' format.`,
          },
        ],
      };
    }),
  );

  return tools;
}
