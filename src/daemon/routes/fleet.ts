/**
 * Fleet Management API routes
 *
 * Provides endpoints for managing bot fleet: listing seed profiles,
 * CRUD operations on bots, and bot lifecycle actions (start/stop/restart).
 *
 * Bots are defined by profile.yaml files in the bots/ directory.
 * Seed profiles (templates) are stored in bots/_templates/.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { type BotProfile, profileSchema } from "../../compose-gen/profile-schema.js";
import { logger } from "../../logger.js";

export const fleetRouter = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the bots directory relative to the working directory. */
function botsDir(): string {
  return resolve(process.cwd(), "bots");
}

/** Resolve the templates directory. */
function templatesDir(): string {
  return join(botsDir(), "_templates");
}

/** Valid bot/profile name pattern — matches profileSchema name regex. */
const BOT_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

function validateBotName(name: string): string | null {
  if (!name || !BOT_NAME_RE.test(name) || name.includes("..")) {
    return "Invalid bot name: must be lowercase alphanumeric with hyphens/underscores";
  }
  return null;
}

/** Mask secret values (tokens, keys) in env content. */
function maskSecrets(envContent: string): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    // Mask values for keys that look like secrets
    const isSecret = /token|key|secret|password|credential/i.test(key);
    masked[key] =
      isSecret && value.length > 4
        ? value.slice(0, 2) + "*".repeat(Math.max(value.length - 4, 8)) + value.slice(-2)
        : isSecret
          ? "****"
          : value;
  }
  return masked;
}

/** Read and parse a profile.yaml from a bot directory. */
function readProfile(botPath: string): BotProfile | null {
  const profilePath = join(botPath, "profile.yaml");
  if (!existsSync(profilePath)) return null;
  try {
    const raw = readFileSync(profilePath, "utf-8");
    const parsed = parseYaml(raw);
    const result = profileSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** List all template profiles from _templates directory. */
function listTemplates(): Array<{ filename: string; profile: BotProfile }> {
  const dir = templatesDir();
  if (!existsSync(dir)) return [];

  const templates: Array<{ filename: string; profile: BotProfile }> = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      const parsed = parseYaml(raw);
      const result = profileSchema.safeParse(parsed);
      if (result.success) {
        templates.push({ filename: file.replace(/\.ya?ml$/, ""), profile: result.data });
      }
    } catch {
      // Skip invalid templates
    }
  }

  return templates;
}

/** List all deployed bots (directories in bots/ with profile.yaml). */
function listBots(): Array<{ name: string; profile: BotProfile; hasEnv: boolean }> {
  const dir = botsDir();
  if (!existsSync(dir)) return [];

  const bots: Array<{ name: string; profile: BotProfile; hasEnv: boolean }> = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const botPath = join(dir, entry.name);
    const profile = readProfile(botPath);
    if (profile) {
      bots.push({
        name: entry.name,
        profile,
        hasEnv: existsSync(join(botPath, ".env")),
      });
    }
  }

  return bots;
}

// ---------------------------------------------------------------------------
// Seed Profile Templates
// ---------------------------------------------------------------------------

/** GET /fleet/profiles — list all seed profile templates */
fleetRouter.get("/profiles", (c) => {
  const templates = listTemplates();
  return c.json({
    templates: templates.map((t) => ({
      id: t.filename,
      ...t.profile,
    })),
  });
});

/** GET /fleet/profiles/:name — get a specific seed profile template */
fleetRouter.get("/profiles/:name", (c) => {
  const name = c.req.param("name");
  const templates = listTemplates();
  const template = templates.find((t) => t.filename === name);

  if (!template) {
    return c.json({ error: `Template "${name}" not found` }, 404);
  }

  return c.json({ id: template.filename, ...template.profile });
});

// ---------------------------------------------------------------------------
// Bot CRUD
// ---------------------------------------------------------------------------

/** GET /fleet/bots — list all deployed bots */
fleetRouter.get("/bots", (c) => {
  const bots = listBots();
  return c.json({
    bots: bots.map((b) => ({
      name: b.name,
      description: b.profile.description,
      release_channel: b.profile.release_channel,
      update_policy: b.profile.update_policy,
      plugins: b.profile.plugins,
      resources: b.profile.resources,
      health: b.profile.health,
      configured: b.hasEnv,
    })),
  });
});

/** POST /fleet/bots — create a new bot from a profile template or custom config */
fleetRouter.post("/bots", async (c) => {
  const body = await c.req.json();
  const {
    name,
    template,
    profile: customProfile,
    env,
  } = body as {
    name?: string;
    template?: string;
    profile?: Record<string, unknown>;
    env?: Record<string, string>;
  };

  // Determine the profile to use
  let profileData: Record<string, unknown>;

  if (template) {
    // Use a seed template
    const templates = listTemplates();
    const tmpl = templates.find((t) => t.filename === template);
    if (!tmpl) {
      return c.json({ error: `Template "${template}" not found` }, 404);
    }
    // Override name if provided, otherwise use template name
    profileData = { ...tmpl.profile, name: name || tmpl.profile.name };
  } else if (customProfile) {
    profileData = { ...customProfile, name: name || customProfile.name };
  } else {
    return c.json({ error: "Either 'template' or 'profile' is required" }, 400);
  }

  // Override name if explicitly provided
  if (name) {
    profileData.name = name;
  }

  // Validate the final profile
  const validation = profileSchema.safeParse(profileData);
  if (!validation.success) {
    return c.json({ error: "Invalid profile", details: validation.error.format() }, 400);
  }

  const profile = validation.data;
  const nameErr = validateBotName(profile.name);
  if (nameErr) {
    return c.json({ error: nameErr }, 400);
  }

  // Check if bot already exists
  const botPath = join(botsDir(), profile.name);
  if (existsSync(botPath)) {
    return c.json({ error: `Bot "${profile.name}" already exists` }, 409);
  }

  // Create bot directory and write profile
  mkdirSync(botPath, { recursive: true });
  writeFileSync(join(botPath, "profile.yaml"), stringifyYaml(profile as Record<string, unknown>));

  // Write .env file if provided
  if (env && typeof env === "object") {
    for (const [key, value] of Object.entries(env)) {
      if (/[\n\r\0]/.test(value)) {
        return c.json({ error: `Invalid characters in env var ${key}` }, 400);
      }
    }
    const envLines = Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    writeFileSync(join(botPath, ".env"), `${envLines}\n`);
  }

  logger.info({ msg: "[fleet] Bot created", bot: profile.name, template });

  return c.json(
    {
      created: true,
      bot: {
        name: profile.name,
        description: profile.description,
        release_channel: profile.release_channel,
        plugins: profile.plugins,
        configured: !!env,
      },
    },
    201,
  );
});

/** GET /fleet/bots/:id — get bot details */
fleetRouter.get("/bots/:id", (c) => {
  const id = c.req.param("id");
  const nameErr = validateBotName(id);
  if (nameErr) {
    return c.json({ error: nameErr }, 400);
  }

  const botPath = join(botsDir(), id);
  if (!existsSync(botPath)) {
    return c.json({ error: `Bot "${id}" not found` }, 404);
  }

  const profile = readProfile(botPath);
  if (!profile) {
    return c.json({ error: `Bot "${id}" has an invalid profile` }, 500);
  }

  // Read env (masked)
  const envPath = join(botPath, ".env");
  let envMasked: Record<string, string> = {};
  if (existsSync(envPath)) {
    envMasked = maskSecrets(readFileSync(envPath, "utf-8"));
  }

  return c.json({
    name: id,
    profile,
    env: envMasked,
    configured: existsSync(envPath),
  });
});

/** PATCH /fleet/bots/:id — update bot profile and/or env */
fleetRouter.patch("/bots/:id", async (c) => {
  const id = c.req.param("id");
  const nameErr = validateBotName(id);
  if (nameErr) {
    return c.json({ error: nameErr }, 400);
  }

  const botPath = join(botsDir(), id);
  if (!existsSync(botPath)) {
    return c.json({ error: `Bot "${id}" not found` }, 404);
  }

  const currentProfile = readProfile(botPath);
  if (!currentProfile) {
    return c.json({ error: `Bot "${id}" has an invalid profile` }, 500);
  }

  const body = await c.req.json();
  const { profile: profileUpdates, env } = body as {
    profile?: Record<string, unknown>;
    env?: Record<string, string>;
  };

  // Update profile if provided
  if (profileUpdates) {
    const merged = { ...currentProfile, ...profileUpdates, name: id }; // name cannot change
    const validation = profileSchema.safeParse(merged);
    if (!validation.success) {
      return c.json({ error: "Invalid profile update", details: validation.error.format() }, 400);
    }
    writeFileSync(join(botPath, "profile.yaml"), stringifyYaml(validation.data as unknown as Record<string, unknown>));
  }

  // Update env if provided
  if (env && typeof env === "object") {
    for (const [key, value] of Object.entries(env)) {
      if (/[\n\r\0]/.test(value)) {
        return c.json({ error: `Invalid characters in env var ${key}` }, 400);
      }
    }
    const envPath = join(botPath, ".env");
    // Merge with existing env
    const existing: Record<string, string> = {};
    if (existsSync(envPath)) {
      const raw = readFileSync(envPath, "utf-8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        existing[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
    const merged = { ...existing, ...env };
    const envLines = Object.entries(merged)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    writeFileSync(envPath, `${envLines}\n`);
  }

  logger.info({ msg: "[fleet] Bot updated", bot: id });

  const updatedProfile = readProfile(botPath);
  return c.json({
    updated: true,
    bot: {
      name: id,
      profile: updatedProfile,
    },
  });
});

/** DELETE /fleet/bots/:id — remove a bot */
fleetRouter.delete("/bots/:id", (c) => {
  const id = c.req.param("id");
  const nameErr = validateBotName(id);
  if (nameErr) {
    return c.json({ error: nameErr }, 400);
  }

  const botPath = join(botsDir(), id);
  if (!existsSync(botPath)) {
    return c.json({ error: `Bot "${id}" not found` }, 404);
  }

  rmSync(botPath, { recursive: true, force: true });
  logger.info({ msg: "[fleet] Bot deleted", bot: id });

  return c.json({ deleted: true, name: id });
});

/** POST /fleet/bots/:id/:action — lifecycle actions (start, stop, restart) */
fleetRouter.post("/bots/:id/:action", (c) => {
  const id = c.req.param("id");
  const action = c.req.param("action");

  const nameErr = validateBotName(id);
  if (nameErr) {
    return c.json({ error: nameErr }, 400);
  }

  const validActions = ["start", "stop", "restart"];
  if (!validActions.includes(action)) {
    return c.json({ error: `Invalid action "${action}". Must be one of: ${validActions.join(", ")}` }, 400);
  }

  const botPath = join(botsDir(), id);
  if (!existsSync(botPath)) {
    return c.json({ error: `Bot "${id}" not found` }, 404);
  }

  // Container lifecycle actions require Docker integration (WOP-220).
  // For now, acknowledge the request and return a pending status.
  // When WOP-220 merges, this will integrate with the Fleet Manager core.
  logger.info({ msg: `[fleet] Bot ${action} requested`, bot: id });

  return c.json({
    action,
    bot: id,
    status: "pending",
    message: `Bot ${action} queued. Container orchestration requires Fleet Manager core (WOP-220).`,
  });
});

/** POST /fleet/seed — seed bots directory from templates */
fleetRouter.post("/seed", (c) => {
  const templates = listTemplates();
  if (templates.length === 0) {
    return c.json({ error: "No templates found" }, 404);
  }

  const created: string[] = [];
  const skipped: string[] = [];

  const dir = botsDir();
  mkdirSync(dir, { recursive: true });

  for (const tmpl of templates) {
    const botPath = join(dir, tmpl.profile.name);
    if (existsSync(botPath)) {
      skipped.push(tmpl.profile.name);
      continue;
    }

    mkdirSync(botPath, { recursive: true });
    writeFileSync(join(botPath, "profile.yaml"), stringifyYaml(tmpl.profile as unknown as Record<string, unknown>));
    created.push(tmpl.profile.name);
  }

  logger.info({ msg: "[fleet] Seed complete", created: created.length, skipped: skipped.length });

  return c.json({
    seeded: true,
    created,
    skipped,
    total: templates.length,
  });
});
