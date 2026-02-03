// OpenAI embedding provider - adapted from OpenClaw (removed OpenClaw config deps)
import type { EmbeddingProvider, EmbeddingProviderOptions } from "./embeddings.js";

export type OpenAiEmbeddingClient = {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
};

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export function normalizeOpenAiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_OPENAI_EMBEDDING_MODEL;
  }
  if (trimmed.startsWith("openai/")) {
    return trimmed.slice("openai/".length);
  }
  return trimmed;
}

export async function createOpenAiEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<{ provider: EmbeddingProvider; client: OpenAiEmbeddingClient }> {
  const client = await resolveOpenAiEmbeddingClient(options);
  const url = `${client.baseUrl.replace(/\/$/, "")}/embeddings`;

  const embed = async (input: string[]): Promise<number[][]> => {
    // Filter out empty/whitespace-only strings - OpenAI API rejects them
    const validInput = input.filter((s) => s && s.trim().length > 0);
    if (validInput.length === 0) {
      return input.map(() => []); // Return empty embeddings for all inputs
    }

    // Track which indices had valid input for result mapping
    const validIndices = input.map((s, i) => (s && s.trim().length > 0 ? i : -1)).filter((i) => i >= 0);

    const res = await fetch(url, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({ model: client.model, input: validInput }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`openai embeddings failed: ${res.status} ${text}`);
    }
    const payload = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const data = payload.data ?? [];
    const embeddings = data.map((entry) => entry.embedding ?? []);

    // Map embeddings back to original input positions
    const result: number[][] = input.map(() => []);
    for (let i = 0; i < validIndices.length; i++) {
      const originalIdx = validIndices[i];
      if (originalIdx !== undefined && originalIdx >= 0) {
        result[originalIdx] = embeddings[i] ?? [];
      }
    }
    return result;
  };

  return {
    provider: {
      id: "openai",
      model: client.model,
      embedQuery: async (text) => {
        const [vec] = await embed([text]);
        return vec ?? [];
      },
      embedBatch: embed,
    },
    client,
  };
}

export async function resolveOpenAiEmbeddingClient(
  options: EmbeddingProviderOptions,
): Promise<OpenAiEmbeddingClient> {
  const remote = options.remote;
  const remoteApiKey = remote?.apiKey?.trim();
  const remoteBaseUrl = remote?.baseUrl?.trim();

  // Get API key from remote config, environment, or throw
  const apiKey = remoteApiKey || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("No API key found for provider openai. Set OPENAI_API_KEY environment variable.");
  }

  const baseUrl = remoteBaseUrl || DEFAULT_OPENAI_BASE_URL;
  const headerOverrides = remote?.headers ?? {};
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...headerOverrides,
  };
  const model = normalizeOpenAiModel(options.model);
  return { baseUrl, headers, model };
}
