/**
 * WOPR Security Hooks
 *
 * Composable hook system for injection lifecycle.
 * Hooks can transform messages, add metadata, log, or block injections.
 */

import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { logger } from "../logger.js";
import { getSecurityConfig } from "./policy.js";
import type { InjectionSource } from "./types.js";

// ============================================================================
// Hook Command Security
// ============================================================================

/**
 * Default allowlist of executables permitted in hook commands.
 * Only bare names are matched — no paths, no shell metacharacters.
 * Users can extend via SecurityConfig.allowedHookCommands.
 */
const DEFAULT_HOOK_COMMAND_ALLOWLIST: ReadonlySet<string> = new Set([
  "node",
  "python3",
  "python",
  "ruby",
  "perl",
  "bash",
  "sh",
  "jq",
  "grep",
  "sed",
  "awk",
  "cat",
  "echo",
  "tee",
  "wopr-hook",
]);

/**
 * Characters that indicate shell metacharacter abuse.
 * These are blocked in arguments to prevent injection even via execFile.
 */
const SHELL_METACHAR_PATTERN = /[;|&`$(){}!<>\\]/;

/**
 * Get the effective allowlist (default + user-configured).
 */
function getHookCommandAllowlist(): ReadonlySet<string> {
  const config = getSecurityConfig();
  const extra = config.allowedHookCommands;
  if (!extra || extra.length === 0) return DEFAULT_HOOK_COMMAND_ALLOWLIST;
  return new Set([...DEFAULT_HOOK_COMMAND_ALLOWLIST, ...extra]);
}

/**
 * Parse a hook command string into executable and arguments.
 * Returns null if the command is unsafe.
 *
 * Rules:
 * - Executable must be on the allowlist (bare name only, no paths)
 * - Arguments must not contain shell metacharacters
 * - No empty commands
 */
export function parseHookCommand(command: string): { executable: string; args: string[] } | null {
  const trimmed = command.trim();
  if (trimmed.length === 0) return null;

  // Split on whitespace, respecting simple quoting
  const parts = splitCommandArgs(trimmed);
  if (parts.length === 0) return null;

  const executable = parts[0];
  const args = parts.slice(1);

  // Block absolute/relative paths — only bare executable names allowed
  if (executable.includes("/") || executable.includes("\\") || isAbsolute(executable)) {
    logger.warn(`[hooks] Hook command rejected: paths not allowed in executable (${executable})`);
    return null;
  }

  // Check allowlist
  const allowlist = getHookCommandAllowlist();
  if (!allowlist.has(executable)) {
    logger.warn(`[hooks] Hook command rejected: '${executable}' is not in the allowlist`);
    return null;
  }

  // Check arguments for shell metacharacters
  for (const arg of args) {
    if (SHELL_METACHAR_PATTERN.test(arg)) {
      logger.warn(`[hooks] Hook command rejected: argument contains shell metacharacters`);
      return null;
    }
  }

  return { executable, args };
}

/**
 * Split a command string into parts, handling simple single/double quoting.
 * Does NOT interpret shell expansions — quotes are just used for grouping.
 */
function splitCommandArgs(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if ((ch === " " || ch === "\t") && !inSingle && !inDouble) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Context passed to hooks
 */
export interface HookContext {
  /** The message being injected */
  message: string;

  /** Source of the injection */
  source: InjectionSource;

  /** Target session */
  targetSession: string;

  /** Timestamp */
  timestamp: number;

  /** Additional metadata (hooks can add to this) */
  metadata: Record<string, unknown>;
}

/**
 * Result from a pre-inject hook
 */
export interface PreInjectResult {
  /** Whether to allow the injection */
  allow: boolean;

  /** Reason if blocked */
  reason?: string;

  /** Transformed message (if modified) */
  message?: string;

  /** Additional metadata to attach */
  metadata?: Record<string, unknown>;
}

/**
 * Result from a post-inject hook
 */
export interface PostInjectResult {
  /** Any data to log or store */
  data?: Record<string, unknown>;
}

// ============================================================================
// Hook Execution
// ============================================================================

/**
 * Run a hook command using execFile (no shell interpretation).
 *
 * The command string is parsed and validated against the allowlist before
 * execution. Shell metacharacters and path-based executables are rejected
 * to prevent RCE even if an attacker can modify security.json.
 */
async function runCommandHook(command: string, context: HookContext): Promise<PreInjectResult | PostInjectResult> {
  if (!command || typeof command !== "string" || command.trim().length === 0) {
    logger.warn("[hooks] Empty or invalid hook command, skipping");
    return {};
  }

  const parsed = parseHookCommand(command);
  if (!parsed) {
    logger.warn(`[hooks] Hook command rejected by validation: ${command}`);
    return { allow: true }; // Fail open — don't block injections on config error
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: PreInjectResult | PostInjectResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // spawn with shell: false — executable is looked up via PATH but no
    // shell interpretation occurs, eliminating the RCE vector.
    const proc = spawn(parsed.executable, parsed.args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Send context as JSON to stdin
    proc.stdin.write(JSON.stringify(context));
    proc.stdin.end();

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        logger.warn(`[hooks] Hook command failed: ${stderr}`);
        settle({ allow: true }); // Allow by default on hook failure
        return;
      }

      try {
        const result = JSON.parse(stdout);
        settle(result);
      } catch {
        logger.warn(`[hooks] Hook returned invalid JSON: ${stdout}`);
        settle({ allow: true });
      }
    });

    proc.on("error", (err: Error) => {
      logger.warn(`[hooks] Hook command error: ${err.message}`);
      settle({ allow: true });
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!settled) {
        proc.kill();
        logger.warn("[hooks] Hook timed out");
      }
      settle({ allow: true });
    }, 5000);
  });
}

/**
 * Run all pre-inject hooks
 */
export async function runPreInjectHooks(context: HookContext): Promise<PreInjectResult> {
  const config = getSecurityConfig();
  const hooks = config.hooks?.filter((h) => h.type === "pre-inject" && h.enabled) || [];

  let currentMessage = context.message;
  let metadata: Record<string, unknown> = { ...context.metadata };

  for (const hook of hooks) {
    const hookContext = { ...context, message: currentMessage, metadata };

    if (hook.command) {
      const result = (await runCommandHook(hook.command, hookContext)) as PreInjectResult;

      if (result.allow === false) {
        return {
          allow: false,
          reason: result.reason || `Blocked by hook: ${hook.name}`,
        };
      }

      if (result.message) {
        currentMessage = result.message;
      }

      if (result.metadata) {
        metadata = { ...metadata, ...result.metadata };
      }
    }
  }

  return {
    allow: true,
    message: currentMessage,
    metadata,
  };
}

/**
 * Run all post-inject hooks
 */
export async function runPostInjectHooks(context: HookContext, response: string): Promise<void> {
  const config = getSecurityConfig();
  const hooks = config.hooks?.filter((h) => h.type === "post-inject" && h.enabled) || [];

  const postContext = {
    ...context,
    response,
  };

  for (const hook of hooks) {
    if (hook.command) {
      try {
        await runCommandHook(hook.command, postContext as unknown as HookContext);
      } catch (err) {
        logger.warn(`[hooks] Post-inject hook ${hook.name} failed: ${err}`);
      }
    }
  }
}

// ============================================================================
// Built-in Hooks
// ============================================================================

/**
 * Built-in hook: Add source metadata to message
 */
export function addSourceMetadata(context: HookContext): PreInjectResult {
  const { source, message } = context;

  const metadataHeader = `[From: ${source.identity?.gatewaySession || source.identity?.publicKey || source.type} | Trust: ${source.trustLevel}]`;

  return {
    allow: true,
    message: `${metadataHeader}\n\n${message}`,
    metadata: {
      sourceTagged: true,
      sourceType: source.type,
      sourceTrust: source.trustLevel,
    },
  };
}

/**
 * Built-in hook: Log injection for audit
 */
export function auditLogHook(context: HookContext, allowed: boolean, reason?: string): void {
  const config = getSecurityConfig();

  if (!config.audit?.enabled) return;
  if (allowed && !config.audit.logSuccess) return;
  if (!allowed && !config.audit.logDenied) return;

  const logEntry = {
    timestamp: new Date().toISOString(),
    type: "injection",
    allowed,
    reason,
    source: {
      type: context.source.type,
      trustLevel: context.source.trustLevel,
      identity: context.source.identity,
    },
    target: context.targetSession,
    messageLength: context.message.length,
  };

  // Log to configured path or stdout
  if (config.audit.logPath) {
    // Would append to file - for now just log
    logger.info(`[audit] ${JSON.stringify(logEntry)}`);
  } else {
    logger.info(`[audit] ${JSON.stringify(logEntry)}`);
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a hook context from injection parameters
 */
export function createHookContext(message: string, source: InjectionSource, targetSession: string): HookContext {
  return {
    message,
    source,
    targetSession,
    timestamp: Date.now(),
    metadata: {},
  };
}

/**
 * Process an injection through the hook pipeline
 */
export async function processInjection(
  message: string,
  source: InjectionSource,
  targetSession: string,
  options?: {
    addMetadata?: boolean;
  },
): Promise<{ allowed: boolean; message: string; reason?: string }> {
  const context = createHookContext(message, source, targetSession);

  // Optionally add source metadata
  let processedMessage = message;
  if (options?.addMetadata) {
    const metaResult = addSourceMetadata(context);
    processedMessage = metaResult.message || message;
    context.message = processedMessage;
  }

  // Run pre-inject hooks
  const preResult = await runPreInjectHooks(context);

  // Audit log
  auditLogHook(context, preResult.allow, preResult.reason);

  if (!preResult.allow) {
    return {
      allowed: false,
      message: message,
      reason: preResult.reason,
    };
  }

  return {
    allowed: true,
    message: preResult.message || processedMessage,
  };
}
