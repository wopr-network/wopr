/**
 * Per-instance Plugin Management API Tests (WOP-203)
 *
 * Tests for src/daemon/routes/instance-plugins.ts covering:
 * - GET  /api/instances/:id/plugins           — List installed plugins
 * - POST /api/instances/:id/plugins           — Install plugin
 * - DELETE /api/instances/:id/plugins/:name   — Uninstall plugin
 * - POST /api/instances/:id/plugins/:name/enable  — Enable
 * - POST /api/instances/:id/plugins/:name/disable — Disable
 * - GET  /api/instances/:id/plugins/:name/config  — Get config
 * - PUT  /api/instances/:id/plugins/:name/config  — Update config
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config
const mockConfig: Record<string, any> = {};
vi.mock("../../src/core/config.js", () => ({
  config: {
    load: vi.fn(async () => {}),
    get: vi.fn(() => mockConfig),
    setValue: vi.fn((key: string, value: any) => {
      const parts = key.split(".");
      let obj = mockConfig;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
    }),
    save: vi.fn(async () => {}),
  },
}));

// Mock providers
vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    checkHealth: vi.fn(async () => {}),
  },
}));

// Mock sessions
vi.mock("../../src/core/sessions.js", () => ({
  inject: vi.fn(async () => ({ response: "ok" })),
  getSessions: vi.fn(() => ({})),
}));

// Track plugin state for tests
const installedPlugins = [
  {
    name: "discord",
    version: "1.0.0",
    description: "Discord channel plugin",
    source: "github",
    path: "/plugins/discord",
    enabled: true,
    installedAt: 1700000000000,
  },
  {
    name: "openai",
    version: "2.0.0",
    description: "OpenAI provider",
    source: "npm",
    path: "/plugins/openai",
    enabled: false,
    installedAt: 1700000001000,
  },
];

const mockManifests = new Map<string, any>();
mockManifests.set("discord", {
  name: "discord",
  version: "1.0.0",
  description: "Discord channel plugin",
  capabilities: ["channel"],
  category: "channel",
  tags: ["discord", "chat"],
  icon: ":speech_balloon:",
  author: "WOPR",
  license: "MIT",
  homepage: "https://github.com/wopr-network/wopr-plugin-discord",
  configSchema: {
    title: "Discord Settings",
    fields: [
      { name: "token", type: "password", label: "Bot Token", required: true },
      { name: "prefix", type: "text", label: "Command Prefix", default: "!" },
    ],
  },
});

const mockConfigSchemas = new Map<string, any>();
mockConfigSchemas.set("discord", {
  title: "Discord Settings",
  fields: [
    { name: "token", type: "password", label: "Bot Token", required: true },
    { name: "prefix", type: "text", label: "Command Prefix", default: "!" },
  ],
});

const mockLoadedPlugins = new Map<string, any>();
mockLoadedPlugins.set("discord", { plugin: {}, context: {} });

// Mock plugins module
vi.mock("../../src/plugins.js", () => ({
  listPlugins: vi.fn(() => installedPlugins),
  getAllPluginManifests: vi.fn(() => mockManifests),
  readPluginManifest: vi.fn((path: string) => {
    if (path.includes("discord")) return mockManifests.get("discord");
    return undefined;
  }),
  getLoadedPlugin: vi.fn((name: string) => mockLoadedPlugins.get(name)),
  getConfigSchemas: vi.fn(() => mockConfigSchemas),
  installPlugin: vi.fn(async (source: string) => ({
    name: source,
    version: "1.0.0",
    description: `${source} plugin`,
    source: "npm",
    path: `/plugins/${source}`,
    enabled: false,
    installedAt: Date.now(),
  })),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  loadPlugin: vi.fn(async () => ({})),
  unloadPlugin: vi.fn(async () => {}),
  removePlugin: vi.fn(async () => true),
}));

let app: Hono;

beforeEach(async () => {
  vi.clearAllMocks();
  // Reset config state
  Object.keys(mockConfig).forEach((k) => delete mockConfig[k]);

  const { instancePluginsRouter } = await import("../../src/daemon/routes/instance-plugins.js");
  app = new Hono();
  app.route("/api/instances/:id/plugins", instancePluginsRouter);
});

describe("GET /api/instances/:id/plugins", () => {
  it("should list installed plugins with manifest metadata", async () => {
    const res = await app.request("/api/instances/my-instance/plugins");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.plugins).toHaveLength(2);

    const discord = body.plugins.find((p: any) => p.name === "discord");
    expect(discord).toBeDefined();
    expect(discord.enabled).toBe(true);
    expect(discord.loaded).toBe(true);
    expect(discord.manifest).toBeDefined();
    expect(discord.manifest.capabilities).toEqual(["channel"]);
    expect(discord.manifest.category).toBe("channel");

    const openai = body.plugins.find((p: any) => p.name === "openai");
    expect(openai).toBeDefined();
    expect(openai.enabled).toBe(false);
    expect(openai.loaded).toBe(false);
  });

  it("should reject invalid instance ID", async () => {
    const res = await app.request("/api/instances/bad%20id!/plugins");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/instances/:id/plugins", () => {
  it("should install a plugin", async () => {
    const res = await app.request("/api/instances/my-instance/plugins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "slack" }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.installed).toBe(true);
    expect(body.plugin.name).toBe("slack");
    expect(body.plugin.enabled).toBe(true);
    expect(body.plugin.loaded).toBe(true);
  });

  it("should reject empty source", async () => {
    const res = await app.request("/api/instances/my-instance/plugins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("should reject dangerous plugin names", async () => {
    const res = await app.request("/api/instances/my-instance/plugins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "foo;rm -rf /" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/instances/:id/plugins/:name", () => {
  it("should uninstall a plugin", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/discord", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.removed).toBe(true);
    expect(body.unloaded).toBe(true);
  });

  it("should reject invalid plugin name", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/..%2F..%2Fetc", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/instances/:id/plugins/:name/enable", () => {
  it("should enable a plugin", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/openai/enable", {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.loaded).toBe(true);
  });

  it("should return 404 for non-existent plugin", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/nonexistent/enable", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/instances/:id/plugins/:name/disable", () => {
  it("should disable a plugin", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/discord/disable", {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.disabled).toBe(true);
    expect(body.unloaded).toBe(true);
  });
});

describe("GET /api/instances/:id/plugins/:name/config", () => {
  it("should return plugin config and schema", async () => {
    mockConfig.plugins = { data: { discord: { token: "secret", prefix: "!" } } };

    const res = await app.request("/api/instances/my-instance/plugins/discord/config");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("discord");
    expect(body.config.token).toBe("secret");
    expect(body.config.prefix).toBe("!");
    expect(body.configSchema).toBeDefined();
    expect(body.configSchema.title).toBe("Discord Settings");
  });

  it("should return 404 for non-existent plugin", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/nonexistent/config");
    expect(res.status).toBe(404);
  });

  it("should return empty config if none set", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/discord/config");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.config).toEqual({});
  });
});

describe("PUT /api/instances/:id/plugins/:name/config", () => {
  it("should update plugin config", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/discord/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { token: "new-token", prefix: "?" } }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.updated).toBe(true);
    expect(body.config.token).toBe("new-token");
    expect(body.config.prefix).toBe("?");
  });

  it("should reject invalid body (missing config key)", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/discord/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("should validate required fields against schema", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/discord/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { prefix: "!" } }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe("Config validation failed");
    expect(body.details).toContain('Field "token" is required');
  });

  it("should return 404 for non-existent plugin", async () => {
    const res = await app.request("/api/instances/my-instance/plugins/nonexistent/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { key: "value" } }),
    });
    expect(res.status).toBe(404);
  });
});
