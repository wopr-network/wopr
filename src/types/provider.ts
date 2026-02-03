/**
 * Multi-Provider Architecture for WOPR
 *
 * Defines the abstraction layer for pluggable model providers.
 * Supports fallback chains, per-session provider selection, and
 * standardized credential management.
 */

/**
 * Provider configuration for a session
 * Specifies which provider to use and fallback chain
 */
export interface ProviderConfig {
  /** Primary provider name: "anthropic" | "openai" | "kilo" | custom */
  name: string;

  /** Optional model override for this session */
  model?: string;

  /** Fallback providers if primary fails: ["openai", "anthropic"] */
  fallback?: string[];

  /** Provider-specific options (e.g., temperature, top_p) */
  options?: Record<string, unknown>;
}

/**
 * Credentials for a provider
 * Different providers use different credential types
 */
export interface ProviderCredentials {
  /** Provider ID */
  providerId: string;

  /** Credential type: "api-key" | "oauth" | "custom" */
  type: "api-key" | "oauth" | "custom";

  /** The actual credential (API key, token, etc.) */
  credential: string;

  /** Additional provider-specific data */
  metadata?: {
    expiresAt?: number;           // For OAuth tokens
    refreshToken?: string;        // For OAuth flows
    region?: string;              // For region-specific providers
    customKey?: string;           // For custom credentials
    [key: string]: unknown;
  };

  /** When this credential was added */
  createdAt: number;

  /** When this credential expires (if applicable) */
  expiresAt?: number;
}

/**
 * Tool definition for AI function calling
 */
export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * Tool call from AI
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
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
  mcpServers?: Record<string, any>;

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
  query(options: ModelQueryOptions): AsyncGenerator<any>;

  /**
   * List available models from this provider
   */
  listModels(): Promise<string[]>;

  /**
   * Health check - verify provider is accessible
   */
  healthCheck(): Promise<boolean>;

  // =========================================================================
  // V2 Session API - Optional methods for active session injection
  //
  // When supported, allows sending messages into an already-streaming session.
  // Implementations that support this API are responsible for:
  //   1) Tracking which sessions are active using the provided `sessionKey`
  //   2) Deciding whether to inject into an existing session or start a new one
  //   3) Managing the lifecycle (creation, reuse, and closure) of these sessions
  //
  // The interface does not enforce any particular session storage or strategy.
  //
  // These methods are part of the public V2 contract for providers that
  // support long-lived / multiplexed streaming sessions. The core
  // orchestration currently only relies on `queryV2` for session-aware
  // requests; the helper methods below are intended for provider
  // implementations and external consumers (like Discord plugin) that need
  // finer-grained control over active sessions.
  //
  // Implementers MAY choose not to support these if their underlying
  // transport does not expose session handles; in that case the methods
  // should simply be omitted.
  // =========================================================================

  /**
   * V2: Execute a query with session key tracking.
   *
   * If a session for the given sessionKey is already active, providers
   * SHOULD inject the message into that session instead of creating a new
   * stream. If no session exists, a new streaming session MAY be created
   * and associated with this sessionKey.
   *
   * Note: `sessionKey` is WOPR's session identifier used for tracking active
   * V2 streaming sessions (e.g., mapping to an in-progress conversation).
   * If the underlying provider has its own notion of resumable conversations,
   * use the `resume` field from `ModelQueryOptions` to pass the provider-
   * specific session/conversation ID, and use `sessionKey` only for mapping
   * back to WOPR's active session tracking.
   *
   * This is the only V2 method currently invoked by the core orchestration;
   * the remaining V2 methods are available for plugin integrations.
   *
   * @param options Query options combining `ModelQueryOptions` (including any
   *   `resume` provider session ID) with a WOPR-level `sessionKey` for V2
   *   active session tracking.
   */
  queryV2?(options: ModelQueryOptions & { sessionKey: string }): AsyncGenerator<any>;

  /**
   * V2: Check if there's an active streaming session for this key.
   *
   * This is not called by the core orchestration, but is used by plugins
   * (e.g., Discord) to check if they should inject into an existing session
   * vs queue a new message.
   */
  hasActiveSession?(sessionKey: string): boolean;

  /**
   * V2: Send a message to an active session (inject into running conversation).
   *
   * This is intended for plugins that want to push additional input into an
   * existing streaming interaction without going through the full query flow.
   * The injected message will be processed by the active session's stream.
   */
  sendToActiveSession?(sessionKey: string, message: string): Promise<void>;

  /**
   * V2: Get the stream generator for an active session.
   *
   * If the sessionKey is unknown or the session has completed, implementations
   * SHOULD return null.
   */
  getActiveSessionStream?(sessionKey: string): AsyncGenerator<any> | null;

  /**
   * V2: Close an active session.
   *
   * This allows external consumers to explicitly tear down server-side or
   * long-lived streaming sessions and release any associated resources.
   * The core orchestration does not currently invoke this directly, but
   * providers SHOULD implement it when they maintain internal session
   * state that may otherwise outlive the caller.
   */
  closeSession?(sessionKey: string): void;
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

/**
 * Provider registration entry
 * Used internally by the registry
 */
export interface ProviderRegistration {
  provider: ModelProvider;
  available: boolean;           // Can we use this provider?
  lastChecked: number;          // When we last checked availability
  error?: string;               // Error message if not available
}

/**
 * Result of provider resolution with fallback
 */
export interface ResolvedProvider {
  name: string;
  provider: ModelProvider;
  client: ModelClient;
  credential: string;
  fallbackChain: string[];      // Remaining fallbacks
}
