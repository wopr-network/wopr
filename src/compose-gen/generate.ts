import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { type BotProfile, profileSchema } from "./profile-schema.js";

/** Registry image base — each bot gets the same image, different config. */
const IMAGE_BASE = "ghcr.io/wopr-network/wopr";

/** Map release_channel to Docker image tag. */
function imageTag(channel: string): string {
  if (channel === "stable") return "latest";
  if (channel === "canary") return "canary";
  if (channel === "staging") return "staging";
  if (channel.startsWith("pinned:")) return channel.slice("pinned:".length);
  return "latest";
}

/** Map update_policy to Watchtower label value. */
function watchtowerEnabled(policy: string): boolean {
  return policy !== "manual";
}

/** Map update_policy to Watchtower schedule label. */
function watchtowerSchedule(policy: string): string | undefined {
  if (policy === "nightly") return "0 0 3 * * *"; // 3 AM daily
  if (policy === "on-merge") return "0 */5 * * * *"; // every 5 min
  return undefined;
}

export interface GenerateResult {
  yaml: string;
  profiles: BotProfile[];
  errors: Array<{ dir: string; error: string }>;
}

/**
 * Build a docker-compose service definition from a validated bot profile.
 */
function buildService(profile: BotProfile, botsDir: string): Record<string, unknown> {
  const svc: Record<string, unknown> = {
    image: `${IMAGE_BASE}:${imageTag(profile.release_channel)}`,
    container_name: profile.name,
    restart: profile.resources.restart,
    networks: ["wopr-net"],
    env_file: [`${botsDir}/${profile.name}/.env`],
    environment: {
      WOPR_HOME: "/data",
      WOPR_BOT_NAME: profile.name,
      WOPR_PLUGINS_CHANNELS: profile.plugins.channels.join(","),
      WOPR_PLUGINS_PROVIDERS: profile.plugins.providers.join(","),
      WOPR_PLUGINS_VOICE: profile.plugins.voice.join(","),
      WOPR_PLUGINS_OTHER: profile.plugins.other.join(","),
    },
  };

  // Resource limits
  svc.deploy = {
    resources: {
      limits: {
        memory: profile.resources.memory,
      },
    },
  };

  // Volumes
  const volumes: string[] = [];
  if (profile.volumes.persist) {
    volumes.push(`${profile.name}-data:/data`);
  }
  if (volumes.length > 0) {
    svc.volumes = volumes;
  }

  // Healthcheck
  if (profile.health.check) {
    svc.healthcheck = {
      test: ["CMD", "node", "-e", "fetch('http://localhost:7437/health').then(r=>{if(!r.ok)throw 1})"],
      interval: "30s",
      timeout: "10s",
      retries: 3,
      start_period: "15s",
    };
  }

  // Watchtower labels
  const labels: Record<string, string> = {};
  if (watchtowerEnabled(profile.update_policy)) {
    labels["com.centurylinklabs.watchtower.enable"] = "true";
    const schedule = watchtowerSchedule(profile.update_policy);
    if (schedule) {
      labels["com.centurylinklabs.watchtower.schedule"] = schedule;
    }
  } else {
    labels["com.centurylinklabs.watchtower.enable"] = "false";
  }
  svc.labels = labels;

  return svc;
}

/**
 * Scan `botsDir` for `* /profile.yaml` files, validate each, and generate
 * a complete docker-compose document.
 *
 * @param botsDir - path to the bots/ directory (e.g. `./bots`)
 * @returns Generated YAML string, parsed profiles, and any validation errors
 */
export function generateCompose(botsDir: string): GenerateResult {
  const absDir = resolve(botsDir);
  const profiles: BotProfile[] = [];
  const errors: GenerateResult["errors"] = [];

  if (!existsSync(absDir)) {
    return { yaml: "", profiles: [], errors: [{ dir: absDir, error: "bots directory not found" }] };
  }

  const entries = readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) continue; // skip _templates etc.

    const profilePath = join(absDir, entry.name, "profile.yaml");
    if (!existsSync(profilePath)) continue;

    const raw = readFileSync(profilePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      errors.push({ dir: entry.name, error: `YAML parse error: ${err}` });
      continue;
    }

    const result = profileSchema.safeParse(parsed);
    if (!result.success) {
      errors.push({ dir: entry.name, error: result.error.message });
      continue;
    }

    if (result.data.name !== entry.name) {
      errors.push({
        dir: entry.name,
        error: `Profile name "${result.data.name}" does not match directory name "${entry.name}"`,
      });
      continue;
    }

    profiles.push(result.data);
  }

  if (profiles.length === 0) {
    return { yaml: "", profiles: [], errors };
  }

  // Detect duplicate names
  const seen = new Set<string>();
  for (const profile of profiles) {
    if (seen.has(profile.name)) {
      errors.push({ dir: profile.name, error: `Duplicate profile name "${profile.name}"` });
      return { yaml: "", profiles: [], errors };
    }
    seen.add(profile.name);
  }

  // Build compose document
  const services: Record<string, unknown> = {};
  const volumeNames: string[] = [];

  for (const profile of profiles) {
    services[profile.name] = buildService(profile, botsDir);
    if (profile.volumes.persist) {
      volumeNames.push(`${profile.name}-data`);
    }
  }

  const compose: Record<string, unknown> = {
    networks: {
      "wopr-net": { driver: "bridge" },
    },
    services,
  };

  if (volumeNames.length > 0) {
    const volumes: Record<string, null> = {};
    for (const v of volumeNames) {
      volumes[v] = null;
    }
    compose.volumes = volumes;
  }

  const header = "# AUTO-GENERATED by scripts/generate-compose.ts — do not edit manually\n";
  const yaml = header + stringifyYaml(compose, { lineWidth: 120 });

  return { yaml, profiles, errors };
}
