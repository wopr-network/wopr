/**
 * Auth API routes
 */

import { Hono } from "hono";
import {
  buildAuthUrl,
  clearAuth,
  exchangeCode,
  generatePKCE,
  loadAuth,
  loadClaudeCodeCredentials,
  saveApiKey,
  saveOAuthTokens,
} from "../../auth.js";

export const authRouter = new Hono();

// Server-side PKCE verifier store keyed by OAuth state parameter.
// Entries are auto-cleaned after PKCE_TTL_MS to prevent memory leaks.
const PKCE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pkceStore = new Map<string, { codeVerifier: string; redirectUri: string; createdAt: number }>();

const pkceCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of pkceStore) {
    if (now - entry.createdAt > PKCE_TTL_MS) {
      pkceStore.delete(state);
    }
  }
}, 60_000); // Run cleanup every 60 seconds

// Allow Node to exit without waiting for the interval
if (typeof pkceCleanupInterval === "object" && "unref" in pkceCleanupInterval) {
  pkceCleanupInterval.unref();
}

// Get auth status
authRouter.get("/", (c) => {
  const claudeCodeAuth = loadClaudeCodeCredentials();
  const auth = loadAuth();

  if (claudeCodeAuth) {
    return c.json({
      authenticated: true,
      type: "oauth",
      source: "claude-code",
      email: claudeCodeAuth.email || null,
      expiresAt: claudeCodeAuth.expiresAt || null,
    });
  }

  if (!auth || (!auth.apiKey && !auth.accessToken)) {
    return c.json({
      authenticated: false,
    });
  }

  if (auth.type === "oauth") {
    return c.json({
      authenticated: true,
      type: "oauth",
      source: "wopr",
      email: auth.email || null,
      expiresAt: auth.expiresAt || null,
    });
  }

  if (auth.type === "api_key") {
    return c.json({
      authenticated: true,
      type: "api_key",
      keyPrefix: `${auth.apiKey?.substring(0, 12)}...`,
    });
  }

  return c.json({ authenticated: false });
});

// Start OAuth flow - returns URL to redirect to
authRouter.post("/login", (c) => {
  const pkce = generatePKCE();
  const redirectUri = "http://localhost:9876/callback";
  const authUrl = buildAuthUrl(pkce, redirectUri);

  // Store PKCE verifier server-side — never expose to client
  pkceStore.set(pkce.state, {
    codeVerifier: pkce.codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  });

  return c.json({
    authUrl,
    state: pkce.state,
  });
});

// Complete OAuth flow
authRouter.post("/callback", async (c) => {
  const body = await c.req.json();
  const { code, state } = body;

  if (!code || !state) {
    return c.json({ error: "Missing required fields: code, state" }, 400);
  }

  const pending = pkceStore.get(state);
  if (!pending) {
    return c.json({ error: "Invalid or expired OAuth state" }, 400);
  }

  // Enforce TTL at lookup time (belt-and-suspenders with interval cleanup)
  if (Date.now() - pending.createdAt > PKCE_TTL_MS) {
    pkceStore.delete(state);
    return c.json({ error: "PKCE session expired" }, 400);
  }

  try {
    const tokens = await exchangeCode(code, pending.codeVerifier, pending.redirectUri);

    // Delete AFTER successful exchange so retries work on transient failures
    pkceStore.delete(state);

    await saveOAuthTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);

    return c.json({
      success: true,
      expiresIn: tokens.expiresIn,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Set API key
authRouter.post("/api-key", async (c) => {
  const body = await c.req.json();
  const { apiKey } = body;

  if (!apiKey) {
    return c.json({ error: "API key is required" }, 400);
  }

  await saveApiKey(apiKey);
  return c.json({ success: true });
});

// Logout
authRouter.post("/logout", async (c) => {
  await clearAuth();
  return c.json({ success: true });
});
