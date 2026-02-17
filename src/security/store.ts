/**
 * Security storage implementation
 *
 * Handles persistence of security configuration in SQL instead of JSON files.
 */

import { existsSync, renameSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";
import type { Repository } from "../storage/api/plugin-storage.js";
import type { SecurityConfig } from "./types.js";
import { DEFAULT_SECURITY_CONFIG } from "./types.js";
import { securityConfigSchema, securityPluginRuleSchema } from "./schema.js";
import type { SecurityConfigRow, SecurityPluginRuleRow } from "./schema.js";

/**
 * Plugin security rule data structures
 */
export interface SecurityPluginRule {
  id: string;
  pluginName: string;
  ruleType: "trust-override" | "session-access" | "capability-grant" | "tool-policy";
  targetSession?: string;
  targetTrust?: string;
  ruleData: unknown;
  createdAt: number;
}

/**
 * Security store - handles all security config persistence
 */
export class SecurityStore {
  public configCache: SecurityConfig | null = null;
  private configRepo: Repository<SecurityConfigRow> | null = null;
  private rulesRepo: Repository<SecurityPluginRuleRow> | null = null;

  constructor(
    private woprDir: string,
    private getConfigRepo: () => Repository<SecurityConfigRow>,
    private getRulesRepo: () => Repository<SecurityPluginRuleRow>,
  ) {}

  /**
   * Initialize the store - creates tables if needed
   */
  async init(): Promise<void> {
    this.configRepo = this.getConfigRepo();
    this.rulesRepo = this.getRulesRepo();

    // Check if we need to migrate from JSON
    const jsonPath = join(this.woprDir, "security.json");
    if (existsSync(jsonPath)) {
      await this.migrateFromJson(jsonPath);
    }

    // Ensure default config exists
    const existing = await this.configRepo.findById("global");
    if (!existing) {
      await this.configRepo.insert({
        id: "global",
        config: JSON.stringify(DEFAULT_SECURITY_CONFIG),
        updatedAt: Date.now(),
      });
      logger.info("[security] Initialized default security config");
    }
  }

  /**
   * Get the security configuration
   */
  async getConfig(): Promise<SecurityConfig> {
    if (this.configCache) {
      return this.configCache;
    }

    if (!this.configRepo) {
      // Not initialized yet - return default
      return DEFAULT_SECURITY_CONFIG;
    }

    const row = await this.configRepo.findById("global");
    if (!row) {
      return DEFAULT_SECURITY_CONFIG;
    }

    try {
      const config = JSON.parse(row.config) as SecurityConfig;
      this.configCache = config;
      return config;
    } catch (err) {
      logger.error(`[security] Failed to parse security config: ${err}`);
      return DEFAULT_SECURITY_CONFIG;
    }
  }

  /**
   * Save the security configuration
   */
  async saveConfig(config: SecurityConfig): Promise<void> {
    if (!this.configRepo) {
      logger.warn("[security] Store not initialized, cannot save config");
      return;
    }

    const row: SecurityConfigRow = {
      id: "global",
      config: JSON.stringify(config),
      updatedAt: Date.now(),
    };

    await this.configRepo.update("global", row);
    this.configCache = config;
    logger.info("[security] Security config saved");
  }

  /**
   * Register a plugin security rule
   */
  async registerPluginRule(rule: Omit<SecurityPluginRule, "id" | "createdAt">): Promise<string> {
    if (!this.rulesRepo) {
      throw new Error("Security store not initialized");
    }

    const id = randomUUID();
    const ruleRow: SecurityPluginRuleRow = {
      id,
      pluginName: rule.pluginName,
      ruleType: rule.ruleType,
      targetSession: rule.targetSession,
      targetTrust: rule.targetTrust,
      ruleData: JSON.stringify(rule.ruleData),
      createdAt: Date.now(),
    };

    await this.rulesRepo.insert(ruleRow);
    logger.info(`[security] Registered ${rule.ruleType} rule from plugin ${rule.pluginName}`);
    return id;
  }

  /**
   * Remove all rules registered by a plugin
   */
  async removePluginRules(pluginName: string): Promise<number> {
    if (!this.rulesRepo) {
      throw new Error("Security store not initialized");
    }

    const deleted = await this.rulesRepo.deleteMany({ pluginName });
    logger.info(`[security] Removed ${deleted} rule(s) from plugin ${pluginName}`);
    return deleted;
  }

  /**
   * Get all plugin rules
   */
  async getPluginRules(): Promise<SecurityPluginRule[]> {
    if (!this.rulesRepo) {
      return [];
    }

    const rows = await this.rulesRepo.findMany();
    return rows.map((row) => ({
      id: row.id,
      pluginName: row.pluginName,
      ruleType: row.ruleType,
      targetSession: row.targetSession,
      targetTrust: row.targetTrust,
      ruleData: JSON.parse(row.ruleData),
      createdAt: row.createdAt,
    }));
  }

  /**
   * Migrate from JSON file to SQL
   */
  private async migrateFromJson(jsonPath: string): Promise<void> {
    if (!this.configRepo) {
      throw new Error("Store not initialized");
    }

    logger.info("[security] Migrating security config from JSON to SQL");

    try {
      const raw = readFileSync(jsonPath, "utf-8");
      const config = JSON.parse(raw) as Partial<SecurityConfig>;

      // Merge with defaults
      const merged = this.mergeConfigs(DEFAULT_SECURITY_CONFIG, config);

      // Insert into database
      await this.configRepo.insert({
        id: "global",
        config: JSON.stringify(merged),
        updatedAt: Date.now(),
      });

      // Rename JSON file to prevent re-migration
      const backupPath = `${jsonPath}.migrated`;
      renameSync(jsonPath, backupPath);

      logger.info(`[security] Migration complete. Original file saved as ${backupPath}`);
    } catch (err) {
      logger.error(`[security] Migration failed: ${err}`);
      throw err;
    }
  }

  /**
   * Merge configs (deep merge with defaults)
   */
  private mergeConfigs(defaults: SecurityConfig, overrides: Partial<SecurityConfig>): SecurityConfig {
    return {
      ...defaults,
      ...overrides,
      defaults: {
        ...defaults.defaults,
        ...(overrides.defaults ?? {}),
      },
      trustLevels: {
        ...defaults.trustLevels,
        ...(overrides.trustLevels ?? {}),
      },
      p2p: {
        discoveryTrust: overrides.p2p?.discoveryTrust ?? defaults.p2p?.discoveryTrust ?? "untrusted",
        autoAccept: overrides.p2p?.autoAccept ?? defaults.p2p?.autoAccept ?? false,
        keyRotationGraceHours: overrides.p2p?.keyRotationGraceHours ?? defaults.p2p?.keyRotationGraceHours,
        maxPayloadSize: overrides.p2p?.maxPayloadSize ?? defaults.p2p?.maxPayloadSize,
      },
      audit: {
        enabled: overrides.audit?.enabled ?? defaults.audit?.enabled ?? false,
        logSuccess: overrides.audit?.logSuccess ?? defaults.audit?.logSuccess,
        logDenied: overrides.audit?.logDenied ?? defaults.audit?.logDenied,
        logPath: overrides.audit?.logPath ?? defaults.audit?.logPath,
      },
      gateways: overrides.gateways || defaults.gateways,
    };
  }

  /**
   * Invalidate cache (for testing)
   */
  clearCache(): void {
    this.configCache = null;
  }
}
