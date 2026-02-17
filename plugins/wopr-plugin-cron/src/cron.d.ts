/**
 * Cron job management - pure functions and script execution
 */
import type { CronJob, CronScript, CronScriptResult } from "../../../src/types.js";
export declare function parseCronSchedule(schedule: string): {
    minute: number[];
    hour: number[];
    day: number[];
    month: number[];
    weekday: number[];
};
export declare function shouldRunCron(schedule: string, date: Date): boolean;
export declare function parseTimeSpec(spec: string): number;
export declare function createOnceJob(time: string, session: string, message: string): CronJob;
/**
 * Execute a single cron script, capturing stdout/stderr.
 */
export declare function executeCronScript(script: CronScript): Promise<CronScriptResult>;
/**
 * Execute all scripts for a cron job serially and return results.
 */
export declare function executeCronScripts(scripts: CronScript[]): Promise<CronScriptResult[]>;
/**
 * Replace {{name}} placeholders in a message with corresponding script outputs.
 * If a script failed, includes an error marker in the output.
 */
export declare function resolveScriptTemplates(message: string, results: CronScriptResult[]): string;
