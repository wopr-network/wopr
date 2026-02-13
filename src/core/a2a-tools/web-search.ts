/**
 * Web Search A2A tool: web_search
 *
 * Multi-provider web search with fallback chain, rate limiting, and SSRF protection.
 */

import { centralConfig, logger, tool, withSecurityCheck, z } from "./_base.js";
import {
  BraveSearchProvider,
  GoogleSearchProvider,
  type WebSearchProvider,
  type WebSearchResult,
  XaiSearchProvider,
} from "./web-search-providers/index.js";

// ---------------------------------------------------------------------------
// SSRF protection — block private/internal IP ranges in result URLs
// ---------------------------------------------------------------------------

const PRIVATE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
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

/**
 * Extract the IPv4 octets from an IPv6-mapped IPv4 address.
 * URL.hostname normalises `::ffff:A.B.C.D` to `[::ffff:XXYY:ZZWW]` (hex pairs).
 * Returns the IPv4 dotted-quad string, or null if not a mapped address.
 */
function extractMappedIPv4(hostname: string): string | null {
  // URL.hostname keeps brackets for IPv6: "[::ffff:7f00:1]"
  // Strip brackets then match the ::ffff: prefix
  const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(bare);
  if (match) {
    const hi = parseInt(match[1], 16);
    const lo = parseInt(match[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  // Also handle the rare case where the URL parser keeps dotted-quad form
  const dottedMatch = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (dottedMatch) {
    return dottedMatch[1];
  }
  return null;
}

/**
 * Detect numeric IP encodings (decimal, octal, hex) that resolve to private addresses.
 * Browsers and curl interpret these, so they can bypass naive hostname checks.
 */
function isNumericPrivateIp(hostname: string): boolean {
  // Decimal integer IP (e.g. 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    const num = Number(hostname);
    if (num >= 0 && num <= 0xffffffff) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      // Check common private ranges
      if (a === 127) return true; // 127.0.0.0/8
      if (a === 10) return true; // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 192.168.0.0/16
      if (a === 169 && b === 254) return true; // 169.254.0.0/16
      if (a === 0) return true; // 0.0.0.0/8
      if (a === 100 && b === 64) return true; // 100.64.0.0/10 (approximate)
      if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
    }
  }
  // Hex IP (e.g. 0x7f000001 = 127.0.0.1)
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const num = Number(hostname);
    if (!Number.isNaN(num) && num >= 0 && num <= 0xffffffff) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      if (a === 127) return true;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
    }
  }
  return false;
}

export function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    // Block non-http(s) schemes
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;

    // Strip IPv6 brackets for comparison (URL.hostname keeps them: "[::1]")
    const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;

    if (PRIVATE_HOSTS.has(hostname) || PRIVATE_HOSTS.has(bare)) return true;
    if (PRIVATE_CIDR_PREFIXES.some((prefix) => hostname.startsWith(prefix))) return true;

    // IPv6-mapped IPv4 addresses (e.g. [::ffff:7f00:1] from ::ffff:127.0.0.1)
    const mappedIpv4 = extractMappedIPv4(hostname);
    if (mappedIpv4) {
      if (PRIVATE_HOSTS.has(mappedIpv4)) return true;
      if (PRIVATE_CIDR_PREFIXES.some((prefix) => mappedIpv4.startsWith(prefix))) return true;
    }

    // Numeric IP encodings (decimal, hex)
    if (isNumericPrivateIp(hostname)) return true;

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
          const order: ProviderName[] = forcedProvider ? [forcedProvider as ProviderName] : getProviderOrder();

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
              logger.debug(`[web_search] Querying ${providerName} for: ${query}`);
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
