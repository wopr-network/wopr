/**
 * WOPR Security Policy Resolution
 *
 * Resolves the effective security policy for a given injection source
 * by combining global config, trust level defaults, and source-specific grants.
 */

import { logger } from "../logger.js";
import { getStorage } from "../storage/index.js";
import type { SecurityConfigRow, SecurityPluginRuleRow } from "./schema.js";
import { securityConfigSchema, securityPluginRuleSchema } from "./schema.js";
import type { SecurityPluginRule } from "./store.js";
import { SecurityStore } from "./store.js";
import {
  type Capability,
  DEFAULT_SANDBOX_BY_TRUST,
  DEFAULT_SECURITY_CONFIG,
  getSessionAccess,
  getToolCapability,
  hasCapability,
  type InjectionSource,
  matchesAnyAccessPattern,
  meetsTrustLevel,
  type SandboxConfig,
  type SecurityConfig,
  type ToolPolicy,
  type TrustLevel,
} from "./types.js";

// ============================================================================
// Config Loading
// ============================================================================

let securityStore: SecurityStore | null = null;

/**
 * Initialize security system with config path
 */
export async function initSecurity(woprDir: string): Promise<void> {
  // Register security schema with storage
  const storage = getStorage();
  await storage.register({
    namespace: "security",
    version: 1,
    tables: {
      config: {
        schema: securityConfigSchema,
        primaryKey: "id",
      },
      plugin_rules: {
        schema: securityPluginRuleSchema,
        primaryKey: "id",
        indexes: [{ fields: ["pluginName"] }],
      },
    },
  });

  // Create store
  securityStore = new SecurityStore(
    woprDir,
    () => storage.getRepository<SecurityConfigRow>("security", "config"),
    () => storage.getRepository<SecurityPluginRuleRow>("security", "plugin_rules"),
  );

  // Initialize (creates default config, migrates from JSON if needed)
  await securityStore.init();

  logger.info("[security] Security system initialized");
}

/**
 * Get security configuration (synchronous - uses cached value)
 *
 * IMPORTANT: This function is synchronous for backward compatibility.
 * It returns the cached config from the last async load.
 * If called before initSecurity(), returns DEFAULT_SECURITY_CONFIG.
 */
export function getSecurityConfig(): SecurityConfig {
  let config: SecurityConfig;
  if (!securityStore) {
    config = DEFAULT_SECURITY_CONFIG;
  } else {
    config = securityStore.configCache ?? DEFAULT_SECURITY_CONFIG;
  }

  // Allow environment variable override for enforcement mode
  // This lets developers use WOPR_SECURITY_ENFORCEMENT=warn during local dev
  const envEnforcement = process.env.WOPR_SECURITY_ENFORCEMENT;
  if (envEnforcement === "off" || envEnforcement === "warn" || envEnforcement === "enforce") {
    if (envEnforcement !== config.enforcement) {
      return { ...config, enforcement: envEnforcement };
    }
  }

  return config;
}

/**
 * Get security configuration (async version)
 */
export async function getSecurityConfigAsync(): Promise<SecurityConfig> {
  if (!securityStore) {
    logger.warn("[security] Security store not initialized, returning default config");
    return DEFAULT_SECURITY_CONFIG;
  }

  return await securityStore.getConfig();
}

/**
 * Save security configuration
 */
export async function saveSecurityConfig(config: SecurityConfig): Promise<void> {
  if (!securityStore) {
    logger.warn("[security] Security store not initialized, cannot save config");
    return;
  }

  await securityStore.saveConfig(config);
}

/**
 * Register a security rule from a plugin
 */
export async function registerSecurityRule(rule: Omit<SecurityPluginRule, "id" | "createdAt">): Promise<string> {
  if (!securityStore) {
    throw new Error("Security store not initialized");
  }

  return await securityStore.registerPluginRule(rule);
}

/**
 * Remove all security rules registered by a plugin
 */
export async function removeSecurityRules(pluginName: string): Promise<number> {
  if (!securityStore) {
    throw new Error("Security store not initialized");
  }

  return await securityStore.removePluginRules(pluginName);
}

// ============================================================================
// Policy Resolution
// ============================================================================

/**
 * Resolved policy for an injection source
 */
export interface ResolvedPolicy {
  /** Effective trust level */
  trustLevel: TrustLevel;

  /** Effective capabilities */
  capabilities: Capability[];

  /** Effective sandbox config */
  sandbox: SandboxConfig;

  /** Effective tool policy */
  tools: ToolPolicy;

  /** Rate limits */
  rateLimit: {
    perMinute: number;
    perHour: number;
  };

  /** Sessions this source can access */
  allowedSessions: string[] | "*";

  /** Sessions blocked */
  blockedSessions: string[];

  /** Is this source a gateway? */
  isGateway: boolean;

  /** Can this source forward to other sessions? */
  canForward: boolean;

  /** Forward rules if gateway */
  forwardRules?: {
    allowForwardTo: string[];
    allowActions?: string[];
    requireApproval?: boolean;
    rateLimit?: { perMinute: number };
  };
}

/**
 * Resolve the effective policy for an injection source
 */
export function resolvePolicy(source: InjectionSource, targetSession?: string): ResolvedPolicy {
  const config = getSecurityConfig();
  const trustLevel = source.trustLevel;

  // Start with defaults
  let capabilities = [...(config.defaults.capabilities || [])];
  let sandbox: SandboxConfig = {
    ...DEFAULT_SANDBOX_BY_TRUST[trustLevel],
    ...config.defaults.sandbox,
  };
  let tools: ToolPolicy = { ...config.defaults.tools };
  let rateLimit = {
    perMinute: config.defaults.rateLimit?.perMinute || 60,
    perHour: config.defaults.rateLimit?.perHour || 1000,
  };

  // Apply trust level policy
  const trustPolicy = config.trustLevels?.[trustLevel];
  if (trustPolicy) {
    if (trustPolicy.capabilities) {
      capabilities = [...trustPolicy.capabilities];
    }
    if (trustPolicy.sandbox) {
      sandbox = { ...sandbox, ...trustPolicy.sandbox };
    }
    if (trustPolicy.tools) {
      tools = { ...tools, ...trustPolicy.tools };
    }
    if (trustPolicy.rateLimit) {
      rateLimit = { ...rateLimit, ...trustPolicy.rateLimit };
    }
  }

  // Apply source-specific granted capabilities
  if (source.grantedCapabilities) {
    // Merge granted capabilities with base capabilities
    // Granted capabilities can expand but not reduce
    for (const cap of source.grantedCapabilities) {
      if (!capabilities.includes(cap)) {
        capabilities.push(cap);
      }
    }
  }

  // Determine session access
  let allowedSessions: string[] | "*" = "*";
  let blockedSessions: string[] = [];

  if (trustPolicy?.sessions) {
    if (trustPolicy.sessions.allowed) {
      allowedSessions = trustPolicy.sessions.allowed;
    }
    if (trustPolicy.sessions.blocked) {
      blockedSessions = trustPolicy.sessions.blocked;
    }
  }

  // Check if this is a gateway session
  const isGateway = config.gateways?.sessions?.includes(targetSession || "") || false;
  const canForward = isGateway && hasCapability(capabilities, "cross.inject");

  // Get forward rules if gateway
  let forwardRules: ResolvedPolicy["forwardRules"];
  if (isGateway && config.gateways?.forwardRules?.[targetSession || ""]) {
    forwardRules = config.gateways.forwardRules[targetSession || ""];
  }

  return {
    trustLevel,
    capabilities,
    sandbox,
    tools,
    rateLimit,
    allowedSessions,
    blockedSessions,
    isGateway,
    canForward,
    forwardRules,
  };
}

// ============================================================================
// Policy Checks
// ============================================================================

/**
 * Result of a policy check
 */
export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  warning?: string;
}

/**
 * Check if a source is allowed to inject into a session
 */
export function checkSessionAccess(source: InjectionSource, session: string): PolicyCheckResult {
  const config = getSecurityConfig();
  const policy = resolvePolicy(source, session);

  // Check minimum trust level
  const minTrust = config.defaults.minTrustLevel ?? "semi-trusted";
  if (!meetsTrustLevel(source.trustLevel, minTrust)) {
    return {
      allowed: false,
      reason: `Trust level ${source.trustLevel} below minimum (${minTrust})`,
    };
  }

  // Check blocked sessions (from trust level policy)
  if (policy.blockedSessions.includes(session)) {
    return {
      allowed: false,
      reason: `Session ${session} is blocked for this source`,
    };
  }

  // Check allowed sessions (from trust level policy)
  if (policy.allowedSessions !== "*") {
    if (!policy.allowedSessions.includes(session)) {
      return {
        allowed: false,
        reason: `Session ${session} not in allowed list for trust level`,
      };
    }
  }

  // Check session-level access rules (the new generic system)
  const accessPatterns = getSessionAccess(config, session);
  if (!matchesAnyAccessPattern(source, accessPatterns)) {
    return {
      allowed: false,
      reason: `Source does not match access rules for session ${session}`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a source is allowed to use a specific capability
 */
export function checkCapability(source: InjectionSource, capability: Capability, session?: string): PolicyCheckResult {
  const policy = resolvePolicy(source, session);

  // Check if capability is granted
  if (!hasCapability(policy.capabilities, capability)) {
    return {
      allowed: false,
      reason: `Capability ${capability} not granted to ${source.trustLevel}`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a source is allowed to use a specific tool
 */
export function checkToolAccess(source: InjectionSource, toolName: string, session?: string): PolicyCheckResult {
  const config = getSecurityConfig();
  const policy = resolvePolicy(source, session);
  const isWarnMode = config.enforcement === "warn";

  // Check tool policy
  if (policy.tools.deny?.includes(toolName) || policy.tools.deny?.includes("*")) {
    // Unless explicitly allowed
    if (!policy.tools.allow?.includes(toolName)) {
      if (isWarnMode) {
        return {
          allowed: true,
          warning: `Tool ${toolName} is denied for ${source.trustLevel} (warn mode)`,
        };
      }
      return {
        allowed: false,
        reason: `Tool ${toolName} is denied for ${source.trustLevel}`,
      };
    }
  }

  // Check capability requirement for this tool
  const requiredCap = getToolCapability(toolName);
  if (requiredCap) {
    if (!hasCapability(policy.capabilities, requiredCap)) {
      if (isWarnMode) {
        return {
          allowed: true,
          warning: `Tool ${toolName} requires capability ${requiredCap} (warn mode)`,
        };
      }
      return {
        allowed: false,
        reason: `Tool ${toolName} requires capability ${requiredCap}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if a source needs sandbox execution
 */
export function checkSandboxRequired(source: InjectionSource, session?: string): SandboxConfig | null {
  const policy = resolvePolicy(source, session);

  if (policy.sandbox.enabled) {
    return policy.sandbox;
  }

  return null;
}

/**
 * Filter available tools based on source policy
 */
export function filterToolsByPolicy(source: InjectionSource, availableTools: string[], session?: string): string[] {
  const config = getSecurityConfig();
  const policy = resolvePolicy(source, session);

  return availableTools.filter((toolName) => {
    // Check tool policy
    if (policy.tools.deny?.includes(toolName) || policy.tools.deny?.includes("*")) {
      if (!policy.tools.allow?.includes(toolName)) {
        return false;
      }
    }

    // Check capability requirement
    const requiredCap = getToolCapability(toolName);
    if (requiredCap && !hasCapability(policy.capabilities, requiredCap)) {
      // In warn mode, still include but log
      if (config.enforcement === "warn") {
        logger.warn(`[security] Tool ${toolName} would be denied: requires ${requiredCap}`);
        return true;
      }
      return false;
    }

    return true;
  });
}

// ============================================================================
// Enforcement
// ============================================================================

/**
 * Check enforcement mode
 */
export function isEnforcementEnabled(): boolean {
  const config = getSecurityConfig();
  return config.enforcement === "enforce";
}

/**
 * Check if we should log security events
 */
export function shouldLogSecurityEvent(allowed: boolean): boolean {
  const config = getSecurityConfig();
  if (!config.audit?.enabled) return false;

  if (allowed && config.audit.logSuccess) return true;
  if (!allowed && config.audit.logDenied) return true;

  return false;
}

// ============================================================================
// Session Access Helpers
// ============================================================================

/**
 * Check if a session allows untrusted access
 * (Replacement for the old isGatewaySession - sessions that allow untrusted
 * are effectively "gateways" but that's now just a configuration pattern)
 */
export function sessionAllowsUntrusted(session: string): boolean {
  const config = getSecurityConfig();
  const accessPatterns = getSessionAccess(config, session);
  // Check if any pattern would allow untrusted
  return accessPatterns.some((p) => p === "*" || p === "trust:untrusted");
}

/**
 * @deprecated Use sessionAllowsUntrusted or check session access rules directly
 */
export function isGatewaySession(session: string): boolean {
  const config = getSecurityConfig();
  // Legacy: check old gateways config
  if (config.gateways?.sessions?.includes(session)) {
    return true;
  }
  // New: a "gateway" is just a session that allows untrusted access
  return sessionAllowsUntrusted(session);
}

/**
 * @deprecated Configure per-session capabilities instead
 */
export function getGatewayRules(session: string): ResolvedPolicy["forwardRules"] {
  const config = getSecurityConfig();
  return config.gateways?.forwardRules?.[session];
}

/**
 * Check if a session can forward (inject) to another session
 * This replaces the gateway-specific forwarding logic with generic capability checks
 */
export function canSessionForward(
  sourceSession: string,
  targetSession: string,
  source: InjectionSource,
): PolicyCheckResult {
  const config = getSecurityConfig();

  // Check if source session has cross.inject capability
  const sessionConfig = config.sessions?.[sourceSession];
  const capabilities = sessionConfig?.capabilities || [];
  if (!hasCapability(capabilities, "cross.inject")) {
    return {
      allowed: false,
      reason: `Session ${sourceSession} does not have cross.inject capability`,
    };
  }

  // Check if source can access target session (as a gateway-forwarded request)
  const forwardSource: InjectionSource = {
    ...source,
    type: "gateway",
    identity: {
      ...source.identity,
      gatewaySession: sourceSession,
    },
  };

  return checkSessionAccess(forwardSource, targetSession);
}

/**
 * @deprecated Use canSessionForward instead
 */
export function canGatewayForward(gatewaySession: string, targetSession: string, action?: string): PolicyCheckResult {
  const config = getSecurityConfig();

  // Legacy: check old gateway rules
  if (config.gateways?.forwardRules?.[gatewaySession]) {
    const rules = config.gateways.forwardRules[gatewaySession];
    if (!rules.allowForwardTo.includes(targetSession) && !rules.allowForwardTo.includes("*")) {
      return {
        allowed: false,
        reason: `Gateway ${gatewaySession} cannot forward to ${targetSession}`,
      };
    }
    if (action && rules.allowActions && !rules.allowActions.includes(action)) {
      return {
        allowed: false,
        reason: `Action ${action} not allowed for gateway ${gatewaySession}`,
      };
    }
    return { allowed: true };
  }

  // New: use generic session forwarding
  const dummySource: InjectionSource = {
    type: "gateway",
    trustLevel: "semi-trusted",
    identity: { gatewaySession: gatewaySession },
  };
  return canSessionForward(gatewaySession, targetSession, dummySource);
}
