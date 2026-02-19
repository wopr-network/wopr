/**
 * Zod schema mirroring the PluginManifest TypeScript interface.
 * Served as JSON Schema at /openapi/plugin-manifest.schema.json.
 *
 * External developers can use this schema to validate their plugin manifests
 * before publishing.
 */
import { z } from "zod";

const InstallMethodSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("brew"),
    formula: z.string(),
    bins: z.array(z.string()).optional(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("apt"),
    package: z.string(),
    bins: z.array(z.string()).optional(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("pip"),
    package: z.string(),
    bins: z.array(z.string()).optional(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("npm"),
    package: z.string(),
    bins: z.array(z.string()).optional(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("docker"),
    image: z.string(),
    tag: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("script"),
    url: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("manual"),
    instructions: z.string(),
    label: z.string().optional(),
  }),
]);

const CapabilityRequirementSchema = z.object({
  capability: z.string(),
  optional: z.boolean().optional(),
});

const NetworkRequirementsSchema = z.object({
  outbound: z.boolean().optional(),
  inbound: z.boolean().optional(),
  p2p: z.boolean().optional(),
  ports: z.array(z.number()).optional(),
  hosts: z.array(z.string()).optional(),
});

const StorageRequirementsSchema = z.object({
  persistent: z.boolean().optional(),
  estimatedSize: z.string().optional(),
});

const ManifestProviderEntrySchema = z.object({
  type: z.string(),
  id: z.string(),
  displayName: z.string(),
  configSchema: z.unknown().optional(),
  healthProbe: z.enum(["endpoint", "builtin"]).optional(),
});

const PluginLifecycleSchema = z.object({
  healthEndpoint: z.string().optional(),
  healthIntervalMs: z.number().optional(),
  hotReload: z.boolean().optional(),
  shutdownBehavior: z.enum(["graceful", "immediate", "drain"]).optional(),
  shutdownTimeoutMs: z.number().optional(),
});

export const PluginManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  capabilities: z.array(z.string()),
  requires: z
    .object({
      bins: z.array(z.string()).optional(),
      env: z.array(z.string()).optional(),
      docker: z.array(z.string()).optional(),
      config: z.array(z.string()).optional(),
      os: z.array(z.enum(["linux", "darwin", "win32"])).optional(),
      node: z.string().optional(),
      network: NetworkRequirementsSchema.optional(),
      services: z.array(z.string()).optional(),
      storage: StorageRequirementsSchema.optional(),
      capabilities: z.array(CapabilityRequirementSchema).optional(),
    })
    .optional(),
  provides: z
    .object({
      capabilities: z.array(ManifestProviderEntrySchema),
    })
    .optional(),
  install: z.array(InstallMethodSchema).optional(),
  configSchema: z.unknown().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  icon: z.string().optional(),
  minCoreVersion: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  conflicts: z.array(z.string()).optional(),
  lifecycle: PluginLifecycleSchema.optional(),
});
