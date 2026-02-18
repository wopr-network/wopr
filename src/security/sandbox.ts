/**
 * WOPR Security Sandbox Integration
 *
 * Bridges the sandbox plugin with the security model.
 * Uses Docker-based isolation for untrusted sessions.
 *
 * Sandbox logic now lives in @wopr-network/wopr-plugin-sandbox.
 * This module accesses it via the plugin extension system.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createServer, connect as netConnect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../logger.js";
import { getPluginExtension } from "../plugins/extensions.js";
import { getContext } from "./context.js";
import type { SandboxConfig as LegacySandboxConfig } from "./types.js";

// ============================================================================
// Sandbox Extension Interface (provided by wopr-plugin-sandbox)
// ============================================================================

/**
 * Sandbox context — returned by the sandbox plugin.
 */
export interface SandboxContext {
  enabled: boolean;
  sessionKey: string;
  workspaceDir: string;
  workspaceAccess: "none" | "ro" | "rw";
  containerName: string;
  containerWorkdir: string;
  docker: Record<string, unknown>;
  tools: { allow?: string[]; deny?: string[] };
}

/**
 * Extension API registered by wopr-plugin-sandbox.
 */
interface SandboxExtension {
  resolveSandboxContext(params: { sessionName: string; trustLevel?: string }): Promise<SandboxContext | null>;
  execInContainer(
    containerName: string,
    command: string,
    opts?: { workdir?: string; env?: Record<string, string>; timeout?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  execDocker(
    args: string[],
    opts?: { allowFailure?: boolean },
  ): Promise<{ stdout: string; stderr: string; code: number }>;
  pruneAllSandboxes(): Promise<number>;
  shouldSandbox(params: { sessionName: string; trustLevel?: string }): boolean;
}

/**
 * Get the sandbox extension from the plugin system.
 * Returns undefined if the sandbox plugin is not installed.
 */
function getSandboxExtension(): SandboxExtension | undefined {
  return getPluginExtension<SandboxExtension>("sandbox");
}

// ============================================================================
// Docker helper (for functions that need docker when plugin isn't loaded)
// ============================================================================

function execDockerDirect(
  args: string[],
  opts?: { allowFailure?: boolean },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      const exitCode = code ?? 0;
      if (exitCode !== 0 && !opts?.allowFailure) {
        reject(new Error(stderr.trim() || `docker ${args.join(" ")} failed`));
        return;
      }
      resolve({ stdout, stderr, code: exitCode });
    });
    child.on("error", (err) => {
      if (opts?.allowFailure) {
        resolve({ stdout, stderr, code: 1 });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Run a docker command, preferring the plugin extension if available.
 */
async function execDocker(
  args: string[],
  opts?: { allowFailure?: boolean },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const ext = getSandboxExtension();
  if (ext) {
    return ext.execDocker(args, opts);
  }
  return execDockerDirect(args, opts);
}

// ============================================================================
// Security-Aware Sandbox Resolution
// ============================================================================

/**
 * Resolve sandbox context for a session based on its security context.
 */
export async function getSandboxForSession(sessionName: string): Promise<SandboxContext | null> {
  const ext = getSandboxExtension();
  if (!ext) {
    return null; // Sandbox plugin not installed
  }

  // Get the security context for this session
  const ctx = getContext(sessionName);
  const trustLevel = ctx?.source?.trustLevel ?? "owner";

  // Resolve sandbox context based on trust level
  return ext.resolveSandboxContext({
    sessionName,
    trustLevel,
  });
}

/**
 * Execute a command in a session's sandbox.
 * If the session is not sandboxed, returns null.
 */
export async function execInSandbox(
  sessionName: string,
  command: string,
  options?: {
    timeout?: number;
    workDir?: string;
    env?: Record<string, string>;
  },
): Promise<{ stdout: string; stderr: string; exitCode: number } | null> {
  const ext = getSandboxExtension();
  if (!ext) {
    return null;
  }

  const sandbox = await getSandboxForSession(sessionName);
  if (!sandbox) {
    return null; // Not sandboxed
  }

  return ext.execInContainer(sandbox.containerName, command, {
    workdir: options?.workDir ?? sandbox.containerWorkdir,
    env: options?.env,
    timeout: options?.timeout,
  });
}

/**
 * Check if a session is sandboxed.
 */
export async function isSessionSandboxed(sessionName: string): Promise<boolean> {
  const sandbox = await getSandboxForSession(sessionName);
  return sandbox !== null;
}

// ============================================================================
// Legacy API (for backwards compatibility)
// ============================================================================

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await execDocker(["info"], { allowFailure: true });
    return result.code === 0;
  } catch {
    return false;
  }
}

/**
 * Check if the sandbox image exists
 */
export async function isSandboxImageAvailable(): Promise<boolean> {
  try {
    const result = await execDocker(["image", "inspect", "wopr-sandbox:bookworm-slim"], { allowFailure: true });
    return result.code === 0;
  } catch {
    return false;
  }
}

/**
 * Build the sandbox Docker image
 */
export async function buildSandboxImage(_force = false): Promise<void> {
  const image = "wopr-sandbox:bookworm-slim";
  // Check if image already exists
  const exists = await execDocker(["image", "inspect", image], { allowFailure: true });
  if (exists.code === 0) {
    return;
  }
  logger.info("[sandbox] Pulling debian:bookworm-slim as base image");
  await execDocker(["pull", "debian:bookworm-slim"]);
  await execDocker(["tag", "debian:bookworm-slim", image]);
}

/**
 * Create a sandboxed container for a session (legacy API)
 */
export async function createSandbox(
  sessionName: string,
  _config: LegacySandboxConfig,
  _workspacePath?: string,
): Promise<{ containerId: string; sessionName: string; status: string }> {
  const sandbox = await getSandboxForSession(sessionName);
  if (!sandbox) {
    throw new Error("Session is not configured for sandboxing");
  }

  return {
    containerId: sandbox.containerName,
    sessionName,
    status: "running",
  };
}

/**
 * Destroy a sandbox (legacy API)
 */
export async function destroySandbox(sessionName: string): Promise<void> {
  const result = await execDocker(
    ["ps", "-a", "--filter", `label=wopr.sessionKey=${sessionName}`, "--format", "{{.Names}}"],
    { allowFailure: true },
  );
  if (result.code === 0 && result.stdout.trim()) {
    const containerName = result.stdout.trim().split("\n")[0];
    await execDocker(["rm", "-f", containerName], { allowFailure: true });
  }
}

/**
 * Get sandbox status (legacy API)
 */
export async function getSandboxStatus(
  sessionName: string,
): Promise<{ containerId: string; sessionName: string; status: string } | null> {
  const sandbox = await getSandboxForSession(sessionName);
  if (!sandbox) {
    return null;
  }
  return {
    containerId: sandbox.containerName,
    sessionName,
    status: "running",
  };
}

/**
 * List all active sandboxes (legacy API)
 */
export async function listSandboxes(): Promise<
  Array<{
    containerId: string;
    sessionName: string;
    createdAt: number;
    status: string;
  }>
> {
  const result = await execDocker(
    [
      "ps",
      "-a",
      "--filter",
      "label=wopr.sandbox=1",
      "--format",
      '{{.Names}}\t{{.Label "wopr.sessionKey"}}\t{{.Label "wopr.createdAtMs"}}',
    ],
    { allowFailure: true },
  );
  if (result.code !== 0 || !result.stdout.trim()) {
    return [];
  }
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [containerId, sessionKey, createdAtStr] = line.split("\t");
      return {
        containerId: containerId || "",
        sessionName: sessionKey || "",
        createdAt: Number(createdAtStr) || Date.now(),
        status: "running",
      };
    });
}

/**
 * Cleanup all sandboxes
 */
export async function cleanupAllSandboxes(): Promise<void> {
  const ext = getSandboxExtension();
  if (ext) {
    logger.info("[sandbox] Cleaning up all sandboxes via plugin");
    await ext.pruneAllSandboxes();
    return;
  }
  // Fallback: use docker directly
  logger.info("[sandbox] Cleaning up all sandboxes via docker");
  const result = await execDocker(["ps", "-a", "--filter", "label=wopr.sandbox=1", "--format", "{{.Names}}"], {
    allowFailure: true,
  });
  if (result.code === 0 && result.stdout.trim()) {
    for (const name of result.stdout.trim().split("\n")) {
      await execDocker(["rm", "-f", name], { allowFailure: true });
    }
  }
}

// ============================================================================
// Seccomp Profile (kept for reference, but Docker defaults are usually fine)
// ============================================================================

/**
 * Generate seccomp profile for sandboxing
 */
export function generateSeccompProfile(): string {
  const profile = {
    defaultAction: "SCMP_ACT_ALLOW",
    syscalls: [
      {
        names: ["clone", "clone3", "fork", "vfork"],
        action: "SCMP_ACT_ERRNO",
        args: [],
      },
      {
        names: ["socket", "connect", "bind", "listen", "accept", "accept4"],
        action: "SCMP_ACT_ERRNO",
        args: [],
      },
      {
        names: ["mount", "umount", "umount2", "pivot_root"],
        action: "SCMP_ACT_ERRNO",
        args: [],
      },
      {
        names: ["init_module", "finit_module", "delete_module"],
        action: "SCMP_ACT_ERRNO",
        args: [],
      },
      {
        names: ["reboot", "sethostname", "setdomainname", "kexec_load", "kexec_file_load"],
        action: "SCMP_ACT_ERRNO",
        args: [],
      },
    ],
  };

  return JSON.stringify(profile, null, 2);
}

// ============================================================================
// MCP Socket Bridge
// ============================================================================

/**
 * Handle for an active MCP socket bridge.
 * Call close() to tear down the bridge and clean up resources.
 */
export interface McpSocketBridgeHandle {
  hostDir: string;
  hostSocketPath: string;
  containerSocketPath: string;
  containerName: string;
  close: () => void;
}

const activeBridges = new Map<string, McpSocketBridgeHandle>();

const connectionTimestamps = new Map<string, number[]>();
const MAX_CONNECTIONS_PER_SECOND = 10;

/**
 * Create an MCP socket bridge for a sandboxed session.
 */
export async function createMcpSocketBridge(sessionName: string, socketPath: string): Promise<McpSocketBridgeHandle> {
  const existing = activeBridges.get(sessionName);
  if (existing) {
    logger.warn(`[sandbox] MCP bridge already exists for session ${sessionName}, closing old bridge`);
    existing.close();
  }

  const sandbox = await getSandboxForSession(sessionName);
  if (!sandbox) {
    throw new Error(`Session ${sessionName} is not sandboxed — cannot create MCP bridge`);
  }

  const hostDir = join(tmpdir(), `wopr-mcp-bridge-${sandbox.containerName}`);
  mkdirSync(hostDir, { recursive: true });
  const hostSocketFile = join(hostDir, "mcp.sock");

  rmSync(hostSocketFile, { force: true });

  const containerSocketDir = "/run/wopr-mcp";
  const containerSocketPath = `${containerSocketDir}/mcp.sock`;

  const clients = new Set<Socket>();

  const server: Server = createServer((clientConn: Socket) => {
    const now = Date.now();
    const timestamps = connectionTimestamps.get(sessionName) ?? [];
    const recentTimestamps = timestamps.filter((t) => now - t < 1000);
    if (recentTimestamps.length >= MAX_CONNECTIONS_PER_SECOND) {
      logger.warn(`[sandbox] MCP bridge: rate limit exceeded for session ${sessionName}, rejecting connection`);
      clientConn.destroy();
      return;
    }
    recentTimestamps.push(now);
    connectionTimestamps.set(sessionName, recentTimestamps);

    logger.debug(`[sandbox] MCP bridge: new connection for session ${sessionName}`);
    clients.add(clientConn);

    const upstream: Socket = netConnect(socketPath, () => {
      logger.debug(`[sandbox] MCP bridge: connected to upstream MCP at ${socketPath}`);
    });

    clientConn.pipe(upstream);
    upstream.pipe(clientConn);

    clientConn.on("error", (err) => {
      logger.warn(`[sandbox] MCP bridge client error: ${err.message}`);
      clients.delete(clientConn);
      upstream.destroy();
    });
    upstream.on("error", (err) => {
      logger.warn(`[sandbox] MCP bridge upstream error: ${err.message}`);
      clients.delete(clientConn);
      clientConn.destroy();
    });

    const cleanup = () => {
      clients.delete(clientConn);
      if (!clientConn.destroyed) clientConn.destroy();
      if (!upstream.destroyed) upstream.destroy();
    };
    clientConn.on("close", cleanup);
    upstream.on("close", cleanup);
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(hostSocketFile, () => {
      server.removeListener("error", reject);
      server.on("error", (err) => {
        logger.warn(`[sandbox] MCP bridge server error for session ${sessionName}: ${err.message}`);
      });
      resolve();
    });
  });

  logger.info(`[sandbox] MCP bridge listening at ${hostSocketFile} for session ${sessionName}`);

  try {
    await execDocker(["exec", sandbox.containerName, "mkdir", "-p", containerSocketDir]);
    await execDocker(["cp", hostSocketFile, `${sandbox.containerName}:${containerSocketPath}`]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[sandbox] Could not copy socket into container ${sandbox.containerName}: ${message}. ` +
        `The bridge is listening at ${hostSocketFile} — mount ${hostDir} as a volume for access.`,
    );
  }

  let closed = false;
  const handle: McpSocketBridgeHandle = {
    hostDir,
    hostSocketPath: hostSocketFile,
    containerSocketPath,
    containerName: sandbox.containerName,
    close() {
      if (closed) return;
      closed = true;
      logger.info(`[sandbox] Closing MCP bridge for session ${sessionName}`);
      for (const client of clients) {
        client.destroy();
      }
      clients.clear();
      server.close();
      try {
        rmSync(hostDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
      activeBridges.delete(sessionName);
      connectionTimestamps.delete(sessionName);
    },
  };

  activeBridges.set(sessionName, handle);
  return handle;
}

/**
 * Destroy an active MCP socket bridge for a session.
 * No-op if no bridge exists.
 */
export function destroyMcpSocketBridge(sessionName: string): void {
  const handle = activeBridges.get(sessionName);
  if (handle) {
    handle.close();
  }
}

/**
 * Get the active MCP socket bridge for a session, if any.
 */
export function getMcpSocketBridge(sessionName: string): McpSocketBridgeHandle | undefined {
  return activeBridges.get(sessionName);
}

/**
 * Get the host directory path for a bridge socket mount.
 */
export function getMcpBridgeMountArgs(sessionName: string): string[] {
  const handle = activeBridges.get(sessionName);
  if (!handle) {
    return [];
  }
  return ["-v", `${handle.hostDir}:/run/wopr-mcp:ro`];
}

// Cleanup on process exit (with hard timeout to prevent hanging)
async function shutdownCleanup(): Promise<void> {
  const timeout = setTimeout(() => {
    logger.warn("[sandbox] Cleanup timed out, forcing exit");
    process.exit(1);
  }, 10000);
  try {
    for (const [, handle] of activeBridges) {
      try {
        handle.close();
      } catch {
        // Best effort
      }
    }
    await cleanupAllSandboxes();
  } catch (err) {
    logger.error(`[sandbox] Cleanup failed during shutdown: ${err}`);
  } finally {
    clearTimeout(timeout);
    process.exit(0);
  }
}

process.on("SIGTERM", shutdownCleanup);
process.on("SIGINT", shutdownCleanup);
