/**
 * API Key Management Routes (WOP-209)
 *
 * POST   /api/keys      — Generate a new API key (requires authenticated session)
 * GET    /api/keys      — List user's keys (masked)
 * DELETE /api/keys/:id  — Revoke a key
 *
 * All routes require authentication via requireAuth() middleware.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { ApiKeyScope } from "../api-keys.js";
import { generateApiKey, KeyLimitError, listApiKeys, revokeApiKey } from "../api-keys.js";

type AuthEnv = {
  Variables: {
    user: { id: string } | undefined;
    role: string;
    session: unknown;
    authMethod: string;
    apiKeyScope: string;
  };
};

export const apiKeysRouter = new Hono<AuthEnv>();

const VALID_SCOPES = new Set(["full", "read-only"]);
const INSTANCE_SCOPE_RE = /^instance:[a-zA-Z0-9._-]+$/;

function isValidScope(scope: string): scope is ApiKeyScope {
  return VALID_SCOPES.has(scope) || INSTANCE_SCOPE_RE.test(scope);
}

/**
 * POST /api/keys — Generate a new API key.
 * Body: { name: string, scope?: string, expiresAt?: number }
 * Returns: { key: string (shown once), ...keyInfo }
 */
apiKeysRouter.post(
  "/",
  describeRoute({
    tags: ["API Keys"],
    summary: "Generate a new API key",
    description: "Creates a wopr_ prefixed API key. Requires session auth (not another API key).",
    responses: {
      201: { description: "API key created (shown once — store it securely)" },
      400: { description: "Validation error" },
      403: { description: "Forbidden (API keys cannot create keys)" },
      429: { description: "Key limit reached" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "User context required — API keys cannot be created with daemon token auth" }, 403);
    }

    // API keys cannot mint new keys — session-based auth required (WOP-209 finding #3)
    if (c.get("authMethod") === "api_key") {
      return c.json({ error: "API keys cannot create new API keys — use session auth" }, 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const name = body.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      return c.json({ error: "name is required (non-empty string)" }, 400);
    }
    if (name.length > 128) {
      return c.json({ error: "name must be 128 characters or fewer" }, 400);
    }

    const scope = (body.scope as string) ?? "full";
    if (!isValidScope(scope)) {
      return c.json({ error: `Invalid scope: ${scope}. Must be full, read-only, or instance:{id}` }, 400);
    }

    const expiresAt = body.expiresAt != null ? Number(body.expiresAt) : null;
    if (expiresAt !== null && (Number.isNaN(expiresAt) || expiresAt < Date.now())) {
      return c.json({ error: "expiresAt must be a future timestamp in milliseconds" }, 400);
    }

    let rawKey: string;
    let keyInfo: Awaited<ReturnType<typeof generateApiKey>>["keyInfo"];
    try {
      ({ rawKey, keyInfo } = await generateApiKey(user.id, name.trim(), scope as ApiKeyScope, expiresAt));
    } catch (err) {
      if (err instanceof KeyLimitError) {
        return c.json({ error: err.message }, 429);
      }
      throw err;
    }

    return c.json(
      {
        key: rawKey,
        ...keyInfo,
      },
      201,
    );
  },
);

/**
 * GET /api/keys — List the authenticated user's API keys (masked).
 */
apiKeysRouter.get(
  "/",
  describeRoute({
    tags: ["API Keys"],
    summary: "List API keys",
    description: "Returns all API keys for the authenticated user (values masked).",
    responses: {
      200: { description: "List of API keys" },
      403: { description: "User context required" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "User context required" }, 403);
    }

    const keys = await listApiKeys(user.id);
    return c.json({ keys });
  },
);

/**
 * DELETE /api/keys/:id — Revoke an API key by ID.
 */
apiKeysRouter.delete(
  "/:id",
  describeRoute({
    tags: ["API Keys"],
    summary: "Revoke an API key",
    responses: {
      200: { description: "Key revoked" },
      403: { description: "Forbidden (API keys cannot revoke keys)" },
      404: { description: "Key not found" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const user = c.get("user");
    if (!user?.id) {
      return c.json({ error: "User context required" }, 403);
    }

    // API keys cannot revoke keys — session-based auth required (WOP-209 finding #3)
    if (c.get("authMethod") === "api_key") {
      return c.json({ error: "API keys cannot revoke keys — use session auth" }, 403);
    }

    const keyId = c.req.param("id");
    if (!keyId) {
      return c.json({ error: "Key ID is required" }, 400);
    }

    const deleted = await revokeApiKey(keyId, user.id);
    if (!deleted) {
      return c.json({ error: "API key not found" }, 404);
    }

    return c.json({ deleted: true });
  },
);
