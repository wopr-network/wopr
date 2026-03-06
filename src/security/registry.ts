/**
 * SecurityRegistry — runtime registration of permissions, injection sources,
 * and tool→capability mappings. Plugins register their own security metadata
 * at init time via WOPRPluginContext; core permissions are seeded as defaults.
 */

import type { TrustLevel } from "./types.js";

const PERMISSION_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;

/** Core permissions — always present, cannot be unregistered */
const CORE_PERMISSIONS = new Set([
  "inject",
  "inject.tools",
  "session.spawn",
  "session.history",
  "cross.inject",
  "cross.read",
  "config.read",
  "config.write",
  "cron.manage",
  "event.emit",
  "a2a.call",
  "*",
]);

/** Core injection sources with default trust levels */
const CORE_SOURCES = new Map<string, TrustLevel>([
  ["cli", "owner"],
  ["daemon", "owner"],
  ["p2p", "untrusted"],
  ["p2p.discovery", "untrusted"],
  ["plugin", "semi-trusted"],
  ["api", "semi-trusted"],
  ["gateway", "semi-trusted"],
  ["internal", "owner"],
]);

/** Core tool→capability mappings */
const CORE_TOOL_CAPS = new Map<string, string>([
  ["sessions_list", "session.history"],
  ["sessions_send", "cross.inject"],
  ["sessions_history", "session.history"],
  ["sessions_spawn", "session.spawn"],
  ["config_get", "config.read"],
  ["config_set", "config.write"],
  ["config_provider_defaults", "config.write"],
  ["cron_schedule", "cron.manage"],
  ["cron_once", "cron.manage"],
  ["cron_list", "cron.manage"],
  ["cron_cancel", "cron.manage"],
  ["event_emit", "event.emit"],
  ["event_list", "event.emit"],
  ["security_whoami", "inject"],
  ["security_check", "inject"],
]);

interface PluginRegistration<T> {
  value: T;
  pluginName: string;
}

export class SecurityRegistry {
  private pluginPermissions = new Map<string, string>();
  private pluginSources = new Map<string, PluginRegistration<TrustLevel>>();
  private pluginToolCaps = new Map<string, PluginRegistration<string>>();

  // ---- Permissions ----

  registerPermission(name: string, pluginName: string): void {
    if (name !== "*" && !PERMISSION_RE.test(name)) {
      throw new Error(
        `Invalid permission format: "${name}". Must match namespace.action[.sub...] (lowercase alphanumeric, dot-separated).`,
      );
    }
    if (CORE_PERMISSIONS.has(name)) {
      throw new Error(`Permission "${name}" is a core permission and cannot be registered by plugins.`);
    }
    const existing = this.pluginPermissions.get(name);
    if (existing !== undefined && existing !== pluginName) {
      throw new Error(
        `Permission "${name}" is already registered by plugin "${existing}". Cannot re-register with "${pluginName}".`,
      );
    }
    this.pluginPermissions.set(name, pluginName);
  }

  unregisterPermission(name: string, pluginName: string): void {
    if (CORE_PERMISSIONS.has(name)) return;
    if (this.pluginPermissions.get(name) === pluginName) {
      this.pluginPermissions.delete(name);
    }
  }

  hasPermission(name: string): boolean {
    return CORE_PERMISSIONS.has(name) || this.pluginPermissions.has(name);
  }

  getAllPermissions(): string[] {
    return [...CORE_PERMISSIONS, ...this.pluginPermissions.keys()];
  }

  // ---- Injection Sources ----

  registerInjectionSource(name: string, trustLevel: TrustLevel, pluginName: string): void {
    const existing = this.pluginSources.get(name);
    if (existing !== undefined && existing.pluginName !== pluginName) {
      throw new Error(
        `Injection source "${name}" is already registered by plugin "${existing.pluginName}". Cannot re-register with "${pluginName}".`,
      );
    }
    this.pluginSources.set(name, { value: trustLevel, pluginName });
  }

  unregisterInjectionSource(name: string, pluginName: string): void {
    if (CORE_SOURCES.has(name)) return;
    if (this.pluginSources.get(name)?.pluginName === pluginName) {
      this.pluginSources.delete(name);
    }
  }

  getDefaultTrust(sourceType: string): TrustLevel | undefined {
    return CORE_SOURCES.get(sourceType) ?? this.pluginSources.get(sourceType)?.value;
  }

  getAllDefaultTrusts(): Map<string, TrustLevel> {
    const result = new Map(CORE_SOURCES);
    for (const [name, reg] of this.pluginSources) {
      if (!CORE_SOURCES.has(name)) {
        result.set(name, reg.value);
      }
    }
    return result;
  }

  // ---- Tool Capabilities ----

  registerToolCapability(toolName: string, capability: string, pluginName: string): void {
    if (!capability || capability.trim() === "") {
      throw new Error(`Invalid capability: cannot be empty. Tool "${toolName}" requires a valid permission.`);
    }
    const existing = this.pluginToolCaps.get(toolName);
    if (existing !== undefined && existing.pluginName !== pluginName) {
      throw new Error(
        `Tool capability "${toolName}" is already registered by plugin "${existing.pluginName}". Cannot re-register with "${pluginName}".`,
      );
    }
    this.pluginToolCaps.set(toolName, { value: capability, pluginName });
  }

  unregisterToolCapability(toolName: string, pluginName: string): void {
    if (CORE_TOOL_CAPS.has(toolName)) return;
    if (this.pluginToolCaps.get(toolName)?.pluginName === pluginName) {
      this.pluginToolCaps.delete(toolName);
    }
  }

  getToolCapability(toolName: string): string | undefined {
    return CORE_TOOL_CAPS.get(toolName) ?? this.pluginToolCaps.get(toolName)?.value;
  }

  getAllToolCapabilities(): Map<string, string> {
    const result = new Map(CORE_TOOL_CAPS);
    for (const [name, reg] of this.pluginToolCaps) {
      if (!CORE_TOOL_CAPS.has(name)) {
        result.set(name, reg.value);
      }
    }
    return result;
  }

  // ---- Bulk cleanup ----

  unregisterAllForPlugin(pluginName: string): void {
    for (const [name, owner] of this.pluginPermissions) {
      if (owner === pluginName) this.pluginPermissions.delete(name);
    }
    for (const [name, reg] of this.pluginSources) {
      if (reg.pluginName === pluginName) this.pluginSources.delete(name);
    }
    for (const [name, reg] of this.pluginToolCaps) {
      if (reg.pluginName === pluginName) this.pluginToolCaps.delete(name);
    }
  }
}

let instance: SecurityRegistry | null = null;

export function getSecurityRegistry(): SecurityRegistry {
  if (!instance) {
    instance = new SecurityRegistry();
  }
  return instance;
}

export function resetSecurityRegistry(): void {
  instance = null;
}
