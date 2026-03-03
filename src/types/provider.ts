/**
 * Multi-Provider Architecture for WOPR
 *
 * Defines the abstraction layer for pluggable model providers.
 * Supports fallback chains, per-session provider selection, and
 * standardized credential management.
 */

// Plugin-facing provider types live in plugin-types — re-export them here
// so core modules can continue to import from this path unchanged.
import type { ModelClient, ModelProvider } from "../plugin-types/provider.js";

export type {
  ModelClient,
  ModelProvider,
  ModelQueryOptions,
  ModelResponse,
  Tool,
  ToolCall,
  ToolResult,
} from "../plugin-types/provider.js";

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
 * Response from a provider call.
 */
export interface ProviderResponse<T = unknown> {
  /** The actual response from the provider */
  result: T;
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
    expiresAt?: number; // For OAuth tokens
    refreshToken?: string; // For OAuth flows
    region?: string; // For region-specific providers
    customKey?: string; // For custom credentials
    [key: string]: unknown;
  };

  /** When this credential was added */
  createdAt: number;

  /** When this credential expires (if applicable) */
  expiresAt?: number;
}

/**
 * Provider registration entry
 * Used internally by the registry
 */
export interface ProviderRegistration {
  provider: ModelProvider;
  available: boolean; // Can we use this provider?
  lastChecked: number; // When we last checked availability
  error?: string; // Error message if not available
}

/**
 * Result of provider resolution with fallback
 */
export interface ResolvedProvider {
  name: string;
  provider: ModelProvider;
  client: ModelClient;
  credential: string;
  fallbackChain: string[]; // Remaining fallbacks
}
