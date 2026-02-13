/**
 * Google Custom Search provider.
 *
 * Requires:
 *   - API key (GOOGLE_SEARCH_API_KEY or config)
 *   - Custom Search Engine ID (GOOGLE_SEARCH_CX or config)
 *
 * Docs: https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list
 */

import type { WebSearchProvider, WebSearchProviderConfig, WebSearchResult } from "./types.js";

const GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1";

export class GoogleSearchProvider implements WebSearchProvider {
  readonly name = "google";
  private readonly apiKey: string;
  private readonly cx: string;

  constructor(cfg: WebSearchProviderConfig) {
    this.apiKey = cfg.apiKey;
    this.cx = cfg.extra?.cx ?? "";
    if (!this.cx) {
      throw new Error("Google Search provider requires 'cx' (Custom Search Engine ID) in extra config");
    }
  }

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const num = Math.min(count, 10); // Google CSE max is 10 per request
    const url = new URL(GOOGLE_CSE_URL);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("cx", this.cx);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(num));

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Google Search API returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      items?: Array<{ title?: string; link?: string; snippet?: string }>;
    };

    return (data.items ?? []).map((item) => ({
      title: item.title ?? "",
      url: item.link ?? "",
      snippet: item.snippet ?? "",
    }));
  }
}
