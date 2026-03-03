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
 * A single chunk yielded by a streaming A2A tool handler.
 * Chunks are accumulated by the caller into a final A2AToolResult.
 */
export interface ToolResultChunk {
  /** Partial text content for this chunk */
  text: string;
  /** If true, this chunk signals an error condition */
  isError?: boolean;
}

/**
 * Definition of an A2A tool that plugins can register.
 *
 * Handlers may return either a plain Promise<A2AToolResult> (non-streaming)
 * or an AsyncIterable<ToolResultChunk> for streaming responses. Callers
 * accumulate streaming chunks into a single result.
 */
export interface A2AToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema format
  handler: (args: Record<string, unknown>) => Promise<A2AToolResult> | AsyncIterable<ToolResultChunk>;
}

/**
 * Configuration for registering an A2A server (collection of tools).
 */
export interface A2AServerConfig {
  name: string;
  version?: string;
  tools: A2AToolDefinition[];
}

/**
 * Declares a tool dependency that this plugin needs from another plugin's A2A server.
 */
export interface A2AToolDependency {
  /** Tool name to depend on (e.g., "search", "translate") */
  toolName: string;
  /** Source plugin name to disambiguate when multiple plugins expose same tool name */
  pluginName?: string;
  /** If true, missing tool logs a warning; if false/absent, missing tool logs an error */
  optional?: boolean;
}
