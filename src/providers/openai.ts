/**
 * OpenAI Codex Provider
 *
 * Implements the ModelProvider interface for OpenAI's Codex Agent SDK
 */

import {
  ModelProvider,
  ModelClient,
  ModelQueryOptions,
  ModelResponse,
} from "../types/provider.js";

let CodexSDK: any;

/**
 * Lazy load Codex SDK
 */
async function loadCodexSDK() {
  if (!CodexSDK) {
    try {
      const codex = await import("@openai/codex-sdk");
      CodexSDK = codex;
    } catch (error) {
      throw new Error(
        'Codex SDK not installed. Run: npm install @openai/codex-sdk'
      );
    }
  }
  return CodexSDK;
}

/**
 * OpenAI Codex provider implementation
 * Uses the Codex agent SDK for agent-based code execution
 */
export const codexProvider: ModelProvider = {
  id: "codex",
  name: "OpenAI Codex",
  description: "OpenAI Codex agent SDK for coding tasks",
  defaultModel: "codex",
  supportedModels: ["codex"],

  async validateCredentials(credential: string): Promise<boolean> {
    // API key format: sk-... (OpenAI format)
    if (!credential.startsWith("sk-")) {
      return false;
    }

    try {
      const codex = await loadCodexSDK();
      // Create a client to validate the credential
      const client = codex.createClient({ apiKey: credential });
      // Try a simple health check
      await client.health();
      return true;
    } catch (error) {
      return false;
    }
  },

  async createClient(
    credential: string,
    options?: Record<string, unknown>
  ): Promise<ModelClient> {
    return new CodexClient(credential, options);
  },

  getCredentialType(): "api-key" | "oauth" | "custom" {
    return "api-key";
  },
};

/**
 * Codex client implementation
 * Wraps the Codex agent SDK
 */
class CodexClient implements ModelClient {
  private client: any;

  constructor(
    private credential: string,
    private options?: Record<string, unknown>
  ) {
    // Set API key for Codex SDK to use
    process.env.OPENAI_API_KEY = credential;
  }

  private async getClient() {
    if (!this.client) {
      const codex = await loadCodexSDK();
      this.client = codex.createClient({
        apiKey: this.credential,
        ...this.options,
      });
    }
    return this.client;
  }

  async *query(opts: ModelQueryOptions): AsyncGenerator<any> {
    const client = await this.getClient();

    try {
      // Use Codex agent for code execution
      const q = await client.run({
        prompt: opts.prompt,
        systemPrompt: opts.systemPrompt,
        directory: process.cwd(),
        ...opts.providerOptions,
      });

      // Stream results from Codex agent
      for await (const msg of q) {
        yield msg;
      }
    } catch (error) {
      throw new Error(
        `Codex query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async listModels(): Promise<string[]> {
    return codexProvider.supportedModels;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      await client.health();
      return true;
    } catch {
      return false;
    }
  }
}
