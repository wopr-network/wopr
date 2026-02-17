/**
 * Cron repository - async CRUD operations for cron jobs and runs
 */
import { randomUUID } from "node:crypto";
import { cronPluginSchema } from "./cron-schema.js";
let jobsRepo = null;
let runsRepo = null;
/**
 * Initialize cron storage (registers schema and gets repositories)
 */
export async function initCronStorage(storage) {
    await storage.register(cronPluginSchema);
    jobsRepo = storage.getRepository("cron", "jobs");
    runsRepo = storage.getRepository("cron", "runs");
}
function ensureInitialized() {
    if (!jobsRepo || !runsRepo) {
        throw new Error("Cron storage not initialized - call initCronStorage() first");
    }
}
/**
 * Get all cron jobs
 */
export async function getCrons() {
    ensureInitialized();
    return await jobsRepo.findMany();
}
/**
 * Get a specific cron job by name
 */
export async function getCron(name) {
    ensureInitialized();
    return await jobsRepo.findById(name);
}
/**
 * Add or update a cron job (upsert by name)
 */
export async function addCron(job) {
    ensureInitialized();
    const existing = await jobsRepo.findById(job.name);
    if (existing) {
        await jobsRepo.update(job.name, job);
    }
    else {
        await jobsRepo.insert(job);
    }
}
/**
 * Remove a cron job by name
 */
export async function removeCron(name) {
    ensureInitialized();
    return await jobsRepo.delete(name);
}
/**
 * Add a cron run entry to history
 */
export async function addCronRun(run) {
    ensureInitialized();
    const id = randomUUID();
    await runsRepo.insert({ id, ...run });
}
/**
 * Get cron run history with filtering and pagination
 */
export async function getCronHistory(options) {
    ensureInitialized();
    // Build query
    const query = runsRepo.query();
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
    }
    else if (options?.failedOnly) {
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
export async function clearCronHistory(options) {
    ensureInitialized();
    if (options?.name) {
        return await runsRepo.deleteMany({ cronName: options.name });
    }
    if (options?.session) {
        return await runsRepo.deleteMany({ session: options.session });
    }
    // Clear all
    return await runsRepo.deleteMany({});
}
