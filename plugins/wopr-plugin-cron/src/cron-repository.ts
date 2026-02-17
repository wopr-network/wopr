/**
 * Cron repository - async CRUD operations for cron jobs and runs
 */

import { randomUUID } from "node:crypto";
import type { Repository, StorageApi } from "../../../src/storage/api/plugin-storage.js";
import type { CronJobRow, CronRunRow } from "./cron-schema.js";
import { cronPluginSchema } from "./cron-schema.js";

let jobsRepo: Repository<CronJobRow, "name", string> | null = null;
let runsRepo: Repository<CronRunRow, "id", string> | null = null;

/**
 * Initialize cron storage (registers schema and gets repositories)
 */
export async function initCronStorage(storage: StorageApi): Promise<void> {
  await storage.register(cronPluginSchema);
  jobsRepo = storage.getRepository<CronJobRow>("cron", "jobs");
  runsRepo = storage.getRepository<CronRunRow>("cron", "runs");
}

function ensureInitialized(): void {
  if (!jobsRepo || !runsRepo) {
    throw new Error("Cron storage not initialized - call initCronStorage() first");
  }
}

/**
 * Get all cron jobs
 */
export async function getCrons(): Promise<CronJobRow[]> {
  ensureInitialized();
  return await jobsRepo!.findMany();
}

/**
 * Get a specific cron job by name
 */
export async function getCron(name: string): Promise<CronJobRow | null> {
  ensureInitialized();
  return await jobsRepo!.findById(name);
}

/**
 * Add or update a cron job (upsert by name)
 */
export async function addCron(job: CronJobRow): Promise<void> {
  ensureInitialized();
  const existing = await jobsRepo!.findById(job.name);
  if (existing) {
    await jobsRepo!.update(job.name, job);
  } else {
    await jobsRepo!.insert(job);
  }
}

/**
 * Remove a cron job by name
 */
export async function removeCron(name: string): Promise<boolean> {
  ensureInitialized();
  return await jobsRepo!.delete(name);
}

/**
 * Add a cron run entry to history
 */
export async function addCronRun(run: Omit<CronRunRow, "id">): Promise<void> {
  ensureInitialized();
  const id = randomUUID();
  await runsRepo!.insert({ id, ...run });
}

/**
 * Get cron run history with filtering and pagination
 */
export async function getCronHistory(options?: {
  name?: string;
  session?: string;
  limit?: number;
  offset?: number;
  since?: number;
  successOnly?: boolean;
  failedOnly?: boolean;
}): Promise<{ entries: CronRunRow[]; total: number; hasMore: boolean }> {
  ensureInitialized();

  // Build query
  const query = runsRepo!.query();

  // Apply filters
  if (options?.name) {
    query.where("cronName", options.name);
  }
  if (options?.session) {
    query.where("session", options.session);
  }
  if (options?.since) {
    query.where("startedAt", "$gte", options.since);
  }
  if (options?.successOnly) {
    query.where("status", "success");
  } else if (options?.failedOnly) {
    query.where("status", "failure");
  }

  // Order by most recent first
  query.orderBy("startedAt", "desc");

  // Get total count before pagination
  const total = await query.count();

  // Apply pagination
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 50;
  query.offset(offset).limit(limit);

  const entries = await query.execute();
  const hasMore = offset + entries.length < total;

  return { entries, total, hasMore };
}

/**
 * Clear cron run history with optional filtering
 */
export async function clearCronHistory(options?: { name?: string; session?: string }): Promise<number> {
  ensureInitialized();

  if (options?.name) {
    return await runsRepo!.deleteMany({ cronName: options.name });
  }
  if (options?.session) {
    return await runsRepo!.deleteMany({ session: options.session });
  }
  // Clear all
  return await runsRepo!.deleteMany({});
}
