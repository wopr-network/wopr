/**
 * Plugin A2A Tool Security Tests (WOP-919)
 *
 * Verifies that plugin-registered tools go through withSecurityCheck
 * the same way core tools do.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the claude-agent-sdk to avoid real MCP server creation
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: vi.fn(() => ({ tools: [] })),
  tool: vi.fn(
    (name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => ({
      name,
      handler,
    }),
  ),
}));

const { getStorage, resetStorage } = await import("../../src/storage/index.js");
const { initSecurity, saveSecurityConfig } = await import("../../src/security/policy.js");
const { storeContext, clearContext, SecurityContext } = await import("../../src/security/context.js");
const { createInjectionSource, DEFAULT_SECURITY_CONFIG } = await import("../../src/security/types.js");
const { registerA2ATool, unregisterA2ATool, pluginTools, markDirty } = await import(
  "../../src/core/a2a-tools/_base.js"
);
const { getA2AMcpServer } = await import("../../src/core/a2a-mcp.js");
const { tool: mockTool } = await import("@anthropic-ai/claude-agent-sdk");

import { z } from "zod";
import type { SecurityConfig } from "../../src/security/types.js";

let testDir: string;

async function setSecurityConfig(config: Partial<SecurityConfig>): Promise<void> {
  const full = { ...DEFAULT_SECURITY_CONFIG, ...config };
  await saveSecurityConfig(full);
}

describe("Plugin A2A Tool Security (WOP-919)", () => {
  beforeEach(async () => {
    testDir = join(tmpdir(), `wopr-test-${randomBytes(8).toString("hex")}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    resetStorage();
    getStorage(join(testDir, "test.sqlite"));
    await initSecurity(testDir);
    // Clear any leftover plugin tools
    pluginTools.clear();
    // Force server rebuild each test
    markDirty();
    // Reset mock call history
    vi.mocked(mockTool).mockClear();
  });

  afterEach(() => {
    pluginTools.clear();
    clearContext("test-session");
    clearContext("no-context-session");
  });

  it("should deny plugin tool when session lacks required capability", async () => {
    // Set up enforcement
    await setSecurityConfig({ enforcement: "enforce" });

    // Create a security context for an untrusted source (no inject.network capability)
    const source = createInjectionSource("p2p", { trustLevel: "untrusted" });
    const ctx = new SecurityContext(source, "test-session");
    storeContext(ctx);

    // Register a fake plugin tool named http_fetch (maps to inject.network in TOOL_CAPABILITY_MAP)
    const handler = vi.fn().mockResolvedValue("fetched");
    registerA2ATool({
      name: "http_fetch",
      description: "Test HTTP fetch",
      schema: z.object({ url: z.string() }),
      handler,
    });

    // Build the MCP server — this wraps plugin tools with withSecurityCheck
    getA2AMcpServer("test-session");

    // The mock `tool` function captured the wrapped handler
    const toolCalls = vi.mocked(mockTool).mock.calls;
    const httpFetchCall = toolCalls.find(
      (call) => call[0] === "http_fetch",
    );
    expect(httpFetchCall).toBeDefined();

    // Call the wrapped handler
    const wrappedHandler = httpFetchCall![3] as (args: Record<string, unknown>) => Promise<unknown>;
    const result = await wrappedHandler({ url: "https://example.com" });

    // Should be denied — untrusted has no inject.network capability
    expect(result).toEqual({
      content: [{ type: "text", text: expect.stringContaining("Access denied") }],
      isError: true,
    });

    // Plugin handler should NOT have been called
    expect(handler).not.toHaveBeenCalled();
  });

  it("should allow plugin tool when session has required capability", async () => {
    await setSecurityConfig({ enforcement: "enforce" });

    // Owner has all capabilities including inject.network
    const source = createInjectionSource("cli", { trustLevel: "owner" });
    const ctx = new SecurityContext(source, "test-session");
    storeContext(ctx);

    const handler = vi.fn().mockResolvedValue("fetched OK");
    registerA2ATool({
      name: "http_fetch",
      description: "Test HTTP fetch",
      schema: z.object({ url: z.string() }),
      handler,
    });

    getA2AMcpServer("test-session");

    const toolCalls = vi.mocked(mockTool).mock.calls;
    const httpFetchCall = toolCalls.find(
      (call) => call[0] === "http_fetch",
    );
    const wrappedHandler = httpFetchCall![3] as (args: Record<string, unknown>) => Promise<unknown>;
    const result = await wrappedHandler({ url: "https://example.com" });

    // Should pass through — owner has inject.network
    expect(result).toEqual({
      content: [{ type: "text", text: "fetched OK" }],
    });
    expect(handler).toHaveBeenCalled();
  });

  it("should allow plugin tool with no TOOL_CAPABILITY_MAP entry (backward-compat)", async () => {
    await setSecurityConfig({ enforcement: "enforce" });

    // semi-trusted can use general tools (no capability mapping = no requirement)
    const source = createInjectionSource("api", { trustLevel: "semi-trusted" });
    const ctx = new SecurityContext(source, "test-session");
    storeContext(ctx);

    const handler = vi.fn().mockResolvedValue({ status: "ok" });
    registerA2ATool({
      name: "my_custom_plugin_tool",
      description: "A plugin tool with no TOOL_CAPABILITY_MAP entry",
      schema: z.object({ input: z.string() }),
      handler,
    });

    getA2AMcpServer("test-session");

    const toolCalls = vi.mocked(mockTool).mock.calls;
    const customCall = toolCalls.find(
      (call) => call[0] === "my_custom_plugin_tool",
    );
    const wrappedHandler = customCall![3] as (args: Record<string, unknown>) => Promise<unknown>;
    const result = await wrappedHandler({ input: "hello" });

    // Should pass — no capability requirement for unknown tools
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ status: "ok" }, null, 2) }],
    });
    expect(handler).toHaveBeenCalled();
  });

  it("should deny exec_command for untrusted sessions", async () => {
    await setSecurityConfig({ enforcement: "enforce" });

    // untrusted has tools: { deny: ["*"] } which denies all tools including exec_command
    const source = createInjectionSource("p2p", { trustLevel: "untrusted" });
    const ctx = new SecurityContext(source, "test-session");
    storeContext(ctx);

    const handler = vi.fn().mockResolvedValue("executed");
    registerA2ATool({
      name: "exec_command",
      description: "Test exec",
      schema: z.object({ command: z.string() }),
      handler,
    });

    getA2AMcpServer("test-session");

    const toolCalls = vi.mocked(mockTool).mock.calls;
    const execCall = toolCalls.find(
      (call) => call[0] === "exec_command",
    );
    const wrappedHandler = execCall![3] as (args: Record<string, unknown>) => Promise<unknown>;
    const result = await wrappedHandler({ command: "ls" });

    expect(result).toEqual({
      content: [{ type: "text", text: expect.stringContaining("Access denied") }],
      isError: true,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("should pass through when no security context exists for session", async () => {
    await setSecurityConfig({ enforcement: "enforce" });

    // Do NOT store a security context — simulates owner CLI sessions
    const handler = vi.fn().mockResolvedValue("result");
    registerA2ATool({
      name: "http_fetch",
      description: "Test",
      schema: z.object({ url: z.string() }),
      handler,
    });

    getA2AMcpServer("no-context-session");

    const toolCalls = vi.mocked(mockTool).mock.calls;
    const httpFetchCall = toolCalls.find(
      (call) => call[0] === "http_fetch",
    );
    const wrappedHandler = httpFetchCall![3] as (args: Record<string, unknown>) => Promise<unknown>;
    const result = await wrappedHandler({ url: "https://example.com" });

    // Should pass — no context means no enforcement
    expect(result).toEqual({
      content: [{ type: "text", text: "result" }],
    });
    expect(handler).toHaveBeenCalled();
  });
});
