import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Hoist mockValidateApiKey so it is initialized before the vi.mock factory that
// references it (required by Vitest's hoisting transform).
const { mockValidateApiKey } = vi.hoisted(() => ({
  mockValidateApiKey: vi.fn().mockResolvedValue(null),
}));

// Mock ensureToken — use the same token value as plugin-routes-auth.test.ts so
// that the module-scope cachedToken in auth.ts is consistent if module state is
// ever shared across files (e.g., vitest --no-isolate).
vi.mock("../../src/daemon/auth-token.js", () => ({
  ensureToken: vi.fn(() => "test-token"),
}));

// Mock validateApiKey — default: returns null (invalid)
vi.mock("../../src/daemon/api-keys.js", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

import {
  SKIP_AUTH_PATHS,
  bearerAuth,
  requireAuth,
  requireAdmin,
  isDaemonBearerValid,
} from "../../src/daemon/middleware/auth.js";

/** Shared daemon token — must match the mock above. */
const DAEMON_TOKEN = "test-token";

function buildApp() {
  const app = new Hono();
  app.use("*", bearerAuth());
  app.all("*", (c) => c.json({ ok: true }));
  return app;
}

describe("daemon auth middleware (WOP-1572)", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    mockValidateApiKey.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("skip-auth paths", () => {
    // Derive skip paths from the single source of truth in auth.ts, plus "/" which
    // is handled separately in the middleware condition (not part of the Set).
    const skipPaths = [...SKIP_AUTH_PATHS, "/"];

    for (const path of skipPaths) {
      it(`skips auth for ${path}`, async () => {
        const res = await app.request(path);
        expect(res.status).toBe(200);
      });
    }
  });

  describe("missing or malformed Authorization header", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const res = await app.request("/api/some-route");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Missing or invalid Authorization header");
    });

    it("returns 401 when Authorization header uses Basic scheme", async () => {
      const res = await app.request("/api/some-route", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Missing or invalid Authorization header");
    });

    it("returns 401 when Authorization header is empty string", async () => {
      const res = await app.request("/api/some-route", {
        headers: { Authorization: "" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("daemon bearer token", () => {
    it("accepts valid daemon bearer token", async () => {
      const res = await app.request("/api/some-route", {
        headers: { Authorization: `Bearer ${DAEMON_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects invalid daemon bearer token", async () => {
      const res = await app.request("/api/some-route", {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid token");
    });

    it("rejects token with correct prefix but wrong value", async () => {
      // Same length as DAEMON_TOKEN, last char changed — verifies timing-safe rejection
      const sameLength = DAEMON_TOKEN.slice(0, -1) + "X";
      const res = await app.request("/api/some-route", {
        headers: { Authorization: `Bearer ${sameLength}` },
      });
      expect(res.status).toBe(401);
    });

    it("rejects empty bearer token", async () => {
      const res = await app.request("/api/some-route", {
        headers: { Authorization: "Bearer " },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("isDaemonBearerValid", () => {
    it("returns true for valid token", () => {
      expect(isDaemonBearerValid(`Bearer ${DAEMON_TOKEN}`)).toBe(true);
    });

    it("returns false for wrong token", () => {
      expect(isDaemonBearerValid("Bearer wrong")).toBe(false);
    });

    it("returns false for token with different length", () => {
      expect(isDaemonBearerValid("Bearer short")).toBe(false);
    });

    it("returns false for empty bearer", () => {
      expect(isDaemonBearerValid("Bearer ")).toBe(false);
    });

    it("returns false for same-length but wrong content (timing-safe)", () => {
      const sameLength = "Bearer " + "x".repeat(DAEMON_TOKEN.length);
      expect(isDaemonBearerValid(sameLength)).toBe(false);
    });
  });

  describe("wopr_ API key authentication", () => {
    it("accepts valid wopr_ API key", async () => {
      mockValidateApiKey.mockResolvedValue({ id: "user-1", scope: "full" });
      const res = await app.request("/api/some-route", {
        headers: { Authorization: "Bearer wopr_test_key_123" },
      });
      expect(res.status).toBe(200);
      expect(mockValidateApiKey).toHaveBeenCalledWith("wopr_test_key_123");
    });

    it("rejects invalid wopr_ API key", async () => {
      mockValidateApiKey.mockResolvedValue(null);
      const res = await app.request("/api/some-route", {
        headers: { Authorization: "Bearer wopr_invalid_key" },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid API key");
    });
  });

  describe("authenticateApiKey context setting", () => {
    it("sets user, authMethod, apiKeyScope, and role on context for full scope", async () => {
      mockValidateApiKey.mockResolvedValue({ id: "user-42", scope: "full" });

      const authApp = new Hono();
      authApp.use("*", bearerAuth());
      authApp.get("*", (c) =>
        c.json({
          user: c.get("user"),
          authMethod: c.get("authMethod"),
          apiKeyScope: c.get("apiKeyScope"),
          role: c.get("role"),
        }),
      );

      const res = await authApp.request("/api/test", {
        headers: { Authorization: "Bearer wopr_test_key" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user).toEqual({ id: "user-42" });
      expect(body.authMethod).toBe("api_key");
      expect(body.apiKeyScope).toBe("full");
      expect(body.role).toBe("admin");
    });

    it("maps non-full scope to viewer role", async () => {
      mockValidateApiKey.mockResolvedValue({ id: "user-42", scope: "read" });

      const authApp = new Hono();
      authApp.use("*", bearerAuth());
      authApp.get("*", (c) => c.json({ role: c.get("role") }));

      const res = await authApp.request("/api/test", {
        headers: { Authorization: "Bearer wopr_test_key" },
      });
      const body = await res.json();
      expect(body.role).toBe("viewer");
    });
  });

  describe("WebSocket upgrade auth (WOP-1407)", () => {
    it("authenticates via Sec-WebSocket-Protocol with daemon token", async () => {
      const res = await app.request("/api/ws", {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": `auth.${DAEMON_TOKEN}`,
        },
      });
      expect(res.status).toBe(200);
    });

    it("authenticates via Sec-WebSocket-Protocol with wopr_ API key", async () => {
      mockValidateApiKey.mockResolvedValue({ id: "user-1", scope: "full" });
      const res = await app.request("/api/ws", {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": "auth.wopr_test_key",
        },
      });
      expect(res.status).toBe(200);
    });

    it("rejects invalid token in Sec-WebSocket-Protocol", async () => {
      const res = await app.request("/api/ws", {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": "auth.wrong-token",
        },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid WebSocket auth token");
    });

    it("falls through to normal auth when no auth. protocol present", async () => {
      const res = await app.request("/api/ws", {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": "graphql-ws",
        },
      });
      expect(res.status).toBe(401);
    });

    it("handles multiple protocols with auth. token", async () => {
      const res = await app.request("/api/ws", {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": `graphql-ws, auth.${DAEMON_TOKEN}`,
        },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("requireAuth", () => {
    let authApp: Hono;

    beforeEach(() => {
      authApp = new Hono();
      authApp.use("*", requireAuth());
      authApp.all("*", (c) => c.json({ role: c.get("role") }));
    });

    it("rejects missing Authorization header", async () => {
      const res = await authApp.request("/api/test");
      expect(res.status).toBe(401);
    });

    it("rejects non-Bearer scheme", async () => {
      const res = await authApp.request("/api/test", {
        headers: { Authorization: "Basic abc" },
      });
      expect(res.status).toBe(401);
    });

    it("accepts valid daemon bearer and sets admin role", async () => {
      const res = await authApp.request("/api/test", {
        headers: { Authorization: `Bearer ${DAEMON_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe("admin");
    });

    it("accepts valid wopr_ API key", async () => {
      mockValidateApiKey.mockResolvedValue({ id: "user-1", scope: "full" });
      const res = await authApp.request("/api/test", {
        headers: { Authorization: "Bearer wopr_key_123" },
      });
      expect(res.status).toBe(200);
    });

    it("rejects invalid token with Unauthorized", async () => {
      const res = await authApp.request("/api/test", {
        headers: { Authorization: "Bearer bad-token" },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });
  });

  describe("requireAdmin", () => {
    function buildAdminApp(role: string | undefined) {
      const adminApp = new Hono();
      adminApp.use("*", async (c, next) => {
        if (role !== undefined) c.set("role", role);
        return next();
      });
      adminApp.use("*", requireAdmin());
      adminApp.all("*", (c) => c.json({ ok: true }));
      return adminApp;
    }

    it("allows admin role", async () => {
      const res = await buildAdminApp("admin").request("/test");
      expect(res.status).toBe(200);
    });

    it("allows owner role", async () => {
      const res = await buildAdminApp("owner").request("/test");
      expect(res.status).toBe(200);
    });

    it("rejects viewer role with 403", async () => {
      const res = await buildAdminApp("viewer").request("/test");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Forbidden: admin access required");
    });

    it("rejects undefined role with 403", async () => {
      const res = await buildAdminApp(undefined).request("/test");
      expect(res.status).toBe(403);
    });
  });

  describe("prototype pollution guard", () => {
    it("does not skip auth for __proto__ path", async () => {
      const res = await app.request("/__proto__");
      expect(res.status).toBe(401);
    });

    it("does not skip auth for constructor path", async () => {
      const res = await app.request("/constructor");
      expect(res.status).toBe(401);
    });

    it("does not skip auth for prototype path", async () => {
      const res = await app.request("/prototype");
      expect(res.status).toBe(401);
    });
  });
});
