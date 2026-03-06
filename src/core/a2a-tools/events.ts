/**
 * Event tools: event_emit, event_list
 */

import { getEventTypeRegistry } from "../event-type-registry.js";
import { eventBus, tool, withSecurityCheck, z } from "./_base.js";

export function createEventTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  tools.push(
    tool(
      "event_emit",
      "Emit a custom event that other sessions/plugins can listen for. The event type must be registered (core events are always available; plugin events must be registered via ctx.events.registerEventType).",
      {
        event: z.string().describe("Event name (e.g., 'cron.fired', 'plugin:myagent:task_complete')"),
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
    tool("event_list", "List available event types (core + plugin-registered).", {}, async () => {
      const registry = getEventTypeRegistry();
      const allTypes = registry.getAllEventTypes();
      const pluginTypes = registry.getPluginEventTypes();

      const coreLines: string[] = [];
      const pluginLines: string[] = [];

      for (const t of allTypes) {
        const pluginReg = pluginTypes.get(t);
        if (pluginReg) {
          const desc = pluginReg.registration.description ? ` — ${pluginReg.registration.description}` : "";
          pluginLines.push(`- ${t} (${pluginReg.pluginName})${desc}`);
        } else {
          coreLines.push(`- ${t}`);
        }
      }

      let text = `Core events:\n${coreLines.join("\n")}`;
      if (pluginLines.length > 0) {
        text += `\n\nPlugin events:\n${pluginLines.join("\n")}`;
      }

      return { content: [{ type: "text", text }] };
    }),
  );

  return tools;
}
