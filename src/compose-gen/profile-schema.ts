import { z } from "zod";

/**
 * Zod schema for bot profile.yaml files.
 *
 * Each bot declares its configuration in a profile.yaml that the compose
 * generator reads to produce docker-compose.generated.yml.
 */

const releaseChannelSchema = z
  .string()
  .refine((v) => ["stable", "canary", "staging"].includes(v) || /^pinned:[A-Za-z0-9._-]+$/.test(v), {
    message: "Must be stable | canary | staging | pinned:<version>",
  });

const updatePolicySchema = z.enum(["nightly", "on-merge", "manual"]);

const pluginsSchema = z.object({
  channels: z.array(z.string()).default([]),
  providers: z.array(z.string()).default([]),
  voice: z.array(z.string()).default([]),
  other: z.array(z.string()).default([]),
});

const memoryLimitSchema = z.string().regex(/^\d+[kmg]$/i, "Must be a Docker memory limit like 512m, 1g, 256k");

const resourcesSchema = z.object({
  memory: memoryLimitSchema.default("512m"),
  restart: z.enum(["no", "always", "unless-stopped", "on-failure"]).default("unless-stopped"),
});

const volumesSchema = z.object({
  persist: z.boolean().default(true),
});

const healthSchema = z.object({
  check: z.boolean().default(true),
  alert_on_failure: z.boolean().default(true),
});

export const profileSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "Must be lowercase alphanumeric with hyphens/underscores"),
  description: z.string().default(""),
  release_channel: releaseChannelSchema.default("stable"),
  update_policy: updatePolicySchema.default("nightly"),
  plugins: pluginsSchema.default(() => ({ channels: [], providers: [], voice: [], other: [] })),
  resources: resourcesSchema.default(() => ({ memory: "512m", restart: "unless-stopped" as const })),
  volumes: volumesSchema.default(() => ({ persist: true })),
  health: healthSchema.default(() => ({ check: true, alert_on_failure: true })),
});

export type BotProfile = z.infer<typeof profileSchema>;
