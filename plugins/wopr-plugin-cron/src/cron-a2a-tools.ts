import type { A2AServerConfig } from "../../../src/plugin-types/a2a.js";
import { addCron, getCrons, getCronHistory, removeCron } from "./cron-repository.js";
import { createOnceJob } from "./cron.js";

export function buildCronA2ATools(): A2AServerConfig {
  return {
    name: "cron",
    version: "1.0.0",
    tools: [
      {
        name: "cron_schedule",
        description: "Schedule a recurring cron job that sends a message to a session. Supports optional scripts that execute before the message is sent — their stdout replaces {{name}} placeholders in the message.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Unique name for this cron job" },
            schedule: { type: "string", description: "Cron schedule (e.g., '0 9 * * *' for 9am daily)" },
            session: { type: "string", description: "Target session to receive the message" },
            message: { type: "string", description: "Message to inject. Use {{script_name}} for script output placeholders." },
            scripts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  command: { type: "string" },
                  timeout: { type: "number" },
                  cwd: { type: "string" },
                },
                required: ["name", "command"],
              },
              description: "Scripts to execute before sending the message",
            },
          },
          required: ["name", "schedule", "session", "message"],
        },
        async handler(args) {
          const { name, schedule, session, message, scripts } = args as {
            name: string; schedule: string; session: string; message: string;
            scripts?: Array<{ name: string; command: string; timeout?: number; cwd?: string }>;
          };
          await addCron({ name, schedule, session, message, scripts: scripts || undefined });
          const scriptInfo = scripts?.length ? ` (${scripts.length} script(s))` : "";
          return { content: [{ type: "text", text: `Cron job '${name}' scheduled: ${schedule} -> ${session}${scriptInfo}` }] };
        },
      },
      {
        name: "cron_once",
        description: "Schedule a one-time message. Supports relative (+5m, +1h), absolute (14:30), or ISO timestamps.",
        inputSchema: {
          type: "object",
          properties: {
            time: { type: "string", description: "When to run: '+5m', '+1h', '14:30', or ISO timestamp" },
            session: { type: "string", description: "Target session" },
            message: { type: "string", description: "Message to inject" },
          },
          required: ["time", "session", "message"],
        },
        async handler(args) {
          const { time, session, message } = args as { time: string; session: string; message: string };
          try {
            const job = createOnceJob(time, session, message);
            await addCron(job);
            return { content: [{ type: "text", text: `One-time job scheduled for ${new Date(job.runAt ?? Date.now()).toISOString()}` }] };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
          }
        },
      },
      {
        name: "cron_list",
        description: "List all scheduled cron jobs.",
        inputSchema: { type: "object", properties: {} },
        async handler() {
          const crons = await getCrons();
          if (crons.length === 0) return { content: [{ type: "text", text: "No cron jobs scheduled." }] };
          const formatted = crons
            .map((c) => {
              const schedule = c.once && c.runAt ? `once at ${new Date(c.runAt).toISOString()}` : c.schedule;
              return `- ${c.name}: ${schedule} -> ${c.session}`;
            })
            .join("\n");
          return { content: [{ type: "text", text: `Scheduled cron jobs:\n${formatted}` }] };
        },
      },
      {
        name: "cron_cancel",
        description: "Cancel a scheduled cron job by name.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "Name of the cron job to cancel" } },
          required: ["name"],
        },
        async handler(args) {
          const { name } = args as { name: string };
          const removed = await removeCron(name);
          if (!removed) return { content: [{ type: "text", text: `Cron job '${name}' not found` }], isError: true };
          return { content: [{ type: "text", text: `Cron job '${name}' cancelled` }] };
        },
      },
      {
        name: "cron_history",
        description: "View execution history of cron jobs.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Filter by cron job name" },
            session: { type: "string", description: "Filter by target session" },
            limit: { type: "number", description: "Max entries to return (default 50)" },
            offset: { type: "number", description: "Skip entries (for pagination)" },
            since: { type: "number", description: "Only show entries after this timestamp (ms)" },
            successOnly: { type: "boolean", description: "Only show successful executions" },
            failedOnly: { type: "boolean", description: "Only show failed executions" },
          },
        },
        async handler(args) {
          const opts = args as {
            name?: string; session?: string; limit?: number; offset?: number;
            since?: number; successOnly?: boolean; failedOnly?: boolean;
          };
          const result = await getCronHistory(opts);
          if (result.total === 0) return { content: [{ type: "text", text: "No cron history found matching filters." }] };
          const lines: string[] = [`Cron History (showing ${result.entries.length} of ${result.total} entries):`, ""];
          for (const entry of result.entries) {
            const date = new Date(entry.startedAt).toISOString();
            lines.push(`[${date}] ${entry.cronName} -> ${entry.session}`);
            lines.push(`  Status: ${entry.status.toUpperCase()} | Duration: ${entry.durationMs}ms`);
            if (entry.error) lines.push(`  Error: ${entry.error}`);
            lines.push(`  Message: ${entry.message}`, "");
          }
          if (result.hasMore) lines.push(`--- More entries available. Use offset=${(opts.offset ?? 0) + result.entries.length} to see next page ---`);
          return { content: [{ type: "text", text: lines.join("\n") }] };
        },
      },
    ],
  };
}
