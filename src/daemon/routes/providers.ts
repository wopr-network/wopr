/**
 * Providers API routes
 */

import { Hono } from "hono";
import { getCapabilityRegistry } from "../../core/capability-registry.js";
import { providerRegistry } from "../../core/providers.js";
import { listConfigSchemas } from "../../plugins.js";

export const providersRouter = new Hono();

// List all providers
providersRouter.get("/", (c) => {
  const providers = providerRegistry.listProviders();
  return c.json({
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      available: p.available,
    })),
  });
});

// Add/update provider credential
providersRouter.post("/", async (c) => {
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
});

// Remove provider credential
providersRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");

  try {
    await providerRegistry.removeCredential(id);
    return c.json({ success: true, removed: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Health check all providers
providersRouter.post("/health", async (c) => {
  await providerRegistry.checkHealth();
  const providers = providerRegistry.listProviders();

  return c.json({
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      available: p.available,
    })),
  });
});

// Get all config schemas (for provider/plugin configuration UI)
providersRouter.get("/schemas", (c) => {
  const schemas = listConfigSchemas();
  return c.json({ schemas });
});

// Capability discovery (WOP-503) — generic endpoint that supersedes per-capability tools
providersRouter.get("/capabilities", (c) => {
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
});
