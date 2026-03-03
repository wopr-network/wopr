/**
 * Provider interface types — part of the plugin-facing API.
 *
 * These types define the abstraction for model providers that plugins
 * can register and consume via WOPRPluginContext.
 */

/**
 * Tool definition for AI function calling
 */
export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool call from AI
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result to return to AI
 */
export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Request options for model queries
 * Normalized across all providers
 */
export interface ModelQueryOptions {
  /** The prompt/message to send */
  prompt: string;

  /** System prompt/context */
  systemPrompt?: string;

  /** For resuming existing sessions */
  resume?: string;

  /** Model name override */
  model?: string;

  /** Temperature for generation (0-2)*/
  temperature?: number;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Top-p sampling */
  topP?: number;

  /** Image URLs for vision models */
  images?: string[];

  /** Tools for AI function calling (A2A, etc.) */
  tools?: Tool[];

  /** MCP servers for tool execution (A2A, skills, etc.) */
  mcpServers?: Record<string, unknown>;

  /** Provider-specific options */
  providerOptions?: Record<string, unknown>;
}

/**
 * Response from a model provider
 * Normalized across all providers
 */
export interface ModelResponse {
  /** The generated text */
  content: string;

  /** Which provider generated this */
  provider: string;

  /** Which model was used */
  model: string;

  /** Tokens used (if provider reports it) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };

  /** Session ID for resuming (if provider supports it) */
  sessionId?: string;

  /** Stop reason (if reported) */
  stopReason?: string;

  /** Raw provider response (for debugging) */
  raw?: unknown;
}

/**
 * Client interface for interacting with a provider
 *
 * Note: query() returns an async generator for streaming support.
 * Agent SDKs (Claude Agent SDK, Codex SDK) naturally return generators
 * for streaming results as they become available.
 */
export interface ModelClient {
  /**
   * Execute a query against the model
   * Returns an async generator that yields streaming results
   */
  query(options: ModelQueryOptions): AsyncGenerator<unknown>;

  /**
   * List available models from this provider
   */
  listModels(): Promise<string[]>;

  /**
   * Health check - verify provider is accessible
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Provider implementation interface
 * Each provider (Anthropic, OpenAI, etc.) implements this
 */
export interface ModelProvider {
  /** Unique ID: "anthropic" | "openai" | "kilo" */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of provider */
  description: string;

  /** Default model for this provider */
  defaultModel: string;

  /** Supported models */
  supportedModels: string[];

  /**
   * Validate that credentials are valid
   * Used before attempting to use provider
   */
  validateCredentials(credentials: string): Promise<boolean>;

  /**
   * Create a client instance with given credentials
   * @param credential The credential (API key, token, etc.)
   * @param options Optional provider-specific options
   */
  createClient(credential: string, options?: Record<string, unknown>): Promise<ModelClient>;

  /**
   * Get the credential type this provider expects
   */
  getCredentialType(): "api-key" | "oauth" | "custom";

  /**
   * Optional: Get OAuth configuration if provider supports it
   */
  getOAuthConfig?(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authUrl: string;
    tokenUrl: string;
  } | null;
}
