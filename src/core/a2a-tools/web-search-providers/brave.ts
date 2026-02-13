/**
 * Brave Search provider.
 *
 * Requires:
 *   - API key (BRAVE_SEARCH_API_KEY or config)
 *
 * Docs: https://api.search.brave.com/app/documentation/web-search/get-started
 */

import type { WebSearchProvider, WebSearchProviderConfig, WebSearchResult } from "./types.js";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export class BraveSearchProvider implements WebSearchProvider {
  readonly name = "brave";
  private readonly apiKey: string;

  constructor(cfg: WebSearchProviderConfig) {
    this.apiKey = cfg.apiKey;
  }

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const num = Math.min(count, 20); // Brave max is 20 per request
    const url = new URL(BRAVE_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(num));

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Brave Search API returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };

    return (data.web?.results ?? []).map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: item.description ?? "",
    }));
  }
}
