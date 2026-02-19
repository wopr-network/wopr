/**
 * Providers API routes
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getCapabilityRegistry } from "../../core/capability-registry.js";
import { providerRegistry } from "../../core/providers.js";
import { listConfigSchemas } from "../../plugins.js";

export const providersRouter = new Hono();

// List all providers
providersRouter.get(
  "/",
  describeRoute({
    tags: ["Providers"],
    summary: "List all registered AI providers",
    responses: {
      200: { description: "List of providers with availability status" },
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const providers = providerRegistry.listProviders();
    return c.json({
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        available: p.available,
      })),
    });
  },
);

// Add/update provider credential
providersRouter.post(
  "/",
  describeRoute({
    tags: ["Providers"],
    summary: "Add or update provider credential",
    responses: {
      201: { description: "Credential saved" },
      400: { description: "Validation error" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const body = await c.req.json();
    const { providerId, credential } = body;

    if (!providerId || !credential) {
      return c.json({ error: "providerId and credential are required" }, 400);
    }

    try {
      await providerRegistry.setCredential(providerId, credential);
      return c.json({ success: true, providerId }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  },
);

// Remove provider credential
providersRouter.delete(
  "/:id",
  describeRoute({
    tags: ["Providers"],
    summary: "Remove provider credential",
    responses: {
      200: { description: "Credential removed" },
      400: { description: "Error removing credential" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");

    try {
      await providerRegistry.removeCredential(id);
      return c.json({ success: true, removed: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  },
);

// Health check all providers
providersRouter.post(
  "/health",
  describeRoute({
    tags: ["Providers"],
    summary: "Health check all providers",
    responses: {
      200: { description: "Provider health status list" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    await providerRegistry.checkHealth();
    const providers = providerRegistry.listProviders();

    return c.json({
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        available: p.available,
      })),
    });
  },
);

// GET /providers/active — MUST be before /:id/models to avoid param capture
providersRouter.get(
  "/active",
  describeRoute({
    tags: ["Providers"],
    summary: "Get the currently active provider",
    responses: {
      200: { description: "Active provider details or null" },
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const resolved = providerRegistry.getActiveProvider();
    if (!resolved) {
      return c.json({ provider: null, model: null });
    }
    return c.json({
      provider: resolved.id,
      providerName: resolved.name,
      model: resolved.defaultModel,
    });
  },
);

// GET /providers/:id/models — list available models for a specific provider
providersRouter.get(
  "/:id/models",
  describeRoute({
    tags: ["Providers"],
    summary: "List available models for a provider",
    responses: {
      200: { description: "List of models" },
      401: { description: "No credentials configured" },
      404: { description: "Provider not found" },
      500: { description: "Error fetching models" },
    },
  }),
  async (c) => {
    const id = c.req.param("id");
    const reg = providerRegistry.getProvider(id);
    if (!reg) {
      return c.json({ error: `Provider not found: ${id}` }, 404);
    }
    try {
      const { getPluginExtension } = await import("../../plugins/extensions.js");
      const ext = getPluginExtension<{ getModelInfo?: () => Promise<unknown[]> }>(`provider-${id}`);
      if (ext?.getModelInfo) {
        const enriched = await ext.getModelInfo();
        return c.json({
          providerId: id,
          providerName: reg.provider.name,
          defaultModel: reg.provider.defaultModel,
          models: enriched,
        });
      }
      const cred = providerRegistry.getCredential(id);
      const credType = reg.provider.getCredentialType?.() ?? "api-key";
      if (!cred && credType !== "oauth") {
        return c.json({ error: `No credentials configured for provider: ${id}` }, 401);
      }
      const client = await reg.provider.createClient(cred?.credential || "");
      const modelIds = await client.listModels();
      return c.json({
        providerId: id,
        providerName: reg.provider.name,
        defaultModel: reg.provider.defaultModel,
        models: modelIds.map((mid: string) => ({ id: mid, name: mid })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  },
);

// Get all config schemas (for provider/plugin configuration UI)
providersRouter.get(
  "/schemas",
  describeRoute({
    tags: ["Providers"],
    summary: "Get all provider and plugin config schemas",
    responses: {
      200: { description: "Config schemas for all registered providers and plugins" },
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const schemas = listConfigSchemas();
    return c.json({ schemas });
  },
);

// Capability discovery (WOP-503) — generic endpoint that supersedes per-capability tools
providersRouter.get(
  "/capabilities",
  describeRoute({
    tags: ["Providers"],
    summary: "List all capabilities and their providers",
    responses: {
      200: { description: "Capability registry with provider availability" },
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const capRegistry = getCapabilityRegistry();
    const allCapabilities = capRegistry.listCapabilities();
    const providers = providerRegistry.listProviders();

    // Build health lookup
    const healthMap = new Map(providers.map((p) => [p.id, p.available]));

    const capabilities = allCapabilities.map((cap) => {
      const capProviders = capRegistry.getProviders(cap.capability);
      return {
        capability: cap.capability,
        providerCount: cap.providerCount,
        providers: capProviders.map((p) => ({
          id: p.id,
          name: p.name,
          available: healthMap.get(p.id) ?? null,
        })),
      };
    });

    return c.json({ capabilities });
  },
);
