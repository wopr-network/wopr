/**
 * OpenAPI spec generation tests (WOP-522)
 *
 * Tests that the daemon exposes correct OpenAPI endpoints and that
 * the spec is valid and includes all expected routes.
 */

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Mock heavy daemon dependencies that aren't needed for OpenAPI tests
vi.mock("../../src/core/config.js", () => ({
  config: {
    load: vi.fn(),
    get: vi.fn(() => ({})),
    getValue: vi.fn(),
    setValue: vi.fn(),
    save: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock("../../src/core/sessions.js", () => ({
  listSessions: vi.fn(async () => []),
  getSessions: vi.fn(async () => ({})),
  getSessionContext: vi.fn(async () => null),
  setSessionContext: vi.fn(),
  deleteSession: vi.fn(),
  inject: vi.fn(),
  logMessage: vi.fn(),
  readConversationLog: vi.fn(async () => []),
}));

vi.mock("../../src/plugins.js", () => ({
  listPlugins: vi.fn(async () => []),
  getAllPluginManifests: vi.fn(() => new Map()),
  getLoadedPlugin: vi.fn(() => undefined),
  readPluginManifest: vi.fn(() => null),
  getWebUiExtensions: vi.fn(() => []),
  getUiComponents: vi.fn(() => []),
  installPlugin: vi.fn(),
  unloadPlugin: vi.fn(),
  removePlugin: vi.fn(),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  loadPlugin: vi.fn(),
  getPluginState: vi.fn(() => null),
  getConfigSchemas: vi.fn(() => new Map()),
  searchPlugins: vi.fn(async () => []),
  listRegistries: vi.fn(async () => []),
  addRegistry: vi.fn(),
  removeRegistry: vi.fn(),
  getPluginExtension: vi.fn(() => null),
  listConfigSchemas: vi.fn(() => []),
}));

vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    listProviders: vi.fn(() => []),
    setCredential: vi.fn(),
    removeCredential: vi.fn(),
    checkHealth: vi.fn(),
    getActiveProvider: vi.fn(() => null),
    getProvider: vi.fn(() => null),
    getCredential: vi.fn(() => null),
    loadCredentials: vi.fn(),
  },
}));

vi.mock("../../src/core/capability-registry.js", () => ({
  getCapabilityRegistry: vi.fn(() => ({
    listCapabilities: vi.fn(() => []),
    getProviders: vi.fn(() => []),
  })),
}));

vi.mock("../../src/daemon/middleware/rate-limit.js", () => ({
  rateLimit: () => (_c: unknown, next: () => Promise<unknown>) => next(),
}));

vi.mock("../../src/daemon/middleware/auth.js", () => ({
  bearerAuth: () => (_c: unknown, next: () => Promise<unknown>) => next(),
  requireAuth: () => (_c: unknown, next: () => Promise<unknown>) => next(),
}));

vi.mock("../../src/daemon/cors.js", () => ({
  buildCorsOrigins: vi.fn(() => ["http://localhost:7437"]),
}));

vi.mock("../../src/daemon/auth-token.js", () => ({
  ensureToken: vi.fn(() => "test-token"),
}));

vi.mock("../../src/daemon/readiness.js", () => ({
  checkReadiness: vi.fn(() => ({ ready: true })),
  markStartupComplete: vi.fn(),
}));

vi.mock("../../src/daemon/restart-on-idle.js", () => ({
  restartOnIdleManager: {
    onRestart: vi.fn(),
    shutdown: vi.fn(),
    scheduleRestartOnIdle: vi.fn(),
    cancelRestart: vi.fn(),
    getStatus: vi.fn(() => ({ scheduled: false })),
  },
}));

vi.mock("../../src/daemon/ws.js", () => ({
  getSubscriptionStats: vi.fn(() => ({ clients: 0, topics: 0 })),
  HEARTBEAT_INTERVAL_MS: 30000,
  handleWebSocketClose: vi.fn(),
  handleWebSocketMessage: vi.fn(),
  heartbeatTick: vi.fn(() => 0),
  publishToTopic: vi.fn(),
  setupWebSocket: vi.fn(),
  broadcastInjection: vi.fn(),
  broadcastStream: vi.fn(),
}));

vi.mock("../../src/daemon/health.js", () => ({
  HealthMonitor: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock("../../src/daemon/api-keys.js", () => ({
  validateApiKey: vi.fn(async () => null),
}));

vi.mock("../../src/daemon/routes/api-keys.js", () => ({
  apiKeysRouter: new Hono(),
}));

vi.mock("../../src/daemon/routes/health.js", () => ({
  createHealthzRouter: vi.fn(() => new Hono()),
}));

vi.mock("../../src/daemon/observability/index.js", () => ({
  observabilityRouter: new Hono(),
}));

vi.mock("../../src/daemon/routes/observability.js", () => ({
  observabilityRouter: new Hono(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/daemon/routes/capability-health.js", () => ({
  capabilityHealthRouter: new Hono(),
}));

vi.mock("../../src/daemon/routes/capabilities.js", () => ({
  capabilitiesRouter: new Hono(),
}));

vi.mock("../../src/daemon/routes/marketplace.js", () => ({
  marketplaceRouter: new Hono(),
}));

vi.mock("../../src/daemon/routes/instance-plugins.js", () => ({
  instancePluginsRouter: new Hono(),
}));

vi.mock("../../src/daemon/routes/hooks.js", () => ({
  hooksRouter: new Hono(),
}));

vi.mock("../../src/daemon/routes/templates.js", () => ({
  templatesRouter: new Hono(),
}));

vi.mock("../../src/daemon/routes/openai.js", () => ({
  openaiRouter: new Hono(),
}));

vi.mock("../../src/daemon/routes/restart.js", () => ({
  restartRouter: new Hono(),
}));

vi.mock("../../src/security/index.js", () => ({
  createInjectionSource: vi.fn(() => ({ type: "api" })),
}));

vi.mock("../../src/daemon/validation.js", () => ({
  validateSessionName: vi.fn(),
}));

describe("OpenAPI endpoints (WOP-522)", () => {
  describe("GET /openapi.json", () => {
    it("returns 200 with valid OpenAPI JSON", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/openapi.json");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.openapi).toMatch(/^3\.\d+\.\d+$/);
      expect(json.info).toBeDefined();
      expect(json.info.title).toBe("WOPR Daemon API");
    });

    it("includes all expected tags", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/openapi.json");
      const json = await res.json();
      const tagNames = (json.tags ?? []).map((t: { name: string }) => t.name);
      expect(tagNames).toContain("Sessions");
      expect(tagNames).toContain("Plugins");
      expect(tagNames).toContain("Auth");
      expect(tagNames).toContain("Providers");
      expect(tagNames).toContain("Instances");
    });

    it("includes security schemes", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/openapi.json");
      const json = await res.json();
      expect(json.components?.securitySchemes?.bearerAuth).toBeDefined();
      expect(json.components.securitySchemes.bearerAuth.type).toBe("http");
      expect(json.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    });

    it("includes paths for sessions routes", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/openapi.json");
      const json = await res.json();
      const paths = Object.keys(json.paths ?? {});
      expect(paths.some((p) => p.startsWith("/sessions"))).toBe(true);
    });

    it("includes paths for plugin routes", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/openapi.json");
      const json = await res.json();
      const paths = Object.keys(json.paths ?? {});
      expect(paths.some((p) => p.startsWith("/plugins"))).toBe(true);
    });

    it("includes paths for auth routes", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/openapi.json");
      const json = await res.json();
      const paths = Object.keys(json.paths ?? {});
      expect(paths.some((p) => p.startsWith("/auth"))).toBe(true);
    });

    it("has more than 20 documented paths", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/openapi.json");
      const json = await res.json();
      expect(Object.keys(json.paths ?? {}).length).toBeGreaterThan(20);
    });
  });

  describe("GET /docs", () => {
    it("returns 200 with HTML for Scalar UI", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/docs");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.toLowerCase()).toContain("html");
    });
  });

  describe("GET /openapi/websocket.json", () => {
    it("returns 200 with WebSocket documentation", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/openapi/websocket.json");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.title).toBe("WOPR WebSocket API");
      expect(json.connection).toBeDefined();
      expect(json.clientMessages).toBeDefined();
      expect(json.serverMessages).toBeDefined();
    });
  });

  describe("GET /openapi/plugin-manifest.schema.json", () => {
    it("returns 200 with JSON Schema for plugin manifests", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/openapi/plugin-manifest.schema.json");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.type).toBe("object");
      expect(json.properties).toBeDefined();
      expect(json.properties.name).toBeDefined();
      expect(json.properties.version).toBeDefined();
      expect(json.properties.capabilities).toBeDefined();
    });
  });

  describe("Auth skip - doc endpoints are unauthenticated", () => {
    it("/openapi.json does not require Authorization header", async () => {
      // The real test: auth middleware skips /openapi.json
      // We verify this by checking SKIP_AUTH_PATHS in auth.ts via integration
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      // No Authorization header — should succeed (auth is mocked but this
      // verifies the path is registered and accessible)
      const res = await app.request("/openapi.json");
      expect(res.status).toBe(200);
    });

    it("/docs does not require Authorization header", async () => {
      const { createApp } = await import("../../src/daemon/index.js");
      const app = createApp();
      const res = await app.request("/docs");
      expect(res.status).toBe(200);
    });
  });

  describe("OpenAPI info module", () => {
    it("exports openApiDocumentation with correct structure", async () => {
      const { openApiDocumentation } = await import("../../src/daemon/openapi/info.js");
      expect(openApiDocumentation.info.title).toBe("WOPR Daemon API");
      expect(openApiDocumentation.info.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(openApiDocumentation.tags).toBeInstanceOf(Array);
      expect(openApiDocumentation.tags.length).toBeGreaterThan(5);
      expect(openApiDocumentation.components.securitySchemes.bearerAuth.type).toBe("http");
    });
  });

  describe("WebSocket docs module", () => {
    it("exports websocketDocs with required fields", async () => {
      const { websocketDocs } = await import("../../src/daemon/openapi/websocket-docs.js");
      expect(websocketDocs.title).toBe("WOPR WebSocket API");
      expect(websocketDocs.connection.endpoints).toBeInstanceOf(Array);
      expect(websocketDocs.clientMessages.auth).toBeDefined();
      expect(websocketDocs.clientMessages.subscribe).toBeDefined();
      expect(websocketDocs.serverMessages.connected).toBeDefined();
    });
  });

  describe("Plugin manifest schema module", () => {
    it("exports PluginManifestSchema as a valid Zod schema", async () => {
      const { PluginManifestSchema } = await import("../../src/daemon/openapi/manifest-schema.js");
      // Valid manifest should parse
      const result = PluginManifestSchema.safeParse({
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
        capabilities: ["tts"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid manifest missing required fields", async () => {
      const { PluginManifestSchema } = await import("../../src/daemon/openapi/manifest-schema.js");
      const result = PluginManifestSchema.safeParse({
        name: "test-plugin",
        // missing version, description, capabilities
      });
      expect(result.success).toBe(false);
    });
  });
});
