/**
 * Plugin manifest types for WOPR as a Service (WaaS).
 *
 * The manifest describes a plugin's capabilities, requirements,
 * and setup flows. This is the metadata that WaaS uses to present
 * plugins in a marketplace and auto-configure them.
 */

import type { ConfigSchema } from "./config.js";

/**
 * Installation method for plugin dependencies.
 * Describes how to install a missing dependency automatically.
 */
export type InstallMethod =
  | { kind: "brew"; formula: string; bins?: string[]; label?: string }
  | { kind: "apt"; package: string; bins?: string[]; label?: string }
  | { kind: "pip"; package: string; bins?: string[]; label?: string }
  | { kind: "npm"; package: string; bins?: string[]; label?: string }
  | { kind: "docker"; image: string; tag?: string; label?: string }
  | { kind: "script"; url: string; label?: string }
  | { kind: "manual"; instructions: string; label?: string };

/**
 * Runtime requirements for a plugin.
 * Specifies what binaries, env vars, docker images, or config keys
 * must be present for the plugin to function.
 */
export interface PluginRequirements {
  /** Required binary executables (checked via `which`) */
  bins?: string[];
  /** Required environment variables */
  env?: string[];
  /** Required docker images */
  docker?: string[];
  /** Required config keys (dot-notation paths) */
  config?: string[];
}

/**
 * A setup step that guides users through plugin configuration.
 * WaaS renders these as a wizard flow.
 */
export interface SetupStep {
  /** Step identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Description or instructions (markdown) */
  description: string;
  /** Config fields to collect in this step */
  fields?: ConfigSchema;
  /** Whether this step can be skipped */
  optional?: boolean;
}

/**
 * Plugin manifest — the complete metadata for a WOPR plugin.
 *
 * This is the canonical type for describing a plugin's identity,
 * capabilities, requirements, and setup flows. It extends beyond
 * the basic WOPRPlugin interface to support WaaS marketplace and
 * auto-configuration features.
 */
export interface PluginManifest {
  /** Plugin package name (e.g., "@wopr-network/plugin-discord") */
  name: string;
  /** Semantic version */
  version: string;
  /** Human-readable description */
  description: string;
  /** Author or organization */
  author?: string;
  /** License identifier (e.g., "MIT") */
  license?: string;
  /** Homepage or documentation URL */
  homepage?: string;
  /** Repository URL */
  repository?: string;

  /** Plugin capabilities — what this plugin provides */
  capabilities: PluginCapability[];

  /** Runtime requirements for this plugin */
  requires?: PluginRequirements;

  /** How to install missing dependencies (ordered by preference) */
  install?: InstallMethod[];

  /** Setup wizard steps for first-time configuration */
  setup?: SetupStep[];

  /** Configuration schema for the plugin's settings */
  configSchema?: ConfigSchema;

  /** Plugin category for marketplace organization */
  category?: PluginCategory;

  /** Tags for search and discovery */
  tags?: string[];

  /** Icon emoji for UI display */
  icon?: string;

  /** Minimum WOPR core version required */
  minCoreVersion?: string;

  /** Other plugins this plugin depends on */
  dependencies?: string[];

  /** Other plugins this plugin conflicts with */
  conflicts?: string[];
}

/**
 * Plugin capabilities — what a plugin provides to the system.
 */
export type PluginCapability =
  | "channel" // Provides a message channel (Discord, Slack, etc.)
  | "provider" // Provides an AI model provider
  | "stt" // Provides speech-to-text
  | "tts" // Provides text-to-speech
  | "context" // Provides context to conversations
  | "storage" // Provides persistent storage
  | "auth" // Provides authentication
  | "webhook" // Provides webhook endpoints
  | "commands" // Provides CLI commands
  | "ui" // Provides UI components
  | "a2a" // Provides agent-to-agent tools
  | "middleware"; // Provides message middleware/hooks

/**
 * Plugin categories for marketplace organization.
 */
export type PluginCategory =
  | "channel" // Communication channels
  | "ai-provider" // AI model providers
  | "voice" // Voice/audio plugins
  | "integration" // Third-party integrations
  | "utility" // Utility/helper plugins
  | "security" // Security plugins
  | "analytics" // Analytics/monitoring
  | "developer"; // Developer tools
