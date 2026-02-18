/**
 * A2A (Agent-to-Agent) MCP Server
 *
 * Provides WOPR's built-in tools as an MCP server that the Claude Agent SDK
 * can use. Plugins can register additional tools via registerA2ATool().
 *
 * Tool definitions live in ./a2a-tools/ — this file is the thin orchestrator
 * that assembles the server from those modules.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import {
  cachedMcpServer,
  closeAllBrowsers,
  createBrowserTools,
  createCapabilityDiscoveryTools,
  createConfigTools,
  createEventTools,
  createHttpExecTools,
  createIdentityTools,
  createMemoryTools,
  createNotifyTools,
  createSecurityTools,
  createSessionTools,
  createWebSearchTools,
  mcpServerDirty,
  pluginTools,
  type RegisteredTool,
  registerA2ATool,
  setCachedServer,
  setSessionFunctions,
  type ToolContext,
  unregisterA2ATool,
} from "./a2a-tools/index.js";
import { config as centralConfig } from "./config.js";

// Re-export public API for consumers (sessions.ts, plugins.ts)
export {
  closeAllBrowsers,
  type RegisteredTool,
  registerA2ATool,
  setSessionFunctions,
  type ToolContext,
  unregisterA2ATool,
};

/**
 * List all registered tools (core + plugins)
 */
export function listA2ATools(): string[] {
  const coreTools = [
    "sessions_list",
    "sessions_send",
    "sessions_history",
    "sessions_spawn",
    "config_get",
    "config_set",
    "config_provider_defaults",
    "memory_read",
    "memory_write",
    "memory_search",
    "memory_get",
    "self_reflect",
    "identity_get",
    "identity_update",
    "cron_schedule",
    "cron_once",
    "cron_list",
    "cron_cancel",
    "cron_history",
    "event_emit",
    "event_list",
    "security_whoami",
    "security_check",
    "http_fetch",
    "exec_command",
    "notify",
    "web_search",
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_screenshot",
    "browser_evaluate",
    "capability_discover",
  ];
  return [...coreTools, ...pluginTools.keys()];
}

/**
 * Build or return cached MCP server.
 * The server is rebuilt when tools are registered/unregistered.
 */
export function getA2AMcpServer(sessionName: string): ReturnType<typeof createSdkMcpServer> {
  if (!mcpServerDirty && cachedMcpServer) {
    return cachedMcpServer as ReturnType<typeof createSdkMcpServer>;
  }

  logger.info(`[a2a-mcp] Building MCP server with ${pluginTools.size} plugin tools`);

  // biome-ignore lint/suspicious/noExplicitAny: SDK tool definitions have complex generic types
  const tools: any[] = [
    ...createSessionTools(sessionName),
    ...createConfigTools(sessionName),
    ...createMemoryTools(sessionName),
    ...createIdentityTools(sessionName),
    ...createEventTools(sessionName),
    ...createSecurityTools(sessionName),
    ...createHttpExecTools(sessionName),
    ...createNotifyTools(sessionName),
    ...createWebSearchTools(sessionName),
    ...createBrowserTools(sessionName),
    ...createCapabilityDiscoveryTools(sessionName),
  ];

  // Add plugin tools
  const makeContext = (): ToolContext => ({ sessionName });
  for (const [, pluginTool] of pluginTools) {
    tools.push(
      tool(pluginTool.name, pluginTool.description, pluginTool.schema.shape, async (args) => {
        const result = await pluginTool.handler(args, makeContext());
        if (typeof result === "string") {
          return { content: [{ type: "text", text: result }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }),
    );
  }

  const server = createSdkMcpServer({
    name: "wopr-a2a",
    version: "1.0.0",
    tools,
  });

  setCachedServer(server);
  return server;
}

/**
 * Check if A2A is enabled
 */
export function isA2AEnabled(): boolean {
  try {
    const cfg = centralConfig.get();
    return cfg.agents?.a2a?.enabled !== false;
  } catch {
    return true;
  }
}
