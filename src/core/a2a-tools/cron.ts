/**
 * Cron tools: cron_schedule, cron_once, cron_list, cron_cancel, cron_history
 */

import {
  addCron,
  createOnceJob,
  getContext,
  getCronHistory,
  getCrons,
  isEnforcementEnabled,
  logger,
  removeCron,
  tool,
  withSecurityCheck,
  z,
} from "./_base.js";

export function createCronTools(sessionName: string): any[] {
  const tools: any[] = [];

  tools.push(
    tool(
      "cron_schedule",
      "Schedule a recurring cron job that sends a message to a session. Requires cross.inject capability when targeting other sessions.",
      {
        name: z.string().describe("Unique name for this cron job"),
        schedule: z.string().describe("Cron schedule (e.g., '0 9 * * *' for 9am daily)"),
        session: z.string().describe("Target session to receive the message"),
        message: z.string().describe("Message to inject into the session"),
      },
      async (args: any) => {
        return withSecurityCheck("cron_schedule", sessionName, async () => {
          const { name, schedule, session, message } = args;
          if (session !== sessionName) {
            const ctx = getContext(sessionName);
            if (ctx && !ctx.hasCapability("cross.inject")) {
              if (isEnforcementEnabled())
                return {
                  content: [
                    {
                      type: "text",
                      text: `Access denied: Scheduling cron jobs for other sessions requires 'cross.inject' capability`,
                    },
                  ],
                  isError: true,
                };
              else
                logger.warn(
                  `[a2a-mcp] cron_schedule: ${sessionName} targeting ${session} without cross.inject capability`,
                );
            }
          }
          addCron({ name, schedule, session, message });
          return { content: [{ type: "text", text: `Cron job '${name}' scheduled: ${schedule} -> ${session}` }] };
        });
      },
    ),
  );

  tools.push(
    tool(
      "cron_once",
      "Schedule a one-time message. Supports relative (+5m, +1h), absolute (14:30), or ISO timestamps. Requires cross.inject capability when targeting other sessions.",
      {
        time: z.string().describe("When to run: '+5m', '+1h', '14:30', or ISO timestamp"),
        session: z.string().describe("Target session"),
        message: z.string().describe("Message to inject"),
      },
      async (args: any) => {
        return withSecurityCheck("cron_once", sessionName, async () => {
          const { time, session, message } = args;
          if (session !== sessionName) {
            const ctx = getContext(sessionName);
            if (ctx && !ctx.hasCapability("cross.inject")) {
              if (isEnforcementEnabled())
                return {
                  content: [
                    {
                      type: "text",
                      text: `Access denied: Scheduling cron jobs for other sessions requires 'cross.inject' capability`,
                    },
                  ],
                  isError: true,
                };
              else
                logger.warn(`[a2a-mcp] cron_once: ${sessionName} targeting ${session} without cross.inject capability`);
            }
          }
          try {
            const job = createOnceJob(time, session, message);
            addCron(job);
            return {
              content: [{ type: "text", text: `One-time job scheduled for ${new Date(job.runAt!).toISOString()}` }],
            };
          } catch (err: any) {
            return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
          }
        });
      },
    ),
  );

  tools.push(
    tool("cron_list", "List all scheduled cron jobs.", {}, async () => {
      const crons = getCrons();
      if (crons.length === 0) return { content: [{ type: "text", text: "No cron jobs scheduled." }] };
      const formatted = crons
        .map((c: any) => {
          const schedule = c.once && c.runAt ? `once at ${new Date(c.runAt).toISOString()}` : c.schedule;
          return `- ${c.name}: ${schedule} -> ${c.session}`;
        })
        .join("\n");
      return { content: [{ type: "text", text: `Scheduled cron jobs:\n${formatted}` }] };
    }),
  );

  tools.push(
    tool(
      "cron_cancel",
      "Cancel a scheduled cron job by name.",
      { name: z.string().describe("Name of the cron job to cancel") },
      async (args: any) => {
        logger.info(`[a2a-mcp] cron_cancel: ${sessionName} cancelling '${args.name}'`);
        try {
          return await withSecurityCheck("cron_cancel", sessionName, async () => {
            const removed = removeCron(args.name);
            logger.info(`[a2a-mcp] cron_cancel: '${args.name}' removed=${removed}`);
            if (!removed)
              return { content: [{ type: "text", text: `Cron job '${args.name}' not found` }], isError: true };
            return { content: [{ type: "text", text: `Cron job '${args.name}' cancelled` }] };
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error(`[a2a-mcp] cron_cancel failed: ${errMsg}`);
          return { content: [{ type: "text", text: `Error: ${errMsg}` }], isError: true };
        }
      },
    ),
  );

  tools.push(
    tool(
      "cron_history",
      "View execution history of cron jobs. Shows when jobs ran, success/failure status, duration, and the full message.",
      {
        name: z.string().optional().describe("Filter by cron job name"),
        session: z.string().optional().describe("Filter by target session"),
        limit: z.number().optional().describe("Max entries to return (default 50)"),
        offset: z.number().optional().describe("Skip this many entries (for pagination)"),
        since: z.number().optional().describe("Only show entries after this timestamp (ms)"),
        successOnly: z.boolean().optional().describe("Only show successful executions"),
        failedOnly: z.boolean().optional().describe("Only show failed executions"),
      },
      async (args: any) => {
        const result = getCronHistory({
          name: args.name,
          session: args.session,
          limit: args.limit,
          offset: args.offset,
          since: args.since,
          successOnly: args.successOnly,
          failedOnly: args.failedOnly,
        });
        if (result.total === 0) return { content: [{ type: "text", text: "No cron history found matching filters." }] };
        const lines: string[] = [`Cron History (showing ${result.entries.length} of ${result.total} entries):`, ""];
        for (const entry of result.entries) {
          const date = new Date(entry.timestamp).toISOString();
          lines.push(`[${date}] ${entry.name} -> ${entry.session}`);
          lines.push(`  Status: ${entry.success ? "SUCCESS" : "FAILED"} | Duration: ${entry.durationMs}ms`);
          if (entry.error) lines.push(`  Error: ${entry.error}`);
          lines.push(`  Message: ${entry.message}`, "");
        }
        if (result.hasMore)
          lines.push(
            `--- More entries available. Use offset=${(args.offset ?? 0) + result.entries.length} to see next page ---`,
          );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      },
    ),
  );

  return tools;
}
