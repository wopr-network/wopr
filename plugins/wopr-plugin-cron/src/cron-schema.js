/**
 * Cron storage schema - SQL-based cron job and execution history
 */
import { z } from "zod";
// Schema for CronScript - stored as JSON in scripts column
export const cronScriptSchema = z.object({
    name: z.string(),
    command: z.string(),
    timeout: z.number().optional(),
    cwd: z.string().optional(),
});
export const cronScriptResultSchema = z.object({
    name: z.string(),
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number(),
    error: z.string().optional(),
});
// Table: cron_jobs
// Primary key: name (the job name is the ID for backwards compat)
export const cronJobSchema = z.object({
    name: z.string(), // Primary key
    schedule: z.string(),
    session: z.string(),
    message: z.string(),
    scripts: z.array(cronScriptSchema).optional(),
    once: z.boolean().optional(),
    runAt: z.number().optional(),
});
// Table: cron_runs
// Stores execution history with auto-generated ID
export const cronRunSchema = z.object({
    id: z.string(), // Auto-generated UUID primary key
    cronName: z.string(), // Denormalized job name
    session: z.string(),
    startedAt: z.number(), // Timestamp when execution started
    status: z.enum(["success", "failure"]), // success or failure
    durationMs: z.number(),
    error: z.string().optional(),
    message: z.string(), // The resolved message that was sent
    scriptResults: z.array(cronScriptResultSchema).optional(),
});
/**
 * Plugin schema definition for cron storage
 * Namespace: "cron" → tables: cron_jobs, cron_runs
 */
export const cronPluginSchema = {
    namespace: "cron",
    version: 1,
    tables: {
        jobs: {
            schema: cronJobSchema,
            primaryKey: "name",
            indexes: [
                { fields: ["session"] },
                { fields: ["schedule"] },
                { fields: ["runAt"] },
            ],
        },
        runs: {
            schema: cronRunSchema,
            primaryKey: "id",
            indexes: [
                { fields: ["cronName"] },
                { fields: ["session"] },
                { fields: ["startedAt"] },
                { fields: ["status"] },
            ],
        },
    },
};
