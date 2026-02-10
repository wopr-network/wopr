/**
 * Step 6b: Embeddings provider setup (conditional on memory-semantic plugin)
 */

import { getInstalledPlugins } from "../../../plugins.js";
import { confirm, note, pc, select, spinner, text } from "../prompts.js";
import type { OnboardContext, OnboardStep } from "../types.js";

const SEMANTIC_PLUGIN_NAME = "wopr-plugin-memory-semantic";

async function isOllamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function getOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export const embeddingsStep: OnboardStep = async (_ctx: OnboardContext) => {
  // Only show if the semantic memory plugin is installed
  const installed = getInstalledPlugins();
  const hasSemanticPlugin = installed.some((p) => p.name === SEMANTIC_PLUGIN_NAME || p.name === "memory-semantic");

  if (!hasSemanticPlugin) {
    return {};
  }

  const wantConfigure = await confirm({
    message: "Configure embedding provider for semantic memory?",
    initialValue: true,
  });

  if (!wantConfigure) {
    return {};
  }

  // Check which providers are available
  const hasOpenAiKey = !!process.env.OPENAI_API_KEY?.trim();
  const hasGoogleKey = !!(process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim());

  // Try Ollama at common locations
  const ollamaUrls = [process.env.OLLAMA_HOST, "http://ollama:11434", "http://localhost:11434"].filter(
    Boolean,
  ) as string[];

  let ollamaUrl: string | null = null;
  for (const url of ollamaUrls) {
    if (await isOllamaReachable(url)) {
      ollamaUrl = url;
      break;
    }
  }

  // Build provider choices
  type ProviderChoice = "ollama" | "openai" | "gemini" | "auto" | "skip";
  const options: Array<{ value: ProviderChoice; label: string; hint?: string }> = [];

  if (ollamaUrl) {
    options.push({
      value: "ollama",
      label: "Ollama (local GPU)",
      hint: `Running at ${ollamaUrl} — no API key, fast, free`,
    });
  } else {
    options.push({
      value: "ollama",
      label: "Ollama (not detected)",
      hint: "Local GPU embeddings — needs Ollama running",
    });
  }

  options.push({
    value: "openai",
    label: `OpenAI${hasOpenAiKey ? "" : " (no key found)"}`,
    hint: "Cloud — uses OPENAI_API_KEY",
  });

  options.push({
    value: "gemini",
    label: `Gemini${hasGoogleKey ? "" : " (no key found)"}`,
    hint: "Cloud — uses GOOGLE_API_KEY",
  });

  options.push({
    value: "auto",
    label: "Auto (try all in order)",
    hint: "OpenAI → Gemini → Ollama → local",
  });

  options.push({
    value: "skip",
    label: "Skip",
    hint: "Use default (auto)",
  });

  const provider = await select({
    message: "Which embedding provider?",
    options,
    initialValue: ollamaUrl ? ("ollama" as ProviderChoice) : ("auto" as ProviderChoice),
  });

  if (provider === "skip") {
    return {};
  }

  let selectedModel: string | undefined;
  let selectedOllamaUrl: string | undefined;

  if (provider === "ollama") {
    // Ollama-specific setup
    if (!ollamaUrl) {
      await note(
        [
          "Ollama is not reachable. To use Ollama embeddings:",
          "",
          "1. Add the ollama service to docker-compose.yml",
          "   (see the ollama service block in the compose file)",
          "",
          "2. Start it: docker compose up -d ollama",
          "",
          "3. Pull a model: docker exec ollama ollama pull qwen3-embedding:0.6b",
          "",
          "The onboard config will be saved. Ollama will be used once it's running.",
        ].join("\n"),
        "Ollama Setup",
      );

      // Let user specify the URL they'll use
      const customUrl = await text({
        message: "Ollama base URL (when running)",
        initialValue: "http://ollama:11434",
      });
      selectedOllamaUrl = customUrl;
      selectedModel = "qwen3-embedding:0.6b";
    } else {
      selectedOllamaUrl = ollamaUrl;

      // Discover available models
      const s = await spinner();
      s.start("Checking available models...");
      const models = await getOllamaModels(ollamaUrl);
      s.stop(models.length > 0 ? `Found ${models.length} models` : "No models found");

      // Filter embedding models (heuristic: name contains "embed")
      const embeddingModels = models.filter((m) => m.includes("embed") || m.includes("nomic") || m.includes("mxbai"));

      if (embeddingModels.length > 0) {
        const modelOptions = embeddingModels.map((m) => ({
          value: m,
          label: m,
        }));
        modelOptions.push({
          value: "__custom__",
          label: "Enter custom model name",
        });

        const chosen = await select({
          message: "Select embedding model",
          options: modelOptions,
        });

        if (chosen === "__custom__") {
          selectedModel = await text({
            message: "Model name (will be pulled if not present)",
            initialValue: "qwen3-embedding:0.6b",
          });
        } else {
          selectedModel = chosen;
        }
      } else {
        // No embedding models found — offer to use default
        const wantPull = await confirm({
          message: "No embedding models found. Use qwen3-embedding:0.6b (will be pulled)?",
          initialValue: true,
        });

        if (wantPull) {
          selectedModel = "qwen3-embedding:0.6b";
        } else {
          selectedModel = await text({
            message: "Model name",
            initialValue: "qwen3-embedding:0.6b",
          });
        }
      }
    }
  }

  await note(
    [
      `Provider: ${pc.cyan(provider)}`,
      selectedModel ? `Model: ${pc.cyan(selectedModel)}` : "",
      selectedOllamaUrl ? `Ollama URL: ${pc.cyan(selectedOllamaUrl)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    "Embeddings Config",
  );

  return {
    embeddings: {
      provider,
      model: selectedModel,
      ollamaBaseUrl: selectedOllamaUrl,
    },
  };
};
