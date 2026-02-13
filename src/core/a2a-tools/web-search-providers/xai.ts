/**
 * Grok/xAI search provider.
 *
 * Uses the xAI API with grounding (web search) capability.
 *
 * Requires:
 *   - API key (XAI_API_KEY or config)
 *
 * Docs: https://docs.x.ai/docs
 */

import type { WebSearchProvider, WebSearchProviderConfig, WebSearchResult } from "./types.js";

const XAI_API_URL = "https://api.x.ai/v1/chat/completions";

export class XaiSearchProvider implements WebSearchProvider {
  readonly name = "xai";
  private readonly apiKey: string;

  constructor(cfg: WebSearchProviderConfig) {
    this.apiKey = cfg.apiKey;
  }

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const response = await fetch(XAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-3",
        messages: [
          {
            role: "user",
            content: `Search the web for: ${query}\n\nReturn ONLY a JSON array of the top ${Math.min(count, 10)} results. Each element must be: {"title":"...","url":"...","snippet":"..."}. No other text.`,
          },
        ],
        search_parameters: {
          mode: "auto",
          max_search_results: Math.min(count, 10),
          return_citations: true,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`xAI API returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      citations?: Array<{ url?: string; title?: string }>;
    };

    // Prefer structured citations if available
    if (data.citations && data.citations.length > 0) {
      return data.citations.slice(0, count).map((c) => ({
        title: c.title ?? "",
        url: c.url ?? "",
        snippet: "",
      }));
    }

    // Fall back to parsing the model's text response
    const content = data.choices?.[0]?.message?.content ?? "[]";
    try {
      // Extract JSON array from response (may be wrapped in markdown code block)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        title?: string;
        url?: string;
        snippet?: string;
      }>;
      return parsed.slice(0, count).map((item) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.snippet ?? "",
      }));
    } catch {
      return [];
    }
  }
}
