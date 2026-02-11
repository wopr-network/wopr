/**
 * Agent-to-Agent (A2A) tool types for WOPR plugins.
 *
 * Plugins register A2A tools to expose functionality to other agents.
 * These tools follow the MCP (Model Context Protocol) pattern.
 */

/**
 * Result from an A2A tool handler.
 */
export interface A2AToolResult {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * Definition of an A2A tool that plugins can register.
 */
export interface A2AToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema format
  handler: (args: Record<string, unknown>) => Promise<A2AToolResult>;
}

/**
 * Configuration for registering an A2A server (collection of tools).
 */
export interface A2AServerConfig {
  name: string;
  version?: string;
  tools: A2AToolDefinition[];
}
