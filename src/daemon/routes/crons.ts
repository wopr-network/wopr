/**
 * Crons API routes
 */

import { Hono } from "hono";
import { createOnceJob } from "../../../plugins/wopr-plugin-cron/src/cron.js";
import { addCron, getCron, getCrons, removeCron } from "../../../plugins/wopr-plugin-cron/src/cron-repository.js";
import { config } from "../../core/config.js";
import { inject } from "../../core/sessions.js";
import type { CronJob } from "../../types.js";

export const cronsRouter = new Hono();

// List all crons
cronsRouter.get("/", async (c) => {
  const crons = await getCrons();
  return c.json({ crons });
});

// Get specific cron
cronsRouter.get("/:name", async (c) => {
  const name = c.req.param("name");
  const cron = await getCron(name);

  if (!cron) {
    return c.json({ error: "Cron not found" }, 404);
  }

  return c.json(cron);
});

// Create cron job
cronsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const { name, schedule, session, message, scripts, once, runNow } = body;

  if (!name || !schedule || !session || !message) {
    return c.json({ error: "Missing required fields: name, schedule, session, message" }, 400);
  }

  // Validate scripts if provided
  if (scripts !== undefined) {
    if (!Array.isArray(scripts)) {
      return c.json({ error: "scripts must be an array" }, 400);
    }
    for (const s of scripts) {
      if (!s.name || typeof s.name !== "string") {
        return c.json({ error: "Each script must have a string 'name'" }, 400);
      }
      if (!s.command || typeof s.command !== "string") {
        return c.json({ error: "Each script must have a string 'command'" }, 400);
      }
    }
    // Reject scripts when cronScriptsEnabled is false
    if (scripts.length > 0 && !config.get().daemon.cronScriptsEnabled) {
      return c.json(
        {
          error: "Cron script execution is disabled. Set cronScriptsEnabled: true in daemon config to enable.",
        },
        400,
      );
    }
  }

  const job: CronJob = {
    name,
    schedule,
    session,
    message,
    scripts: scripts || undefined,
    once: once || undefined,
  };

  await addCron(job);

  // Optionally run immediately
  if (runNow) {
    await inject(session, message, { silent: true, from: "cron" });
  }

  return c.json({ created: true, cron: job }, 201);
});

// Create one-time job
cronsRouter.post("/once", async (c) => {
  const body = await c.req.json();
  const { time, session, message } = body;

  if (!time || !session || !message) {
    return c.json({ error: "Missing required fields: time, session, message" }, 400);
  }

  try {
    const job = createOnceJob(time, session, message);
    await addCron(job);

    return c.json(
      {
        created: true,
        cron: job,
        scheduledFor: job.runAt ? new Date(job.runAt).toISOString() : undefined,
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Run immediately (no scheduling)
cronsRouter.post("/now", async (c) => {
  const body = await c.req.json();
  const { session, message } = body;

  if (!session || !message) {
    return c.json({ error: "Missing required fields: session, message" }, 400);
  }

  const result = await inject(session, message, { silent: true, from: "cron" });

  return c.json({
    session,
    response: result.response,
  });
});

// Delete cron
cronsRouter.delete("/:name", async (c) => {
  const name = c.req.param("name");
  const removed = await removeCron(name);

  if (!removed) {
    return c.json({ error: "Cron not found" }, 404);
  }

  return c.json({ deleted: true });
});
