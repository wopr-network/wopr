/**
 * Capability Activation API Tests (WOP-504)
 *
 * Tests for src/daemon/routes/capabilities.ts covering:
 * - GET  /api/capabilities           — List capabilities + activation status
 * - POST /api/capabilities/activate  — Zero-click capability activation
 * - POST /api/capabilities/deactivate — Deactivate a capability
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Mock rate limiter to bypass rate limiting in tests
vi.mock("hono-rate-limiter", () => ({
  rateLimiter: () => async (_c: any, next: () => Promise<void>) => next(),
}));

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
    getValue: vi.fn((key: string) => {
      const parts = key.split(".");
      let obj: any = mockConfig;
      for (const part of parts) {
        if (!obj || typeof obj !== "object") return undefined;
        obj = obj[part];
      }
      return obj;
    }),
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
let installedPlugins: any[] = [];
let loadedPlugins: Map<string, any>;

vi.mock("../../src/plugins.js", async (importOriginal) => {
  return {
    listPlugins: vi.fn(async () => installedPlugins),
    getLoadedPlugin: vi.fn((name: string) => loadedPlugins.get(name)),
    installPlugin: vi.fn(async (source: string) => {
      // Extract plugin name from github source
      const name = source.startsWith("github:") ? source.split("/").pop()! : source;
      const plugin = {
        name,
        version: "1.0.0",
        description: `${name} plugin`,
        source: "github" as const,
        path: `/plugins/${name}`,
        enabled: false,
        installedAt: Date.now(),
      };
      installedPlugins.push(plugin);
      return plugin;
    }),
    enablePlugin: vi.fn(async (name: string) => {
      const plugin = installedPlugins.find((p) => p.name === name);
      if (plugin) plugin.enabled = true;
    }),
    disablePlugin: vi.fn(async (name: string) => {
      const plugin = installedPlugins.find((p) => p.name === name);
      if (plugin) plugin.enabled = false;
    }),
    loadPlugin: vi.fn(async (plugin: any) => {
      loadedPlugins.set(plugin.name, { plugin, context: {} });
    }),
    unloadPlugin: vi.fn(async (name: string) => {
      loadedPlugins.delete(name);
    }),
    // Capability catalog — use real implementation
    getCapabilityCatalogEntry: (await importOriginal() as any).getCapabilityCatalogEntry,
    listCapabilityCatalog: (await importOriginal() as any).listCapabilityCatalog,
  };
});

// Also mock the direct capability-catalog import (used by the router)
vi.mock("../../src/core/capability-catalog.js", async (importOriginal) => {
  return importOriginal();
});

let app: Hono;

beforeEach(async () => {
  vi.clearAllMocks();

  // Reset state
  installedPlugins = [];
  loadedPlugins = new Map();
  Object.keys(mockConfig).forEach((k) => delete mockConfig[k]);

  const { capabilitiesRouter } = await import("../../src/daemon/routes/capabilities.js");
  app = new Hono();
  app.route("/api/capabilities", capabilitiesRouter);
});

// ============================================================================
// GET /api/capabilities
// ============================================================================

describe("GET /api/capabilities", () => {
  it("returns all capabilities with active=false when no plugins installed", async () => {
    const res = await app.request("/api/capabilities");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.capabilities).toHaveLength(4);

    for (const cap of body.capabilities) {
      expect(cap.active).toBe(false);
    }

    const voice = body.capabilities.find((c: any) => c.id === "voice");
    expect(voice).toBeDefined();
    expect(voice.label).toBe("Voice");
    expect(voice.plugins).toHaveLength(2);
    expect(voice.plugins.every((p: any) => !p.installed)).toBe(true);
  });

  it("returns voice as active when both voice plugins installed, enabled, and loaded", async () => {
    // Set up voice plugins as installed + enabled + loaded
    installedPlugins = [
      {
        name: "wopr-plugin-voice-chatterbox",
        version: "1.0.0",
        source: "github" as const,
        path: "/plugins/wopr-plugin-voice-chatterbox",
        enabled: true,
        installedAt: Date.now(),
      },
      {
        name: "wopr-plugin-voice-whisper",
        version: "1.0.0",
        source: "github" as const,
        path: "/plugins/wopr-plugin-voice-whisper",
        enabled: true,
        installedAt: Date.now(),
      },
    ];
    loadedPlugins.set("wopr-plugin-voice-chatterbox", { plugin: {}, context: {} });
    loadedPlugins.set("wopr-plugin-voice-whisper", { plugin: {}, context: {} });

    const res = await app.request("/api/capabilities");
    const body = await res.json();

    const voice = body.capabilities.find((c: any) => c.id === "voice");
    expect(voice.active).toBe(true);
    expect(voice.plugins.every((p: any) => p.installed && p.enabled && p.loaded)).toBe(true);

    // image-gen should still be inactive
    const imageGen = body.capabilities.find((c: any) => c.id === "image-gen");
    expect(imageGen.active).toBe(false);
  });

  it("returns voice as inactive when TTS installed but STT missing", async () => {
    // Only TTS installed
    installedPlugins = [
      {
        name: "wopr-plugin-voice-chatterbox",
        version: "1.0.0",
        source: "github" as const,
        path: "/plugins/wopr-plugin-voice-chatterbox",
        enabled: true,
        installedAt: Date.now(),
      },
    ];
    loadedPlugins.set("wopr-plugin-voice-chatterbox", { plugin: {}, context: {} });

    const res = await app.request("/api/capabilities");
    const body = await res.json();

    const voice = body.capabilities.find((c: any) => c.id === "voice");
    expect(voice.active).toBe(false);

    const tts = voice.plugins.find((p: any) => p.name === "wopr-plugin-voice-chatterbox");
    const stt = voice.plugins.find((p: any) => p.name === "wopr-plugin-voice-whisper");
    expect(tts.installed).toBe(true);
    expect(stt.installed).toBe(false);
  });
});

// ============================================================================
// POST /api/capabilities/activate
// ============================================================================

describe("POST /api/capabilities/activate — happy path", () => {
  it("activates voice: installs TTS + STT, configures, loads, returns message", async () => {
    const res = await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "voice" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.activated).toBe(true);
    expect(body.capability).toBe("voice");
    expect(body.message).toBe("Voice activated! 🎙️");
    expect(body.plugins).toHaveLength(2);

    const pluginNames = body.plugins.map((p: any) => p.name);
    expect(pluginNames).toContain("wopr-plugin-voice-chatterbox");
    expect(pluginNames).toContain("wopr-plugin-voice-whisper");
  });

  it("installs plugins with correct GitHub sources", async () => {
    const { installPlugin } = await import("../../src/plugins.js");

    await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "voice" }),
    });

    expect(installPlugin).toHaveBeenCalledWith("github:wopr-network/wopr-plugin-voice-chatterbox");
    expect(installPlugin).toHaveBeenCalledWith("github:wopr-network/wopr-plugin-voice-whisper");
  });

  it("enables and loads each plugin after install", async () => {
    const { enablePlugin, loadPlugin } = await import("../../src/plugins.js");

    await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "image-gen" }),
    });

    expect(enablePlugin).toHaveBeenCalledWith("wopr-plugin-image-sdxl");
    expect(loadPlugin).toHaveBeenCalled();
  });

  it("writes WOPR-hosted config with baseUrl api.wopr.bot", async () => {
    const { config: centralConfig } = await import("../../src/core/config.js");

    await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "image-gen" }),
    });

    expect(centralConfig.save).toHaveBeenCalled();
    // Config should have been written for the plugin
    const pluginData = mockConfig?.plugins?.data;
    expect(pluginData).toBeDefined();
    expect(pluginData["wopr-plugin-image-sdxl"]).toBeDefined();
    expect(pluginData["wopr-plugin-image-sdxl"].baseUrl).toBe("https://api.wopr.bot");
  });

  it("calls providerRegistry.checkHealth after all plugins loaded", async () => {
    const { providerRegistry } = await import("../../src/core/providers.js");

    await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "embeddings" }),
    });

    expect(providerRegistry.checkHealth).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/capabilities/activate — already active", () => {
  it("returns alreadyActive=true without reinstalling", async () => {
    // Pre-install and load both voice plugins
    installedPlugins = [
      {
        name: "wopr-plugin-voice-chatterbox",
        version: "1.0.0",
        source: "github" as const,
        path: "/plugins/wopr-plugin-voice-chatterbox",
        enabled: true,
        installedAt: Date.now(),
      },
      {
        name: "wopr-plugin-voice-whisper",
        version: "1.0.0",
        source: "github" as const,
        path: "/plugins/wopr-plugin-voice-whisper",
        enabled: true,
        installedAt: Date.now(),
      },
    ];
    loadedPlugins.set("wopr-plugin-voice-chatterbox", { plugin: {}, context: {} });
    loadedPlugins.set("wopr-plugin-voice-whisper", { plugin: {}, context: {} });

    const { installPlugin } = await import("../../src/plugins.js");

    const res = await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "voice" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.activated).toBe(true);
    expect(body.alreadyActive).toBe(true);
    expect(installPlugin).not.toHaveBeenCalled();
  });
});

describe("POST /api/capabilities/activate — partially installed", () => {
  it("only installs missing plugins, loads both", async () => {
    // TTS already installed + loaded, STT missing
    installedPlugins = [
      {
        name: "wopr-plugin-voice-chatterbox",
        version: "1.0.0",
        source: "github" as const,
        path: "/plugins/wopr-plugin-voice-chatterbox",
        enabled: true,
        installedAt: Date.now(),
      },
    ];
    loadedPlugins.set("wopr-plugin-voice-chatterbox", { plugin: {}, context: {} });

    const { installPlugin, loadPlugin } = await import("../../src/plugins.js");

    const res = await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "voice" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.activated).toBe(true);

    // Should only install the missing STT plugin
    expect(installPlugin).toHaveBeenCalledTimes(1);
    expect(installPlugin).toHaveBeenCalledWith("github:wopr-network/wopr-plugin-voice-whisper");

    // loadPlugin called for the newly-installed STT plugin (TTS is already loaded)
    expect(loadPlugin).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/capabilities/activate — validation", () => {
  it("returns 404 for unknown capability", async () => {
    const res = await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "mind-reading" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toMatch(/Unknown capability/);
  });

  it("returns 400 when capability field is missing", async () => {
    const res = await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when capability is empty string", async () => {
    const res = await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/capabilities/activate — plugin install failure", () => {
  it("returns 500 when all plugins fail to install", async () => {
    const { installPlugin } = await import("../../src/plugins.js");
    vi.mocked(installPlugin).mockRejectedValue(new Error("Network error"));

    const res = await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "image-gen" }),
    });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.activated).toBe(false);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0].error).toMatch(/Network error/);
  });

  it("returns activated=true with errors when some plugins succeed", async () => {
    const { installPlugin } = await import("../../src/plugins.js");

    // First call (TTS) succeeds, second call (STT) fails
    let callCount = 0;
    vi.mocked(installPlugin).mockImplementation(async (source: string) => {
      callCount++;
      if (callCount === 2) throw new Error("STT install failed");
      const name = source.startsWith("github:") ? source.split("/").pop()! : source;
      const plugin = {
        name,
        version: "1.0.0",
        source: "github" as const,
        path: `/plugins/${name}`,
        enabled: false,
        installedAt: Date.now(),
      };
      installedPlugins.push(plugin);
      return plugin;
    });

    const res = await app.request("/api/capabilities/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "voice" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.activated).toBe(true);
    expect(body.plugins).toHaveLength(1); // TTS succeeded
    expect(body.errors).toHaveLength(1);  // STT failed
    expect(body.errors[0].error).toMatch(/STT install failed/);
  });
});

// ============================================================================
// POST /api/capabilities/deactivate
// ============================================================================

describe("POST /api/capabilities/deactivate — happy path", () => {
  it("unloads and disables all plugins for the capability", async () => {
    const { unloadPlugin, disablePlugin } = await import("../../src/plugins.js");

    const res = await app.request("/api/capabilities/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "voice" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deactivated).toBe(true);
    expect(body.capability).toBe("voice");
    expect(body.plugins).toContain("wopr-plugin-voice-chatterbox");
    expect(body.plugins).toContain("wopr-plugin-voice-whisper");

    expect(unloadPlugin).toHaveBeenCalledWith("wopr-plugin-voice-chatterbox");
    expect(unloadPlugin).toHaveBeenCalledWith("wopr-plugin-voice-whisper");
    expect(disablePlugin).toHaveBeenCalledWith("wopr-plugin-voice-chatterbox");
    expect(disablePlugin).toHaveBeenCalledWith("wopr-plugin-voice-whisper");
  });
});

describe("POST /api/capabilities/deactivate — unknown capability", () => {
  it("returns 404 for unknown capability", async () => {
    const res = await app.request("/api/capabilities/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "teleportation" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toMatch(/Unknown capability/);
  });
});

describe("POST /api/capabilities/deactivate — partial failure", () => {
  it("returns deactivated=true with errors when one plugin fails to unload", async () => {
    const { unloadPlugin } = await import("../../src/plugins.js");

    // First plugin (TTS) fails to unload, second (STT) succeeds
    let callCount = 0;
    vi.mocked(unloadPlugin).mockImplementation(async (name: string) => {
      callCount++;
      if (callCount === 1) throw new Error("Unload timeout");
    });

    const res = await app.request("/api/capabilities/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "voice" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deactivated).toBe(true);
    expect(body.plugins).toHaveLength(1); // STT succeeded
    expect(body.errors).toHaveLength(1);  // TTS failed
    expect(body.errors[0].error).toMatch(/Unload timeout/);
  });
});
