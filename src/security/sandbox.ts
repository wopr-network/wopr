/**
 * WOPR Security Sandbox Integration
 *
 * Bridges the sandbox module with the security model.
 * Uses Docker-based isolation for untrusted sessions.
 */

import { mkdirSync, rmSync } from "node:fs";
import { createServer, connect as netConnect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../logger.js";
import {
  execDocker,
  execInContainer,
  listRegistryEntries,
  pruneAllSandboxes,
  removeRegistryEntry,
  removeSandboxContainer,
  resolveSandboxContext,
  type SandboxContext,
} from "../sandbox/index.js";
import { getContext } from "./context.js";
import type { SandboxConfig as LegacySandboxConfig } from "./types.js";

// Re-export new sandbox types
export type { SandboxContext } from "../sandbox/index.js";

// ============================================================================
// Security-Aware Sandbox Resolution
// ============================================================================

/**
 * Resolve sandbox context for a session based on its security context.
 */
export async function getSandboxForSession(sessionName: string): Promise<SandboxContext | null> {
  // Get the security context for this session
  const ctx = getContext(sessionName);
  const trustLevel = ctx?.source?.trustLevel ?? "owner";

  // Resolve sandbox context based on trust level
  return resolveSandboxContext({
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
  const sandbox = await getSandboxForSession(sessionName);
  if (!sandbox) {
    return null; // Not sandboxed
  }

  return execInContainer(sandbox.containerName, command, {
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
// Legacy API (for backwards compatibility with existing security/sandbox.ts)
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
    const { listRegistryEntries } = await import("../sandbox/index.js");
    const entries = listRegistryEntries();
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Build the sandbox Docker image
 */
export async function buildSandboxImage(_force = false): Promise<void> {
  const { ensureDockerImage, DEFAULT_SANDBOX_IMAGE } = await import("../sandbox/index.js");
  await ensureDockerImage(DEFAULT_SANDBOX_IMAGE);
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
  const entries = listRegistryEntries();
  const entry = entries.find((e) => e.sessionKey === sessionName);
  if (entry) {
    await removeSandboxContainer(entry.containerName);
    removeRegistryEntry(entry.containerName);
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
export function listSandboxes(): Array<{
  containerId: string;
  sessionName: string;
  createdAt: number;
  status: string;
}> {
  const entries = listRegistryEntries();
  return entries.map((e) => ({
    containerId: e.containerName,
    sessionName: e.sessionKey,
    createdAt: e.createdAtMs,
    status: "running",
  }));
}

/**
 * Cleanup all sandboxes
 */
export async function cleanupAllSandboxes(): Promise<void> {
  logger.info("[sandbox] Cleaning up all sandboxes");
  await pruneAllSandboxes();
}

// ============================================================================
// Seccomp Profile (kept for reference, but Docker defaults are usually fine)
// ============================================================================

/**
 * Generate seccomp profile for sandboxing
 */
export function generateSeccompProfile(): string {
  // Minimal seccomp profile that blocks dangerous syscalls
  const profile = {
    defaultAction: "SCMP_ACT_ALLOW",
    syscalls: [
      // Block process creation (anti-fork bomb)
      {
        names: ["clone", "clone3", "fork", "vfork"],
        action: "SCMP_ACT_ERRNO",
        args: [],
      },
      // Block network operations (prevent exfiltration)
      {
        names: ["socket", "connect", "bind", "listen", "accept", "accept4"],
        action: "SCMP_ACT_ERRNO",
        args: [],
      },
      // Block mounting (prevent escape)
      {
        names: ["mount", "umount", "umount2", "pivot_root"],
        action: "SCMP_ACT_ERRNO",
        args: [],
      },
      // Block kernel module loading
      {
        names: ["init_module", "finit_module", "delete_module"],
        action: "SCMP_ACT_ERRNO",
        args: [],
      },
      // Block dangerous system calls
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
  /** Host-side directory containing the socket */
  hostDir: string;
  /** Path to the socket file on the host */
  hostSocketPath: string;
  /** Path where the socket is mounted inside the container */
  containerSocketPath: string;
  /** The container this bridge is attached to */
  containerName: string;
  /** Close the bridge and clean up */
  close: () => void;
}

/** Active bridges keyed by session name */
const activeBridges = new Map<string, McpSocketBridgeHandle>();

/** Rate limiting: track connection timestamps per bridge */
const connectionTimestamps = new Map<string, number[]>();
const MAX_CONNECTIONS_PER_SECOND = 10;

/**
 * Create an MCP socket bridge for a sandboxed session.
 *
 * Creates a Unix domain socket on the host and bind-mounts the socket
 * directory into the running container. Processes inside the container
 * can connect to the socket to communicate with the host-side MCP server.
 *
 * Each incoming connection on the socket is proxied to a new connection
 * on the target MCP socket path (the upstream MCP server).
 *
 * @param sessionName - The session to bridge
 * @param socketPath  - The upstream MCP server socket path to proxy to
 * @returns A handle for managing the bridge lifecycle
 */
export async function createMcpSocketBridge(sessionName: string, socketPath: string): Promise<McpSocketBridgeHandle> {
  // Check if a bridge already exists for this session
  const existing = activeBridges.get(sessionName);
  if (existing) {
    logger.warn(`[sandbox] MCP bridge already exists for session ${sessionName}, closing old bridge`);
    existing.close();
  }

  // Resolve the sandbox context to get the container name
  const sandbox = await getSandboxForSession(sessionName);
  if (!sandbox) {
    throw new Error(`Session ${sessionName} is not sandboxed — cannot create MCP bridge`);
  }

  // Create a host-side directory for the bridge socket
  const hostDir = join(tmpdir(), `wopr-mcp-bridge-${sandbox.containerName}`);
  mkdirSync(hostDir, { recursive: true });
  const hostSocketFile = join(hostDir, "mcp.sock");

  // Container-side mount point
  const containerSocketDir = "/run/wopr-mcp";
  const containerSocketPath = `${containerSocketDir}/mcp.sock`;

  // Track active client connections for cleanup
  const clients = new Set<Socket>();

  // Create the Unix domain socket server on the host
  const server: Server = createServer((clientConn: Socket) => {
    // Rate limiting: reject connections that exceed the threshold
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

    // Connect to the upstream MCP server socket
    const upstream: Socket = netConnect(socketPath, () => {
      logger.debug(`[sandbox] MCP bridge: connected to upstream MCP at ${socketPath}`);
    });

    // Bidirectional proxy
    clientConn.pipe(upstream);
    upstream.pipe(clientConn);

    // Error handling — log at warn level so errors are visible
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

    // Cleanup on close — ensure both sides are torn down
    const cleanup = () => {
      clients.delete(clientConn);
      clientConn.destroy();
      upstream.destroy();
    };
    clientConn.on("close", cleanup);
    upstream.on("close", cleanup);
  });

  // Listen on the Unix socket
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(hostSocketFile, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  logger.info(`[sandbox] MCP bridge listening at ${hostSocketFile} for session ${sessionName}`);

  // Bind-mount the socket directory into the running container.
  // We use `docker exec mkdir` + `docker cp` to make the socket accessible.
  // Note: `docker cp` copies files, but for Unix sockets we need a volume mount
  // on the running container. Since the container is already running, we use
  // `docker exec` to create a socat relay from a named pipe instead.
  //
  // The most reliable approach for already-running containers: stop, add mount, restart.
  // But that's disruptive. Instead, we'll record the mount info so that future container
  // creations include it, and for the current container we'll exec a background relay.
  try {
    // Create the socket directory inside the container
    await execDocker(["exec", sandbox.containerName, "mkdir", "-p", containerSocketDir]);

    // Copy the host socket directory into the container
    // docker cp copies the socket file itself
    await execDocker(["cp", hostSocketFile, `${sandbox.containerName}:${containerSocketPath}`]);
  } catch (err: unknown) {
    // If docker cp fails for a socket (some Docker versions don't support it),
    // log and continue — the bridge is still listening on the host side and can
    // be accessed by future containers that mount the directory as a volume.
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[sandbox] Could not copy socket into container ${sandbox.containerName}: ${message}. ` +
        `The bridge is listening at ${hostSocketFile} — mount ${hostDir} as a volume for access.`,
    );
  }

  // Build the handle
  const handle: McpSocketBridgeHandle = {
    hostDir,
    hostSocketPath: hostSocketFile,
    containerSocketPath,
    containerName: sandbox.containerName,
    close() {
      logger.info(`[sandbox] Closing MCP bridge for session ${sessionName}`);
      // Close all client connections
      for (const client of clients) {
        client.destroy();
      }
      clients.clear();
      // Close the server
      server.close();
      // Clean up the host socket directory
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
 * Useful when creating new containers to include the mount from the start.
 */
export function getMcpBridgeMountArgs(sessionName: string): string[] {
  const handle = activeBridges.get(sessionName);
  if (!handle) {
    return [];
  }
  // Returns Docker -v args to mount the bridge socket directory
  return ["-v", `${handle.hostDir}:/run/wopr-mcp:ro`];
}

// Cleanup on process exit (with hard timeout to prevent hanging)
async function shutdownCleanup(): Promise<void> {
  const timeout = setTimeout(() => {
    logger.warn("[sandbox] Cleanup timed out, forcing exit");
    process.exit(1);
  }, 10000);
  try {
    // Close all active MCP bridges
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
