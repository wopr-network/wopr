/**
 * OpenAI DALL-E image generation provider.
 */

import { writeFile } from "node:fs/promises";
import { logger } from "../../../logger.js";
import type { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from "../image-generate.js";

const DALLE_API_URL = "https://api.openai.com/v1/images/generations";

export class OpenAIDalleProvider implements ImageGenerationProvider {
  readonly name = "openai-dalle";

  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(request: ImageGenerationRequest, outputPath: string): Promise<ImageGenerationResult> {
    const { prompt, size = "1024x1024", quality = "standard", style = "natural" } = request;

    const sizeMap: Record<string, string> = {
      "256": "256x256",
      "512": "512x512",
      "1024": "1024x1024",
      "256x256": "256x256",
      "512x512": "512x512",
      "1024x1024": "1024x1024",
    };

    const resolvedSize = sizeMap[size] ?? "1024x1024";

    const body = JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: resolvedSize,
      quality,
      style,
      response_format: "b64_json",
    });

    logger.info(`[image-generate] DALL-E request: size=${resolvedSize} quality=${quality} style=${style}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    let response: Response;
    try {
      response = await fetch(DALLE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed.error?.message ?? errorBody;
      } catch {
        errorMessage = errorBody;
      }

      if (response.status === 429) {
        throw new Error(`Rate limited by OpenAI API. Please retry later. Details: ${errorMessage}`);
      }
      if (response.status === 400 && errorMessage.toLowerCase().includes("content policy")) {
        throw new Error(`Content policy violation: ${errorMessage}`);
      }
      throw new Error(`DALL-E API error (${response.status}): ${errorMessage}`);
    }

    const result = await response.json();
    const imageData = result.data?.[0];

    if (!imageData?.b64_json) {
      throw new Error("DALL-E API returned no image data");
    }

    const buffer = Buffer.from(imageData.b64_json, "base64");
    await writeFile(outputPath, buffer);

    logger.info(`[image-generate] Image saved: ${outputPath} (${buffer.length} bytes)`);

    return {
      filePath: outputPath,
      sizeBytes: buffer.length,
      revisedPrompt: imageData.revised_prompt,
    };
  }
}
