/**
 * Notify tool: notify
 */

import { eventBus, logger, tool, z } from "./_base.js";

export function createNotifyTools(sessionName: string): any[] {
  const tools: any[] = [];

  tools.push(
    tool(
      "notify",
      "Send a notification to configured channels.",
      {
        message: z.string().describe("Notification message"),
        level: z.string().optional().describe("Level: info, warn, error"),
        channel: z.string().optional().describe("Specific channel to notify"),
      },
      async (args: any) => {
        const { message, level = "info", channel } = args;
        const logLevel = level === "error" ? "error" : level === "warn" ? "warn" : "info";
        logger[logLevel](`[NOTIFY] ${message}`);

        await eventBus.emitCustom(
          "notification:send",
          { message, level, channel, fromSession: sessionName },
          sessionName,
        );

        return { content: [{ type: "text", text: `Notification sent: [${level.toUpperCase()}] ${message}` }] };
      },
    ),
  );

  return tools;
}
