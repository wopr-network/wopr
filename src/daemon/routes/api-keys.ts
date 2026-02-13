/**
 * API Keys Routes (WOP-209)
 *
 * POST   /api/keys     — Generate a new API key
 * GET    /api/keys     — List user's keys (masked, never returns raw key)
 * DELETE /api/keys/:id — Revoke a key
 */

import { Hono } from "hono";
import type { ApiKeyScope } from "../api-keys.js";
import { createApiKey, isValidScope, listApiKeys, revokeApiKey } from "../api-keys.js";

export const apiKeysRouter = new Hono();

// POST /api/keys — Generate new API key
apiKeysRouter.post("/", async (c) => {
  const body = await c.req.json();
  const { name, scope = "full" } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  if (!isValidScope(scope)) {
    return c.json({ error: `Invalid scope: ${scope}. Must be "full", "read-only", or "instance:{id}"` }, 400);
  }

  const result = createApiKey(name.trim(), scope as ApiKeyScope);

  // Return the raw key — this is the only time it will be shown
  return c.json(
    {
      id: result.id,
      name: result.name,
      key: result.key,
      prefix: result.prefix,
      scope: result.scope,
      createdAt: result.createdAt,
      warning: "Store this key securely. It will not be shown again.",
    },
    201,
  );
});

// GET /api/keys — List keys (masked)
apiKeysRouter.get("/", (c) => {
  const keys = listApiKeys();

  const masked = keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: `${k.prefix}...`,
    scope: k.scope,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
  }));

  return c.json({ keys: masked });
});

// DELETE /api/keys/:id — Revoke a key
apiKeysRouter.delete("/:id", (c) => {
  const id = c.req.param("id");

  if (!id || !/^[a-f0-9]+$/.test(id)) {
    return c.json({ error: "Invalid key ID" }, 400);
  }

  const revoked = revokeApiKey(id);
  if (!revoked) {
    return c.json({ error: "API key not found" }, 404);
  }

  return c.json({ revoked: true, id });
});
