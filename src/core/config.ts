/**
 * Configuration management for WOPR
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { logger } from "../logger.js";
import { CONFIG_FILE, getConfigFilePath, WOPR_HOME } from "../paths.js";
import type { SoulEvilConfig } from "./workspace.js";
/**
 * Per-provider default settings
 */
export interface ProviderDefaults {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  reasoningEffort?: string; // For Codex: minimal/low/medium/high/xhigh
  options?: Record<string, unknown>;
}

export interface WoprConfig {
  daemon: {
    port: number;
    host: string;
    autoStart: boolean;
    cronScriptsEnabled: boolean;
  };
  anthropic: {
    apiKey?: string;
  };
  oauth: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  };
  discord?: {
    token?: string;
    guildId?: string;
  };
  discovery: {
    topics: string[];
    autoJoin: boolean;
  };
  plugins: {
    autoLoad: boolean;
    directories: string[];
    // Plugin-specific config stored here: plugins.data[pluginName]
    data?: Record<string, unknown>;
  };
  agents?: {
    a2a?: {
      enabled: boolean;
    };
  };
  /**
   * Per-provider default settings
   * e.g., providers.codex.model = "gpt-5.2"
   *       providers.anthropic.model = "claude-opus-4-5-20251101"
   */
  providers?: Record<string, ProviderDefaults>;
  /** Memory system configuration (chunking, sync, etc.) */
  /** Memory system configuration — passed through to wopr-plugin-memory-semantic */
  memory?: Record<string, unknown>;
  /** SOUL_EVIL personality override configuration */
  soulEvil?: SoulEvilConfig;
  /**
   * Sandbox configuration for Docker-based isolation
   */
  sandbox?: {
    /** Sandboxing mode: off, non-main (all except main session), all */
    mode?: "off" | "non-main" | "all";
    /** Sandbox scope: session (per-session container) or shared (one container) */
    scope?: "session" | "shared";
    /** Workspace access: none, ro (read-only), rw (read-write) */
    workspaceAccess?: "none" | "ro" | "rw";
    /** Root directory for sandbox workspaces */
    workspaceRoot?: string;
    /** Docker container configuration */
    docker?: {
      image?: string;
      memory?: string;
      cpus?: number;
      network?: string;
    };
    /** Tool policy for sandboxed sessions */
    tools?: {
      allow?: string[];
      deny?: string[];
    };
  };
}

const ProviderDefaultsSchema = z.object({
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  topP: z.number().optional(),
  reasoningEffort: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

const WoprConfigSchema = z.object({
  daemon: z.object({
    port: z.number(),
    host: z.string(),
    autoStart: z.boolean(),
    cronScriptsEnabled: z.boolean(),
  }),
  anthropic: z.object({
    apiKey: z.string().optional(),
  }),
  oauth: z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    redirectUri: z.string().optional(),
  }),
  discord: z
    .object({
      token: z.string().optional(),
      guildId: z.string().optional(),
    })
    .optional(),
  discovery: z.object({
    topics: z.array(z.string()),
    autoJoin: z.boolean(),
  }),
  plugins: z.object({
    autoLoad: z.boolean(),
    directories: z.array(z.string()),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
  agents: z
    .object({
      a2a: z.object({ enabled: z.boolean() }).optional(),
    })
    .optional(),
  providers: z.record(z.string(), ProviderDefaultsSchema).optional(),
  memory: z.record(z.string(), z.unknown()).optional(),
  soulEvil: z
    .object({
      file: z.string().optional(),
      chance: z.number().optional(),
      purge: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  sandbox: z
    .object({
      mode: z.enum(["off", "non-main", "all"]).optional(),
      scope: z.enum(["session", "shared"]).optional(),
      workspaceAccess: z.enum(["none", "ro", "rw"]).optional(),
      workspaceRoot: z.string().optional(),
      docker: z
        .object({
          image: z.string().optional(),
          memory: z.string().optional(),
          cpus: z.number().optional(),
          network: z.string().optional(),
        })
        .optional(),
      tools: z
        .object({
          allow: z.array(z.string()).optional(),
          deny: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});

const DEFAULT_CONFIG: WoprConfig = {
  daemon: {
    port: 7437,
    host: "127.0.0.1",
    autoStart: false,
    cronScriptsEnabled: false,
  },
  anthropic: {},
  oauth: {},
  discovery: {
    topics: [],
    autoJoin: false,
  },
  plugins: {
    autoLoad: true,
    directories: [join(WOPR_HOME, "plugins")],
    data: {},
  },
  providers: {},
};

export class ConfigManager {
  private config: WoprConfig = DEFAULT_CONFIG;

  async load(): Promise<WoprConfig> {
    const configPath = getConfigFilePath();
    try {
      const data = await readFile(configPath, "utf-8");
      const loaded = JSON.parse(data) as Partial<WoprConfig>;
      this.config = this.merge(DEFAULT_CONFIG, loaded) as WoprConfig;
      // Fix permissions on existing config files (migration for pre-WOP-621 deployments)
      // Only apply to the default config path — shared/team configs may intentionally have group-read
      if (configPath === CONFIG_FILE) {
        await chmod(configPath, 0o600).catch(() => {});
      }
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "ENOENT") {
        logger.error("Failed to load config:", error.message);
      }
      // Use defaults if file doesn't exist
      this.config = { ...DEFAULT_CONFIG };
    }

    // Apply environment variable overrides (for Docker/container deployment)
    this.applyEnvironmentOverrides();

    const result = WoprConfigSchema.safeParse(this.config);
    if (!result.success) {
      throw new Error(`Invalid WOPR config at ${configPath}:\n${result.error.message}`);
    }

    return this.config;
  }

  /**
   * Apply environment variable overrides to config
   * Environment variables take precedence over config file values
   */
  private applyEnvironmentOverrides(): void {
    // Anthropic API key
    if (process.env.ANTHROPIC_API_KEY) {
      this.config.anthropic = this.config.anthropic || {};
      this.config.anthropic.apiKey = process.env.ANTHROPIC_API_KEY;
    }

    // Discord configuration
    if (process.env.DISCORD_TOKEN) {
      this.config.discord = this.config.discord || {};
      this.config.discord.token = process.env.DISCORD_TOKEN;
    }
    if (process.env.DISCORD_GUILD_ID) {
      this.config.discord = this.config.discord || {};
      this.config.discord.guildId = process.env.DISCORD_GUILD_ID;
    }

    // Daemon configuration
    if (process.env.WOPR_DAEMON_PORT) {
      this.config.daemon.port = parseInt(process.env.WOPR_DAEMON_PORT, 10);
    }
    if (process.env.WOPR_DAEMON_HOST) {
      this.config.daemon.host = process.env.WOPR_DAEMON_HOST;
    }
  }

  async save(): Promise<void> {
    try {
      await mkdir(WOPR_HOME, { recursive: true, mode: 0o700 });
      await writeFile(getConfigFilePath(), JSON.stringify(this.config, null, 2), { mode: 0o600 });
    } catch (err: unknown) {
      const error = err as Error;
      throw new Error(`Failed to save config: ${error.message}`);
    }
  }

  get(): WoprConfig {
    return { ...this.config };
  }

  getValue(key: string): unknown {
    const parts = key.split(".");
    let value: unknown = this.config;
    for (const part of parts) {
      if (value && typeof value === "object" && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return value;
  }

  setValue(key: string, value: unknown): void {
    const parts = key.split(".");
    let target: Record<string, unknown> = this.config as unknown as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in target)) {
        target[part] = {};
      }
      target = target[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1];
    target[lastPart] = value;
  }

  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Get default settings for a provider
   * Used for global provider defaults (model, temperature, etc.)
   */
  getProviderDefaults(providerId: string): ProviderDefaults | undefined {
    return this.config.providers?.[providerId];
  }

  /**
   * Set a provider default setting
   * e.g., setProviderDefault("codex", "model", "gpt-5.2")
   */
  setProviderDefault(providerId: string, key: keyof ProviderDefaults, value: unknown): void {
    if (!this.config.providers) {
      this.config.providers = {};
    }
    if (!this.config.providers[providerId]) {
      this.config.providers[providerId] = {};
    }
    (this.config.providers[providerId] as Record<string, unknown>)[key] = value;
  }

  private merge(defaults: unknown, overrides: unknown): unknown {
    if (typeof defaults !== "object" || defaults === null || typeof overrides !== "object" || overrides === null) {
      return overrides;
    }

    const result = { ...defaults } as Record<string, unknown>;
    const overridesObj = overrides as Record<string, unknown>;

    for (const key of Object.keys(overridesObj)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const overrideValue = overridesObj[key];
      if (overrideValue !== null && typeof overrideValue === "object" && !Array.isArray(overrideValue)) {
        result[key] = this.merge(result[key] || {}, overrideValue);
      } else {
        result[key] = overrideValue;
      }
    }
    return result;
  }
}

// Singleton instance
export const config = new ConfigManager();
