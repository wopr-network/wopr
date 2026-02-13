/**
 * Marketplace API Tests (WOP-203)
 *
 * Tests for src/daemon/routes/marketplace.ts covering:
 * - GET /api/marketplace              — Browse available plugins
 * - GET /api/marketplace/:name        — Plugin detail
 * - GET /api/marketplace/:name/schema — ConfigSchema for dynamic UI generation
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

// Test data
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

const discordManifest = {
  name: "discord",
  version: "1.0.0",
  description: "Discord channel plugin for WOPR",
  author: "WOPR Team",
  license: "MIT",
  homepage: "https://github.com/wopr-network/wopr-plugin-discord",
  repository: "https://github.com/wopr-network/wopr-plugin-discord",
  icon: ":speech_balloon:",
  capabilities: ["channel"],
  category: "channel",
  tags: ["discord", "chat", "messaging"],
  requires: {
    env: ["DISCORD_TOKEN"],
    node: ">=22.0.0",
  },
  install: [
    { kind: "manual", instructions: "Set DISCORD_TOKEN in environment" },
  ],
  setup: [
    {
      id: "token",
      title: "Discord Bot Token",
      description: "Enter your Discord bot token",
      fields: {
        title: "Bot Token",
        fields: [{ name: "token", type: "password", label: "Token", required: true }],
      },
    },
  ],
  configSchema: {
    title: "Discord Settings",
    fields: [
      { name: "token", type: "password", label: "Bot Token", required: true },
      { name: "prefix", type: "text", label: "Command Prefix", default: "!" },
    ],
  },
  dependencies: null,
  conflicts: null,
  minCoreVersion: "1.0.0",
  lifecycle: { hotReload: true, shutdownBehavior: "graceful" },
};

const mockManifests = new Map<string, any>();
mockManifests.set("discord", discordManifest);

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
  searchPlugins: vi.fn(async (query: string) => {
    const all = [
      {
        name: "wopr-plugin-slack",
        description: "Slack integration",
        source: "npm",
        version: "0.5.0",
        installed: false,
      },
      {
        name: "wopr-plugin-telegram",
        description: "Telegram integration",
        source: "npm",
        version: "0.3.0",
        installed: false,
      },
    ];
    if (!query) return all;
    return all.filter(
      (p) => p.name.includes(query) || p.description?.includes(query),
    );
  }),
}));

// Mock requirements checker
vi.mock("../../src/plugins/requirements.js", () => ({
  checkRequirements: vi.fn(async () => ({
    satisfied: false,
    missing: { bins: [], env: ["DISCORD_TOKEN"], docker: [], config: [] },
    available: { bins: [], env: [], docker: [], config: [] },
  })),
}));

let app: Hono;

beforeEach(async () => {
  vi.clearAllMocks();

  const { marketplaceRouter } = await import("../../src/daemon/routes/marketplace.js");
  app = new Hono();
  app.route("/api/marketplace", marketplaceRouter);
});

describe("GET /api/marketplace", () => {
  it("should list installed + discoverable plugins", async () => {
    const res = await app.request("/api/marketplace");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.plugins).toBeDefined();

    const discord = body.plugins.find((p: any) => p.name === "discord");
    expect(discord).toBeDefined();
    expect(discord.installed).toBe(true);
    expect(discord.manifest).toBeDefined();
    expect(discord.manifest.capabilities).toEqual(["channel"]);
  });

  it("should include remote plugins from search", async () => {
    const res = await app.request("/api/marketplace");
    const body = await res.json();

    const slack = body.plugins.find((p: any) => p.name === "wopr-plugin-slack");
    expect(slack).toBeDefined();
    expect(slack.installed).toBe(false);
    expect(slack.source).toBe("npm");
  });

  it("should filter by search query", async () => {
    const res = await app.request("/api/marketplace?q=discord");
    const body = await res.json();

    expect(body.plugins.some((p: any) => p.name === "discord")).toBe(true);
  });

  it("should filter by category", async () => {
    const res = await app.request("/api/marketplace?category=channel");
    const body = await res.json();

    // Only discord has category=channel in our manifests
    const names = body.plugins.map((p: any) => p.name);
    expect(names).toContain("discord");
    // openai has no manifest so won't match category filter
    expect(names).not.toContain("openai");
  });

  it("should filter by capability", async () => {
    const res = await app.request("/api/marketplace?capability=channel");
    const body = await res.json();

    const names = body.plugins.map((p: any) => p.name);
    expect(names).toContain("discord");
  });

  it("should respect limit parameter", async () => {
    const res = await app.request("/api/marketplace?limit=1");
    const body = await res.json();

    expect(body.plugins).toHaveLength(1);
  });
});

describe("GET /api/marketplace/:name", () => {
  it("should return full plugin details with manifest", async () => {
    const res = await app.request("/api/marketplace/discord");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("discord");
    expect(body.version).toBe("1.0.0");
    expect(body.capabilities).toEqual(["channel"]);
    expect(body.category).toBe("channel");
    expect(body.author).toBe("WOPR Team");
    expect(body.license).toBe("MIT");
    expect(body.requires).toBeDefined();
    expect(body.requirementsStatus).toBeDefined();
    expect(body.requirementsStatus.satisfied).toBe(false);
    expect(body.requirementsStatus.missing.env).toContain("DISCORD_TOKEN");
    expect(body.configSchema).toBeDefined();
    expect(body.setup).toBeDefined();
    expect(body.install).toBeDefined();
    expect(body.lifecycle).toBeDefined();
    expect(body.installed).toBe(true);
    expect(body.loaded).toBe(true);
  });

  it("should return 404 for unknown plugin", async () => {
    const res = await app.request("/api/marketplace/nonexistent");
    expect(res.status).toBe(404);
  });

  it("should handle plugin without manifest", async () => {
    const res = await app.request("/api/marketplace/openai");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("openai");
    expect(body.manifest).toBeNull();
    expect(body.installed).toBe(true);
  });
});

describe("GET /api/marketplace/:name/schema", () => {
  it("should return config schema for a plugin", async () => {
    const res = await app.request("/api/marketplace/discord/schema");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("discord");
    expect(body.configSchema).toBeDefined();
    expect(body.configSchema.title).toBe("Discord Settings");
    expect(body.configSchema.fields).toHaveLength(2);
    expect(body.configSchema.fields[0].name).toBe("token");
    expect(body.configSchema.fields[0].type).toBe("password");
    expect(body.configSchema.fields[0].required).toBe(true);
  });

  it("should return null schema for plugin without configSchema", async () => {
    const res = await app.request("/api/marketplace/openai/schema");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("openai");
    expect(body.configSchema).toBeNull();
  });

  it("should return 404 for non-existent plugin", async () => {
    const res = await app.request("/api/marketplace/nonexistent/schema");
    expect(res.status).toBe(404);
  });
});
