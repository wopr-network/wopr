/**
 * Web Search A2A tool: web_search
 *
 * Multi-provider web search with fallback chain, rate limiting, and SSRF protection.
 */

import { centralConfig, logger, tool, withSecurityCheck, z } from "./_base.js";
import {
  BraveSearchProvider,
  GoogleSearchProvider,
  XaiSearchProvider,
  type WebSearchProvider,
  type WebSearchResult,
} from "./web-search-providers/index.js";

// ---------------------------------------------------------------------------
// SSRF protection — block private/internal IP ranges in result URLs
// ---------------------------------------------------------------------------

const PRIVATE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
  "metadata.google.internal",
  "169.254.169.254",
]);

const PRIVATE_CIDR_PREFIXES = [
  "10.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
  "0.",
  "100.64.",
  "198.18.",
  "198.19.",
];

function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    if (PRIVATE_HOSTS.has(hostname)) return true;
    if (PRIVATE_CIDR_PREFIXES.some((prefix) => hostname.startsWith(prefix))) return true;
    // Block non-http(s) schemes
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;

    return false;
  } catch {
    // Malformed URL — block it
    return true;
  }
}

function filterResults(results: WebSearchResult[]): WebSearchResult[] {
  return results.filter((r) => !isPrivateUrl(r.url));
}

// ---------------------------------------------------------------------------
// Per-provider rate limiter (token bucket)
// ---------------------------------------------------------------------------

interface RateBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per second
}

const rateBuckets = new Map<string, RateBucket>();

function getRateBucket(provider: string): RateBucket {
  let bucket = rateBuckets.get(provider);
  if (!bucket) {
    // Default: 10 requests per second, burst of 10
    bucket = { tokens: 10, lastRefill: Date.now(), maxTokens: 10, refillRate: 10 };
    rateBuckets.set(provider, bucket);
  }
  return bucket;
}

function consumeToken(provider: string): boolean {
  const bucket = getRateBucket(provider);
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

type ProviderName = "google" | "brave" | "xai";

function buildProvider(name: ProviderName): WebSearchProvider | null {
  const cfg = centralConfig.get();
  const searchCfg = cfg.webSearch;

  switch (name) {
    case "google": {
      const apiKey = process.env.GOOGLE_SEARCH_API_KEY ?? searchCfg?.providers?.google?.apiKey;
      const cx = process.env.GOOGLE_SEARCH_CX ?? searchCfg?.providers?.google?.cx;
      if (!apiKey || !cx) return null;
      return new GoogleSearchProvider({ apiKey, extra: { cx } });
    }
    case "brave": {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY ?? searchCfg?.providers?.brave?.apiKey;
      if (!apiKey) return null;
      return new BraveSearchProvider({ apiKey });
    }
    case "xai": {
      const apiKey = process.env.XAI_API_KEY ?? searchCfg?.providers?.xai?.apiKey;
      if (!apiKey) return null;
      return new XaiSearchProvider({ apiKey });
    }
    default:
      return null;
  }
}

const DEFAULT_PROVIDER_ORDER: ProviderName[] = ["google", "brave", "xai"];

function getProviderOrder(): ProviderName[] {
  const cfg = centralConfig.get();
  const order = cfg.webSearch?.providerOrder;
  if (Array.isArray(order) && order.length > 0) {
    return order.filter((n): n is ProviderName => ["google", "brave", "xai"].includes(n));
  }
  return DEFAULT_PROVIDER_ORDER;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createWebSearchTools(sessionName: string): any[] {
  const tools: any[] = [];

  tools.push(
    tool(
      "web_search",
      "Search the web using configured providers (Google, Brave, xAI/Grok). Returns structured results with title, URL, and snippet. Providers are tried in order with automatic fallback.",
      {
        query: z.string().describe("Search query string"),
        count: z.number().optional().describe("Number of results to return (default: 5, max: 20)"),
        provider: z
          .string()
          .optional()
          .describe("Force a specific provider: google, brave, xai. Omit for auto fallback chain."),
      },
      async (args: any) => {
        return withSecurityCheck("web_search", sessionName, async () => {
          const { query, count: rawCount, provider: forcedProvider } = args;
          const count = Math.max(1, Math.min(rawCount ?? 5, 20));

          // Determine provider order
          const order: ProviderName[] = forcedProvider
            ? [forcedProvider as ProviderName]
            : getProviderOrder();

          const errors: string[] = [];

          for (const providerName of order) {
            const providerInstance = buildProvider(providerName);
            if (!providerInstance) {
              errors.push(`${providerName}: not configured`);
              continue;
            }

            if (!consumeToken(providerName)) {
              errors.push(`${providerName}: rate limited`);
              continue;
            }

            try {
              logger.info(`[web_search] Querying ${providerName} for: ${query}`);
              const raw = await providerInstance.search(query, count);
              const results = filterResults(raw);

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        provider: providerName,
                        query,
                        resultCount: results.length,
                        results,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            } catch (err: any) {
              const msg = err?.message ?? String(err);
              logger.warn(`[web_search] ${providerName} failed: ${msg}`);
              errors.push(`${providerName}: ${msg}`);
            }
          }

          // All providers failed
          return {
            content: [
              {
                type: "text",
                text: `All search providers failed:\n${errors.map((e) => `  - ${e}`).join("\n")}\n\nConfigure at least one provider via environment variables or config:\n  GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX\n  BRAVE_SEARCH_API_KEY\n  XAI_API_KEY`,
              },
            ],
            isError: true,
          };
        });
      },
    ),
  );

  return tools;
}
