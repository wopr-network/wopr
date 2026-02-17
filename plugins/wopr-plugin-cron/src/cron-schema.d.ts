/**
 * Cron storage schema - SQL-based cron job and execution history
 */
import { z } from "zod";
import type { PluginSchema } from "../../../src/storage/api/plugin-storage.js";
export declare const cronScriptSchema: z.ZodObject<{
    name: z.ZodString;
    command: z.ZodString;
    timeout: z.ZodOptional<z.ZodNumber>;
    cwd: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const cronScriptResultSchema: z.ZodObject<{
    name: z.ZodString;
    exitCode: z.ZodNumber;
    stdout: z.ZodString;
    stderr: z.ZodString;
    durationMs: z.ZodNumber;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const cronJobSchema: z.ZodObject<{
    name: z.ZodString;
    schedule: z.ZodString;
    session: z.ZodString;
    message: z.ZodString;
    scripts: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        command: z.ZodString;
        timeout: z.ZodOptional<z.ZodNumber>;
        cwd: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    once: z.ZodOptional<z.ZodBoolean>;
    runAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type CronJobRow = z.infer<typeof cronJobSchema>;
export declare const cronRunSchema: z.ZodObject<{
    id: z.ZodString;
    cronName: z.ZodString;
    session: z.ZodString;
    startedAt: z.ZodNumber;
    status: z.ZodEnum<{
        success: "success";
        failure: "failure";
    }>;
    durationMs: z.ZodNumber;
    error: z.ZodOptional<z.ZodString>;
    message: z.ZodString;
    scriptResults: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        exitCode: z.ZodNumber;
        stdout: z.ZodString;
        stderr: z.ZodString;
        durationMs: z.ZodNumber;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type CronRunRow = z.infer<typeof cronRunSchema>;
/**
 * Plugin schema definition for cron storage
 * Namespace: "cron" → tables: cron_jobs, cron_runs
 */
export declare const cronPluginSchema: PluginSchema;
