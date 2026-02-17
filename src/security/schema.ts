/**
 * Security storage schemas
 *
 * Defines Zod schemas for security configuration tables.
 */

import { z } from "zod";

/**
 * Security config table schema - singleton table with id="global"
 * Stores the main SecurityConfig as JSON
 */
export const securityConfigSchema = z.object({
  id: z.string(), // Always "global"
  config: z.string(), // JSON-serialized SecurityConfig
  updatedAt: z.number(), // Timestamp
});

export type SecurityConfigRow = z.infer<typeof securityConfigSchema>;

/**
 * Plugin security rules table schema
 * Stores rules registered by plugins that get merged with the global config
 */
export const securityPluginRuleSchema = z.object({
  id: z.string(), // UUID or plugin-generated ID
  pluginName: z.string(), // Which plugin registered this rule
  ruleType: z.enum(["trust-override", "session-access", "capability-grant", "tool-policy"]),
  targetSession: z.string().optional(), // Target session name (if applicable)
  targetTrust: z.string().optional(), // Target trust level (if applicable)
  ruleData: z.string(), // JSON-serialized rule details
  createdAt: z.number(), // Timestamp
});

export type SecurityPluginRuleRow = z.infer<typeof securityPluginRuleSchema>;
