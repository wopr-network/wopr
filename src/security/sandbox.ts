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
import { eventBus } from "../core/events.js";
import { logger } from "../logger.js";
import { getPluginExtension } from "../plugins/extensions.js";
import { getContext } from "./context.js";
import type { SandboxConfig as LegacySandboxConfig, SecurityConfig } from "./types.js";

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

/**
 * Log a warning at startup if plugin sandboxing is disabled.
 * Called from initSecurity() after the security config is loaded.
 */
export function warnSandboxDisabled(config: SecurityConfig): void {
  // Check if warning is suppressed
  if (config.warnOnDisabledSandbox === false) {
    return;
  }

  // Check if sandbox is enabled in the default policy
  if (config.defaults?.sandbox?.enabled) {
    return;
  }

  logger.warn(
    "[SECURITY] Plugin sandboxing is disabled — plugins run with full process access. " +
      "Set sandbox.mode to 'non-main' or 'all' in config, or install wopr-plugin-sandbox. " +
      "To suppress this warning, set security.warnOnDisabledSandbox to false.",
  );
}

// ============================================================================
// Docker helper (for functions that need docker when plugin isn't loaded)
// ============================================================================

/**
 * Map common signal names to their numeric values.
 * Used to compute 128+N exit codes for signal-killed processes
 * following the standard Unix convention (e.g., SIGKILL=9 -> exit 137).
 */
const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGABRT: 6,
  SIGKILL: 9,
  SIGTERM: 15,
};

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
    child.on("close", (code, signal) => {
      let exitCode: number;
      if (code !== null) {
        exitCode = code;
      } else if (signal) {
        const sigNum = SIGNAL_NUMBERS[signal] ?? 9; // default to SIGKILL convention
        exitCode = 128 + sigNum;
        logger.warn(
          `[sandbox] docker process killed by signal ${signal} (exit code ${exitCode}): docker ${args.join(" ")}`,
        );
      } else {
        // code is null and no signal — treat as generic failure
        exitCode = 1;
        logger.warn(
          `[sandbox] docker process exited with null code and no signal (treating as failure): docker ${args.join(" ")}`,
        );
      }
      if (exitCode !== 0 && !opts?.allowFailure) {
        reject(new Error(stderr.trim() || `docker ${args.join(" ")} failed (exit code ${exitCode})`));
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
  if (!ctx) {
    logger.warn(`[sandbox] No security context found for session ${sessionName}, defaulting to untrusted`);
  }
  const trustLevel = ctx?.source?.trustLevel ?? "untrusted";

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

  const ctx = getContext(sessionName);
  if (!ctx) {
    logger.warn(`[sandbox] execInSandbox: missing context for session ${sessionName}, defaulting to untrusted`);
  }
  const trustLevel = ctx?.source?.trustLevel ?? "untrusted";
  const sandbox = await ext.resolveSandboxContext({ sessionName, trustLevel });
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
    const containerNames = result.stdout
      .trim()
      .split("\n")
      .filter((name) => name.length > 0);
    for (const name of containerNames) {
      logger.debug(`[sandbox] Removing container ${name} for session ${sessionName}`);
      await execDocker(["rm", "-f", name], { allowFailure: true });
    }
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
    for (const name of result.stdout
      .trim()
      .split("\n")
      .filter((n) => n.length > 0)) {
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
  // Default-deny policy: only explicitly allowlisted syscalls are permitted.
  // This is the only correct approach for sandboxing untrusted plugin code.
  //
  // Allowlist based on what a Node.js (libuv) process needs inside a
  // Docker container. Deliberately excludes: ptrace, bpf, keyctl,
  // perf_event_open, userfaultfd, clone/fork/execve, mount, modules,
  // reboot, io_uring, and all other privileged/dangerous syscalls.
  const allowedSyscalls = [
    // File I/O
    "read",
    "write",
    "open",
    "openat",
    "close",
    "stat",
    "fstat",
    "lstat",
    "newfstatat",
    "statx",
    "poll",
    "lseek",
    "pread64",
    "pwrite64",
    "readv",
    "writev",
    "preadv",
    "pwritev",
    "preadv2",
    "pwritev2",
    "access",
    "faccessat",
    "faccessat2",
    "pipe",
    "pipe2",
    "dup",
    "dup2",
    "dup3",
    "fcntl",
    "flock",
    "fsync",
    "fdatasync",
    "truncate",
    "ftruncate",
    "getdents",
    "getdents64",
    "getcwd",
    "chdir",
    "fchdir",
    "rename",
    "renameat",
    "renameat2",
    "mkdir",
    "mkdirat",
    "rmdir",
    "creat",
    "unlink",
    "unlinkat",
    "symlink",
    "symlinkat",
    "readlink",
    "readlinkat",
    "chmod",
    "fchmod",
    "fchmodat",
    "chown",
    "fchown",
    "fchownat",
    "lchown",
    "umask",
    "fallocate",
    "fadvise64",
    "sync_file_range",
    "splice",
    "tee",
    "copy_file_range",
    "sendfile",
    "inotify_init1",
    "inotify_add_watch",
    "inotify_rm_watch",
    "timerfd_create",
    "timerfd_settime",
    "timerfd_gettime",
    "eventfd",
    "eventfd2",

    // Memory management
    "brk",
    "mmap",
    "mprotect",
    "munmap",
    "mremap",
    "msync",
    "mincore",
    "madvise",
    "mlock",
    "mlock2",
    "munlock",
    "mlockall",
    "munlockall",
    "pkey_mprotect",
    "pkey_alloc",
    "pkey_free",
    "membarrier",
    "memfd_create",

    // Signals
    "rt_sigaction",
    "rt_sigprocmask",
    "rt_sigreturn",
    "rt_sigpending",
    "rt_sigtimedwait",
    "rt_sigsuspend",
    "rt_tgsigqueueinfo",
    "sigaltstack",
    "kill",
    "tgkill",
    "tkill",

    // Networking (required for Node.js HTTP, WebSocket, etc.)
    "socket",
    "connect",
    "accept",
    "accept4",
    "bind",
    "listen",
    "sendto",
    "recvfrom",
    "sendmsg",
    "recvmsg",
    "sendmmsg",
    "recvmmsg",
    "shutdown",
    "getsockname",
    "getpeername",
    "socketpair",
    "getsockopt",
    "setsockopt",

    // epoll (libuv event loop)
    "epoll_create",
    "epoll_create1",
    "epoll_ctl",
    "epoll_wait",
    "epoll_pwait",
    "epoll_pwait2",

    // select/poll (fallback event mechanisms)
    "select",
    "pselect6",
    "ppoll",

    // Process info (read-only, no process creation)
    "getpid",
    "getppid",
    "gettid",
    "getuid",
    "getgid",
    "geteuid",
    "getegid",
    "getresuid",
    "getresgid",
    "getgroups",
    "getpgrp",
    "getpgid",
    "getsid",
    "uname",
    "sysinfo",
    "getrlimit",
    "prlimit64",
    "getrusage",
    "times",

    // Scheduling and time
    "sched_yield",
    "sched_getaffinity",
    "nanosleep",
    "clock_nanosleep",
    "clock_gettime",
    "clock_getres",
    "gettimeofday",
    "getitimer",
    "setitimer",

    // Thread synchronization (futex is critical for V8/libuv)
    "futex",
    "set_robust_list",
    "get_robust_list",

    // Process setup (required by libc/dynamic linker, NOT process creation)
    "arch_prctl",
    "set_tid_address",
    "set_thread_area",
    "get_thread_area",
    "prctl",
    "seccomp",

    // Exit
    "exit",
    "exit_group",
    "wait4",
    "waitid",

    // Misc required by Node.js / libc
    "ioctl",
    "getrandom",
    "close_range",
    "restart_syscall",
    "rseq",
    "sched_getparam",
    "sched_getscheduler",
  ];

  const profile = {
    defaultAction: "SCMP_ACT_ERRNO",
    architectures: ["SCMP_ARCH_X86_64", "SCMP_ARCH_X86", "SCMP_ARCH_X32"],
    syscalls: [
      {
        names: allowedSyscalls,
        action: "SCMP_ACT_ALLOW",
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

// Clean up connectionTimestamps when sessions are destroyed to prevent memory leak.
// The close() handler on McpSocketBridgeHandle already deletes the entry, but sessions
// can be deleted without their bridge being explicitly closed first.
eventBus.on("session:destroy", ({ session }) => {
  connectionTimestamps.delete(session);
  destroyMcpSocketBridge(session);
});
