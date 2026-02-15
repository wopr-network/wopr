/**
 * Image generation tool: image_generate
 *
 * Multi-provider image generation with configurable parameters.
 * Saves generated images to WOPR_HOME/attachments/generated/.
 */

import { randomUUID } from "node:crypto";
import { centralConfig, join, logger, mkdirSync, tool, WOPR_HOME, withSecurityCheck, z } from "./_base.js";
import { OpenAIDalleProvider } from "./image-providers/openai-dalle.js";

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

export interface ImageGenerationRequest {
  prompt: string;
  size?: string;
  quality?: string;
  style?: string;
}

export interface ImageGenerationResult {
  filePath: string;
  sizeBytes: number;
  revisedPrompt?: string;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generate(request: ImageGenerationRequest, outputPath: string): Promise<ImageGenerationResult>;
}

// ---------------------------------------------------------------------------
// Output directory
// ---------------------------------------------------------------------------

const GENERATED_DIR = join(WOPR_HOME, "attachments", "generated");

function ensureOutputDir(): void {
  mkdirSync(GENERATED_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function getProvider(): ImageGenerationProvider {
  const cfg = centralConfig.get();
  const toolsCfg = cfg.tools?.imageGeneration;

  const providerName = toolsCfg?.provider ?? "openai-dalle";
  const apiKey =
    toolsCfg?.apiKey ?? process.env.OPENAI_API_KEY ?? (cfg.providers?.openai?.options?.apiKey as string | undefined);

  if (providerName === "openai-dalle") {
    if (!apiKey) {
      throw new Error(
        "OpenAI API key not configured. Set tools.imageGeneration.apiKey in config, " +
          "or set the OPENAI_API_KEY environment variable.",
      );
    }
    return new OpenAIDalleProvider(apiKey);
  }

  throw new Error(`Unknown image generation provider: ${providerName}. Supported: openai-dalle`);
}

// ---------------------------------------------------------------------------
// A2A tool factory
// ---------------------------------------------------------------------------

export function createImageGenerateTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  tools.push(
    tool(
      "image_generate",
      "Generate an image from a text prompt using AI (DALL-E). Returns the file path of the generated image.",
      {
        prompt: z.string().describe("Text description of the image to generate"),
        size: z
          .enum(["256", "512", "1024"])
          .optional()
          .describe("Image size in pixels (256, 512, or 1024). Default: 1024"),
        quality: z.enum(["standard", "hd"]).optional().describe("Image quality: standard or hd. Default: standard"),
        style: z.enum(["natural", "vivid"]).optional().describe("Image style: natural or vivid. Default: natural"),
      },
      async (args: {
        prompt: string;
        size?: "256" | "512" | "1024";
        quality?: "standard" | "hd";
        style?: "natural" | "vivid";
      }) => {
        return withSecurityCheck("image_generate", sessionName, async () => {
          const { prompt, size, quality, style } = args;

          if (!prompt || prompt.trim().length === 0) {
            return {
              content: [{ type: "text", text: "Error: prompt cannot be empty" }],
              isError: true,
            };
          }

          try {
            ensureOutputDir();

            const provider = getProvider();
            const filename = `${randomUUID()}.png`;
            const outputPath = join(GENERATED_DIR, filename);

            const result = await provider.generate({ prompt, size, quality, style }, outputPath);

            const response: Record<string, unknown> = {
              filePath: result.filePath,
              sizeBytes: result.sizeBytes,
              provider: provider.name,
            };
            if (result.revisedPrompt) {
              response.revisedPrompt = result.revisedPrompt;
            }

            return {
              content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
            };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`[image-generate] Failed: ${message}`);
            return {
              content: [{ type: "text", text: `Image generation failed: ${message}` }],
              isError: true,
            };
          }
        });
      },
    ),
  );

  return tools;
}
