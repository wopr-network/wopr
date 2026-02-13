/**
 * Shared types for web search providers.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, count: number): Promise<WebSearchResult[]>;
}

export interface WebSearchProviderConfig {
  apiKey: string;
  /** Provider-specific extra config (e.g., Google CX ID) */
  extra?: Record<string, string>;
}
