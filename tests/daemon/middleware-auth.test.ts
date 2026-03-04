import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// vi.mock is hoisted before imports by vitest, ensuring mocks are in place
// when auth.ts loads and first calls ensureToken (populating its module-scope
// cachedToken). Since ensureToken always returns the same value here, the cache
// is stable — tests are NOT execution-order-dependent.
vi.mock("../../src/daemon/auth-token.js", () => ({
  ensureToken: vi.fn(() => "test-daemon-token-abc123"),
}));

// Mock validateApiKey — default: returns null (invalid)
const mockValidateApiKey = vi.fn().mockResolvedValue(null);
vi.mock("../../src/daemon/api-keys.js", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

import {
  bearerAuth,
  requireAuth,
  requireAdmin,
  isDaemonBearerValid,
} from "../../src/daemon/middleware/auth.js";

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
    const skipPaths = [
      "/health",
      "/ready",
      "/healthz",
      "/healthz/history",
      "/openapi.json",
      "/docs",
      "/openapi/websocket.json",
      "/openapi/plugin-manifest.schema.json",
      "/",
    ];

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
        headers: { Authorization: "Bearer test-daemon-token-abc123" },
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
      const res = await app.request("/api/some-route", {
        headers: { Authorization: "Bearer test-daemon-token-abc12X" },
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
      expect(isDaemonBearerValid("Bearer test-daemon-token-abc123")).toBe(true);
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
      const sameLength = "Bearer " + "x".repeat("test-daemon-token-abc123".length);
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
          "Sec-WebSocket-Protocol": "auth.test-daemon-token-abc123",
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
          "Sec-WebSocket-Protocol": "graphql-ws, auth.test-daemon-token-abc123",
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
        headers: { Authorization: "Bearer test-daemon-token-abc123" },
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
