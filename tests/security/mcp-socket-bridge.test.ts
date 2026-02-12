/**
 * MCP Socket Bridge Tests (WOP-105)
 *
 * Tests the MCP socket bridge that allows sandboxed sessions
 * to communicate with MCP servers through a controlled channel.
 */
import { createServer, type Server } from "node:net";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the sandbox context resolution and Docker commands
const mockExecDocker = vi.fn().mockResolvedValue({ stdout: "", stderr: "", code: 0 });
const mockGetSandboxForSession = vi.fn();

vi.mock("../../src/sandbox/index.js", () => ({
  execDocker: (...args: any[]) => mockExecDocker(...args),
  execInContainer: vi.fn(),
  listRegistryEntries: vi.fn().mockReturnValue([]),
  pruneAllSandboxes: vi.fn().mockResolvedValue(undefined),
  removeRegistryEntry: vi.fn(),
  removeSandboxContainer: vi.fn(),
  resolveSandboxContext: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/security/context.js", () => ({
  getContext: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../src/security/types.js", () => ({
  // Not needed directly but re-exported
}));

// We need to mock getSandboxForSession at the module level
// Since it's defined in the same file, we'll use a different approach:
// import the module and spy on the internal function

const {
  createMcpSocketBridge,
  destroyMcpSocketBridge,
  getMcpSocketBridge,
  getMcpBridgeMountArgs,
} = await import("../../src/security/sandbox.js");

// ============================================================================
// Helpers
// ============================================================================

/** Create a temporary Unix socket server that echoes data back */
function createEchoServer(socketPath: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((conn) => {
      conn.on("data", (data) => {
        conn.write(data); // Echo back
      });
    });
    server.on("error", reject);
    server.listen(socketPath, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

/** Clean up a directory safely */
function cleanDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("MCP Socket Bridge", () => {
  let testDir: string;
  let upstreamSocketPath: string;
  let upstreamServer: Server | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = join(tmpdir(), `wopr-mcp-bridge-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    upstreamSocketPath = join(testDir, "upstream.sock");
  });

  afterEach(async () => {
    // Clean up any active bridges
    destroyMcpSocketBridge("test-session");
    destroyMcpSocketBridge("session-a");
    destroyMcpSocketBridge("session-b");

    if (upstreamServer) {
      upstreamServer.close();
      upstreamServer = null;
    }

    cleanDir(testDir);
  });

  // ==========================================================================
  // createMcpSocketBridge
  // ==========================================================================
  describe("createMcpSocketBridge", () => {
    it("should throw when session is not sandboxed", async () => {
      // getSandboxForSession returns null (not sandboxed) because
      // resolveSandboxContext is mocked to return null
      await expect(
        createMcpSocketBridge("unsandboxed-session", upstreamSocketPath),
      ).rejects.toThrow("is not sandboxed");
    });

    it("should create a bridge for a sandboxed session", async () => {
      // Mock resolveSandboxContext to return a sandbox context
      const { resolveSandboxContext } = await import("../../src/sandbox/index.js");
      vi.mocked(resolveSandboxContext).mockResolvedValueOnce({
        enabled: true,
        sessionKey: "test-session",
        workspaceDir: "/tmp/workspace",
        workspaceAccess: "ro",
        containerName: "wopr-sbx-test",
        containerWorkdir: "/workspace",
        docker: {} as any,
        tools: {},
      });

      // Create upstream echo server
      upstreamServer = await createEchoServer(upstreamSocketPath);

      const handle = await createMcpSocketBridge("test-session", upstreamSocketPath);

      expect(handle).toBeDefined();
      expect(handle.containerName).toBe("wopr-sbx-test");
      expect(handle.hostSocketPath).toContain("mcp.sock");
      expect(handle.containerSocketPath).toBe("/run/wopr-mcp/mcp.sock");
      expect(existsSync(handle.hostDir)).toBe(true);

      // Docker exec should have been called to create the directory in the container
      expect(mockExecDocker).toHaveBeenCalledWith(
        ["exec", "wopr-sbx-test", "mkdir", "-p", "/run/wopr-mcp"],
      );

      handle.close();
    });

    it("should replace existing bridge for same session", async () => {
      const { resolveSandboxContext } = await import("../../src/sandbox/index.js");
      const { logger } = await import("../../src/logger.js");

      // First bridge
      vi.mocked(resolveSandboxContext).mockResolvedValueOnce({
        enabled: true,
        sessionKey: "test-session",
        workspaceDir: "/tmp/workspace",
        workspaceAccess: "ro",
        containerName: "wopr-sbx-test",
        containerWorkdir: "/workspace",
        docker: {} as any,
        tools: {},
      });

      upstreamServer = await createEchoServer(upstreamSocketPath);
      await createMcpSocketBridge("test-session", upstreamSocketPath);

      // Second bridge (should close the first and warn)
      vi.mocked(resolveSandboxContext).mockResolvedValueOnce({
        enabled: true,
        sessionKey: "test-session",
        workspaceDir: "/tmp/workspace",
        workspaceAccess: "ro",
        containerName: "wopr-sbx-test",
        containerWorkdir: "/workspace",
        docker: {} as any,
        tools: {},
      });

      const handle2 = await createMcpSocketBridge("test-session", upstreamSocketPath);

      expect(handle2).toBeDefined();
      expect(handle2.containerName).toBe("wopr-sbx-test");
      // Should have logged a warning about replacing the existing bridge
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("already exists"),
      );

      handle2.close();
    });

    it("should survive docker cp failure gracefully", async () => {
      const { resolveSandboxContext } = await import("../../src/sandbox/index.js");
      vi.mocked(resolveSandboxContext).mockResolvedValueOnce({
        enabled: true,
        sessionKey: "test-session",
        workspaceDir: "/tmp/workspace",
        workspaceAccess: "ro",
        containerName: "wopr-sbx-test",
        containerWorkdir: "/workspace",
        docker: {} as any,
        tools: {},
      });

      // Make docker cp fail
      mockExecDocker
        .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 }) // mkdir succeeds
        .mockRejectedValueOnce(new Error("docker cp not supported for sockets"));

      upstreamServer = await createEchoServer(upstreamSocketPath);
      const handle = await createMcpSocketBridge("test-session", upstreamSocketPath);

      // Should still succeed — the bridge is listening on the host side
      expect(handle).toBeDefined();
      expect(handle.hostSocketPath).toContain("mcp.sock");

      handle.close();
    });
  });

  // ==========================================================================
  // destroyMcpSocketBridge
  // ==========================================================================
  describe("destroyMcpSocketBridge", () => {
    it("should be a no-op for non-existent session", () => {
      // Should not throw
      destroyMcpSocketBridge("nonexistent");
    });

    it("should clean up an active bridge", async () => {
      const { resolveSandboxContext } = await import("../../src/sandbox/index.js");
      vi.mocked(resolveSandboxContext).mockResolvedValueOnce({
        enabled: true,
        sessionKey: "test-session",
        workspaceDir: "/tmp/workspace",
        workspaceAccess: "ro",
        containerName: "wopr-sbx-test",
        containerWorkdir: "/workspace",
        docker: {} as any,
        tools: {},
      });

      upstreamServer = await createEchoServer(upstreamSocketPath);
      const handle = await createMcpSocketBridge("test-session", upstreamSocketPath);
      const hostDir = handle.hostDir;

      destroyMcpSocketBridge("test-session");

      // Bridge should be removed
      expect(getMcpSocketBridge("test-session")).toBeUndefined();
      // Host directory should be cleaned up
      expect(existsSync(hostDir)).toBe(false);
    });
  });

  // ==========================================================================
  // getMcpSocketBridge
  // ==========================================================================
  describe("getMcpSocketBridge", () => {
    it("should return undefined for non-existent session", () => {
      expect(getMcpSocketBridge("nonexistent")).toBeUndefined();
    });

    it("should return the handle for an active bridge", async () => {
      const { resolveSandboxContext } = await import("../../src/sandbox/index.js");
      vi.mocked(resolveSandboxContext).mockResolvedValueOnce({
        enabled: true,
        sessionKey: "test-session",
        workspaceDir: "/tmp/workspace",
        workspaceAccess: "ro",
        containerName: "wopr-sbx-test",
        containerWorkdir: "/workspace",
        docker: {} as any,
        tools: {},
      });

      upstreamServer = await createEchoServer(upstreamSocketPath);
      const handle = await createMcpSocketBridge("test-session", upstreamSocketPath);

      expect(getMcpSocketBridge("test-session")).toBe(handle);

      handle.close();
    });
  });

  // ==========================================================================
  // getMcpBridgeMountArgs
  // ==========================================================================
  describe("getMcpBridgeMountArgs", () => {
    it("should return empty array for non-existent session", () => {
      expect(getMcpBridgeMountArgs("nonexistent")).toEqual([]);
    });

    it("should return Docker -v args for an active bridge", async () => {
      const { resolveSandboxContext } = await import("../../src/sandbox/index.js");
      vi.mocked(resolveSandboxContext).mockResolvedValueOnce({
        enabled: true,
        sessionKey: "test-session",
        workspaceDir: "/tmp/workspace",
        workspaceAccess: "ro",
        containerName: "wopr-sbx-test",
        containerWorkdir: "/workspace",
        docker: {} as any,
        tools: {},
      });

      upstreamServer = await createEchoServer(upstreamSocketPath);
      const handle = await createMcpSocketBridge("test-session", upstreamSocketPath);

      const args = getMcpBridgeMountArgs("test-session");
      expect(args).toHaveLength(2);
      expect(args[0]).toBe("-v");
      expect(args[1]).toContain(handle.hostDir);
      expect(args[1]).toContain("/run/wopr-mcp:ro");

      handle.close();
    });
  });

  // ==========================================================================
  // Data proxying
  // ==========================================================================
  describe("data proxying", () => {
    it("should proxy data bidirectionally between client and upstream", async () => {
      const { resolveSandboxContext } = await import("../../src/sandbox/index.js");
      vi.mocked(resolveSandboxContext).mockResolvedValueOnce({
        enabled: true,
        sessionKey: "test-session",
        workspaceDir: "/tmp/workspace",
        workspaceAccess: "ro",
        containerName: "wopr-sbx-test",
        containerWorkdir: "/workspace",
        docker: {} as any,
        tools: {},
      });

      // Create upstream echo server
      upstreamServer = await createEchoServer(upstreamSocketPath);

      const handle = await createMcpSocketBridge("test-session", upstreamSocketPath);

      // Connect to the bridge socket and send data
      const { connect } = await import("node:net");
      const response = await new Promise<string>((resolve, reject) => {
        const client = connect(handle.hostSocketPath, () => {
          client.write("hello MCP");
        });
        client.on("data", (data) => {
          resolve(data.toString());
          client.destroy();
        });
        client.on("error", reject);
        setTimeout(() => reject(new Error("timeout")), 5000);
      });

      expect(response).toBe("hello MCP");

      handle.close();
    });
  });
});
