/**
 * Cron repository - async CRUD operations for cron jobs and runs
 */
import type { StorageApi } from "../../../src/storage/api/plugin-storage.js";
import type { CronJobRow, CronRunRow } from "./cron-schema.js";
/**
 * Initialize cron storage (registers schema and gets repositories)
 */
export declare function initCronStorage(storage: StorageApi): Promise<void>;
/**
 * Get all cron jobs
 */
export declare function getCrons(): Promise<CronJobRow[]>;
/**
 * Get a specific cron job by name
 */
export declare function getCron(name: string): Promise<CronJobRow | null>;
/**
 * Add or update a cron job (upsert by name)
 */
export declare function addCron(job: CronJobRow): Promise<void>;
/**
 * Remove a cron job by name
 */
export declare function removeCron(name: string): Promise<boolean>;
/**
 * Add a cron run entry to history
 */
export declare function addCronRun(run: Omit<CronRunRow, "id">): Promise<void>;
/**
 * Get cron run history with filtering and pagination
 */
export declare function getCronHistory(options?: {
    name?: string;
    session?: string;
    limit?: number;
    offset?: number;
    since?: number;
    successOnly?: boolean;
    failedOnly?: boolean;
}): Promise<{
    entries: CronRunRow[];
    total: number;
    hasMore: boolean;
}>;
/**
 * Clear cron run history with optional filtering
 */
export declare function clearCronHistory(options?: {
    name?: string;
    session?: string;
}): Promise<number>;
