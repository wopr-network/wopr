/**
 * Shared types, state, and utilities for A2A tool modules.
 *
 * Every tool-group module imports from here to access the session functions,
 * security helpers, and tool registry without circular deps.
 */

import { exec } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { tool as sdkTool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { logger } from "../../logger.js";
import { GLOBAL_IDENTITY_DIR, SESSIONS_DIR, WOPR_HOME } from "../../paths.js";
import {
  canIndexSession,
  getContext,
  getSecurityConfig,
  getSessionIndexable,
  isEnforcementEnabled,
  type PolicyCheckResult,
} from "../../security/index.js";
import { config as centralConfig } from "../config.js";
import { eventBus } from "../events.js";

// Re-export the SDK tool helper
export const tool: typeof sdkTool = sdkTool;

// Re-export everything tool modules need
export {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  join,
  normalize,
  resolve,
  sep,
  z,
  logger,
  GLOBAL_IDENTITY_DIR,
  SESSIONS_DIR,
  WOPR_HOME,
  canIndexSession,
  getContext,
  getSecurityConfig,
  getSessionIndexable,
  isEnforcementEnabled,
  type PolicyCheckResult,
  centralConfig,
  eventBus,
};

export const execAsync = promisify(exec);

export const GLOBAL_MEMORY_DIR = join(GLOBAL_IDENTITY_DIR, "memory");

// ---------------------------------------------------------------------------
// Temporal filter (moved from src/memory/ — memory is a plugin concern)
// ---------------------------------------------------------------------------

export type TemporalFilter = {
  /** Start timestamp (inclusive) - ms since epoch */
  after?: number;
  /** End timestamp (inclusive) - ms since epoch */
  before?: number;
};

export function parseTemporalFilter(expr: string): TemporalFilter | null {
  if (!expr || typeof expr !== "string") {
    return null;
  }

  const trimmed = expr.trim();
  const trimmedLower = trimmed.toLowerCase();

  const relativeMatch = trimmedLower.match(/^(\d+)(h|d|w|m)$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = Date.now();

    let msAgo: number;
    switch (unit) {
      case "h":
        msAgo = amount * 60 * 60 * 1000;
        break;
      case "d":
        msAgo = amount * 24 * 60 * 60 * 1000;
        break;
      case "w":
        msAgo = amount * 7 * 24 * 60 * 60 * 1000;
        break;
      case "m":
        msAgo = amount * 30 * 24 * 60 * 60 * 1000;
        break;
      default:
        return null;
    }

    return { after: now - msAgo };
  }

  const lastMatch = trimmedLower.match(/^last\s+(\d+)\s+(hours?|days?|weeks?|months?)$/);
  if (lastMatch) {
    const amount = parseInt(lastMatch[1], 10);
    const unit = lastMatch[2];
    const now = Date.now();

    let msAgo: number;
    if (unit.startsWith("hour")) {
      msAgo = amount * 60 * 60 * 1000;
    } else if (unit.startsWith("day")) {
      msAgo = amount * 24 * 60 * 60 * 1000;
    } else if (unit.startsWith("week")) {
      msAgo = amount * 7 * 24 * 60 * 60 * 1000;
    } else if (unit.startsWith("month")) {
      msAgo = amount * 30 * 24 * 60 * 60 * 1000;
    } else {
      return null;
    }

    return { after: now - msAgo };
  }

  const rangeMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})(?:[tT][\d:]+)?(?:\s*(?:-|to)\s*)(\d{4}-\d{2}-\d{2})(?:[tT][\d:]+)?$/i,
  );
  if (rangeMatch) {
    const startDate = new Date(rangeMatch[1]);
    const endDate = new Date(rangeMatch[2]);
    endDate.setHours(23, 59, 59, 999);

    if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
      return {
        after: startDate.getTime(),
        before: endDate.getTime(),
      };
    }
  }

  const singleDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (singleDateMatch) {
    const startDate = new Date(singleDateMatch[1]);
    const endDate = new Date(singleDateMatch[1]);
    endDate.setHours(23, 59, 59, 999);

    if (!Number.isNaN(startDate.getTime())) {
      return {
        after: startDate.getTime(),
        before: endDate.getTime(),
      };
    }
  }

  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[tT]([\d:]+)$/);
  if (isoMatch) {
    const date = new Date(`${isoMatch[1]}T${isoMatch[2]}`);
    if (!Number.isNaN(date.getTime())) {
      return { after: date.getTime() };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegisteredTool {
  name: string;
  namespacedName?: string;
  pluginId: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  sessionName: string;
}

// ---------------------------------------------------------------------------
// Plugin tool registry (shared mutable state)
// ---------------------------------------------------------------------------

export const pluginTools = new Map<string, RegisteredTool>();
export let mcpServerDirty = true;
export let cachedMcpServer: unknown = null;

export function markDirty(): void {
  mcpServerDirty = true;
}

export function setCachedServer(server: unknown): void {
  cachedMcpServer = server;
  mcpServerDirty = false;
}

// ---------------------------------------------------------------------------
// Session function forwarding (lazy injection to avoid circular imports)
// ---------------------------------------------------------------------------

export let injectFn:
  | ((session: string, message: string, opts?: Record<string, unknown>) => Promise<{ response: string }>)
  | null = null;
export let getSessions: (() => Promise<Record<string, string>>) | null = null;
export let readConversationLog:
  | ((
      session: string,
      limit: number,
    ) => Promise<
      Array<{
        ts: number;
        from: string;
        type: string;
        content: string;
        channel?: { id: string; type: string; name?: string };
      }>
    >)
  | null = null;
export let setSessionContext: ((name: string, purpose: string) => Promise<void>) | null = null;

export function setSessionFunctions(fns: {
  inject: typeof injectFn;
  getSessions: typeof getSessions;
  readConversationLog: typeof readConversationLog;
  setSessionContext: typeof setSessionContext;
}): void {
  injectFn = fns.inject;
  getSessions = fns.getSessions;
  readConversationLog = fns.readConversationLog;
  setSessionContext = fns.setSessionContext;
}

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

export function checkToolPermission(toolName: string, sessionName: string): PolicyCheckResult | null {
  const context = getContext(sessionName);
  if (!context) return null;
  const check = context.canUseTool(toolName);
  if (!check.allowed) {
    if (isEnforcementEnabled()) {
      return check;
    }
    logger.warn(`[a2a-mcp] Tool ${toolName} denied for ${sessionName}: ${check.reason} (enforcement disabled)`);
  }
  return null;
}

export async function withSecurityCheck<T>(
  toolName: string,
  sessionName: string,
  fn: () => Promise<T>,
): Promise<T | { content: Array<{ type: string; text: string }>; isError: true }> {
  const denied = checkToolPermission(toolName, sessionName);
  if (denied) {
    return {
      content: [{ type: "text", text: `Access denied: ${denied.reason}` }],
      isError: true,
    };
  }
  return fn();
}

// ---------------------------------------------------------------------------
// Path resolvers
// ---------------------------------------------------------------------------

export function resolveRootFile(
  sessionDir: string,
  filename: string,
): { path: string; exists: boolean; isGlobal: boolean } {
  const globalPath = join(GLOBAL_IDENTITY_DIR, filename);
  if (existsSync(globalPath)) {
    return { path: globalPath, exists: true, isGlobal: true };
  }
  const sessionPath = join(sessionDir, filename);
  if (existsSync(sessionPath)) {
    return { path: sessionPath, exists: true, isGlobal: false };
  }
  return { path: sessionPath, exists: false, isGlobal: false };
}

export function resolveMemoryFile(
  sessionDir: string,
  filename: string,
): { path: string; exists: boolean; isGlobal: boolean } {
  const globalPath = join(GLOBAL_MEMORY_DIR, filename);
  if (existsSync(globalPath)) {
    return { path: globalPath, exists: true, isGlobal: true };
  }
  const sessionPath = join(sessionDir, "memory", filename);
  if (existsSync(sessionPath)) {
    return { path: sessionPath, exists: true, isGlobal: false };
  }
  return { path: sessionPath, exists: false, isGlobal: false };
}

export function listAllMemoryFiles(sessionDir: string): string[] {
  const files = new Set<string>();
  if (existsSync(GLOBAL_MEMORY_DIR)) {
    for (const f of readdirSync(GLOBAL_MEMORY_DIR)) {
      if (f.endsWith(".md")) files.add(f);
    }
  }
  const sessionMemoryDir = join(sessionDir, "memory");
  if (existsSync(sessionMemoryDir)) {
    for (const f of readdirSync(sessionMemoryDir)) {
      if (f.endsWith(".md")) files.add(f);
    }
  }
  return [...files];
}

// ---------------------------------------------------------------------------
// Tool registration API (for plugins)
// ---------------------------------------------------------------------------

export function registerA2ATool(t: RegisteredTool): void {
  const namespacedKey = `${t.pluginId}:${t.name}`;

  const tool: RegisteredTool = {
    ...t,
    namespacedName: namespacedKey,
  };

  if (pluginTools.has(namespacedKey)) {
    logger.warn(`[a2a-mcp] Overwriting existing tool: ${namespacedKey}`);
  }

  logger.info(`[a2a-mcp] Registering tool: ${namespacedKey}`);
  pluginTools.set(namespacedKey, tool);
  markDirty();
}

export function unregisterA2ATool(name: string): boolean {
  const removed = pluginTools.delete(name);
  if (removed) {
    logger.info(`[a2a-mcp] Unregistered tool: ${name}`);
    markDirty();
  }
  return removed;
}

export function listA2ATools(): string[] {
  return [...pluginTools.keys()];
}
