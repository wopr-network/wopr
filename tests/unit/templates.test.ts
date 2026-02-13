/**
 * Instance Templates Tests (WOP-200)
 *
 * Tests for template definitions, CRUD, application engine, and built-in protection.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  applyTemplate,
  BUILTIN_TEMPLATES,
  BUILTIN_TEMPLATE_NAMES,
  clearCustomTemplates,
  createCustomTemplate,
  deleteCustomTemplate,
  getTemplate,
  type InstanceTemplate,
  isBuiltinTemplate,
  listTemplates,
} from "../../src/daemon/templates.js";

// Clean up custom templates after each test
afterEach(() => {
  clearCustomTemplates();
});

// ============================================================================
// Built-in Templates
// ============================================================================

describe("BUILTIN_TEMPLATES", () => {
  it("should include exactly 5 built-in templates", () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(5);
  });

  it("should include discord-bot, slack-bot, multi-channel, developer, minimal", () => {
    const names = BUILTIN_TEMPLATES.map((t) => t.name);
    expect(names).toContain("discord-bot");
    expect(names).toContain("slack-bot");
    expect(names).toContain("multi-channel");
    expect(names).toContain("developer");
    expect(names).toContain("minimal");
  });

  it("each template should have required fields", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(Array.isArray(template.plugins)).toBe(true);
      expect(Array.isArray(template.providers)).toBe(true);
      expect(typeof template.config).toBe("object");
      expect(Array.isArray(template.tags)).toBe(true);
    }
  });

  it("minimal template should have no plugins or providers", () => {
    const minimal = BUILTIN_TEMPLATES.find((t) => t.name === "minimal");
    expect(minimal).toBeDefined();
    expect(minimal!.plugins).toHaveLength(0);
    expect(minimal!.providers).toHaveLength(0);
  });

  it("discord-bot template should include Discord plugin and Anthropic provider", () => {
    const discordBot = BUILTIN_TEMPLATES.find((t) => t.name === "discord-bot");
    expect(discordBot).toBeDefined();
    expect(discordBot!.plugins).toContain("@wopr-network/plugin-discord");
    expect(discordBot!.providers).toContain("@wopr-network/provider-anthropic");
  });

  it("multi-channel template should include multiple channel plugins", () => {
    const multi = BUILTIN_TEMPLATES.find((t) => t.name === "multi-channel");
    expect(multi).toBeDefined();
    expect(multi!.plugins.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// Template Listing and Retrieval
// ============================================================================

describe("listTemplates", () => {
  it("should return built-in templates when no custom templates exist", () => {
    const templates = listTemplates();
    expect(templates).toHaveLength(BUILTIN_TEMPLATES.length);
  });

  it("should include custom templates alongside built-in", () => {
    createCustomTemplate({
      name: "custom-one",
      description: "Custom template",
      plugins: [],
      providers: [],
      config: {},
      tags: ["custom"],
    });

    const templates = listTemplates();
    expect(templates).toHaveLength(BUILTIN_TEMPLATES.length + 1);
    expect(templates.find((t) => t.name === "custom-one")).toBeDefined();
  });
});

describe("getTemplate", () => {
  it("should return a built-in template by name", () => {
    const template = getTemplate("discord-bot");
    expect(template).toBeDefined();
    expect(template!.name).toBe("discord-bot");
  });

  it("should return a custom template by name", () => {
    createCustomTemplate({
      name: "my-custom",
      description: "My custom template",
      plugins: ["some-plugin"],
      providers: [],
      config: {},
      tags: [],
    });

    const template = getTemplate("my-custom");
    expect(template).toBeDefined();
    expect(template!.description).toBe("My custom template");
  });

  it("should return undefined for nonexistent template", () => {
    expect(getTemplate("nonexistent")).toBeUndefined();
  });
});

describe("isBuiltinTemplate", () => {
  it("should return true for built-in template names", () => {
    expect(isBuiltinTemplate("discord-bot")).toBe(true);
    expect(isBuiltinTemplate("minimal")).toBe(true);
  });

  it("should return false for custom or nonexistent templates", () => {
    expect(isBuiltinTemplate("my-custom")).toBe(false);
    expect(isBuiltinTemplate("nonexistent")).toBe(false);
  });
});

// ============================================================================
// Custom Template CRUD
// ============================================================================

describe("createCustomTemplate", () => {
  it("should create a custom template", () => {
    createCustomTemplate({
      name: "test-template",
      description: "Test",
      plugins: [],
      providers: [],
      config: {},
      tags: [],
    });

    expect(getTemplate("test-template")).toBeDefined();
  });

  it("should throw when trying to overwrite a built-in template", () => {
    expect(() =>
      createCustomTemplate({
        name: "discord-bot",
        description: "Overwrite attempt",
        plugins: [],
        providers: [],
        config: {},
        tags: [],
      }),
    ).toThrow('Cannot overwrite built-in template "discord-bot"');
  });

  it("should allow overwriting a custom template", () => {
    createCustomTemplate({
      name: "updatable",
      description: "Version 1",
      plugins: [],
      providers: [],
      config: {},
      tags: [],
    });

    createCustomTemplate({
      name: "updatable",
      description: "Version 2",
      plugins: ["new-plugin"],
      providers: [],
      config: {},
      tags: [],
    });

    const template = getTemplate("updatable");
    expect(template!.description).toBe("Version 2");
    expect(template!.plugins).toEqual(["new-plugin"]);
  });
});

describe("deleteCustomTemplate", () => {
  it("should delete a custom template", () => {
    createCustomTemplate({
      name: "to-delete",
      description: "Will be deleted",
      plugins: [],
      providers: [],
      config: {},
      tags: [],
    });

    expect(deleteCustomTemplate("to-delete")).toBe(true);
    expect(getTemplate("to-delete")).toBeUndefined();
  });

  it("should return false for nonexistent custom template", () => {
    expect(deleteCustomTemplate("nonexistent")).toBe(false);
  });

  it("should throw when trying to delete a built-in template", () => {
    expect(() => deleteCustomTemplate("discord-bot")).toThrow('Cannot delete built-in template "discord-bot"');
  });

  it("should throw for every built-in template name", () => {
    for (const name of BUILTIN_TEMPLATE_NAMES) {
      expect(() => deleteCustomTemplate(name)).toThrow("Cannot delete built-in template");
    }
  });
});

// ============================================================================
// Template Application Engine
// ============================================================================

describe("applyTemplate", () => {
  it("should generate config from a built-in template", () => {
    const result = applyTemplate("instance-1", "discord-bot");

    expect(result.instanceId).toBe("instance-1");
    expect(result.templateName).toBe("discord-bot");
    expect(result.pluginsToInstall).toContain("@wopr-network/plugin-discord");
    expect(result.providersToSetup).toContain("@wopr-network/provider-anthropic");
  });

  it("should include instanceId and templateName in generated config", () => {
    const result = applyTemplate("my-instance", "minimal");

    expect(result.config.instanceId).toBe("my-instance");
    expect(result.config.templateName).toBe("minimal");
  });

  it("should generate empty plugin/provider lists for minimal template", () => {
    const result = applyTemplate("bare", "minimal");

    expect(result.pluginsToInstall).toHaveLength(0);
    expect(result.providersToSetup).toHaveLength(0);
  });

  it("should throw for nonexistent template", () => {
    expect(() => applyTemplate("instance-1", "nonexistent")).toThrow('Template "nonexistent" not found');
  });

  it("should generate config with plugin entries", () => {
    const result = applyTemplate("test-inst", "discord-bot");
    const plugins = result.config.plugins as Record<string, unknown>;

    expect(plugins["@wopr-network/plugin-discord"]).toEqual({});
    expect(plugins["@wopr-network/plugin-memory-semantic"]).toEqual({});
  });

  it("should generate config with provider entries", () => {
    const result = applyTemplate("test-inst", "slack-bot");
    const providers = result.config.providers as Record<string, unknown>;

    expect(providers["@wopr-network/provider-anthropic"]).toEqual({});
  });

  it("should apply a custom template", () => {
    createCustomTemplate({
      name: "my-template",
      description: "Custom template",
      plugins: ["plugin-a", "plugin-b"],
      providers: ["provider-x"],
      config: { custom: true },
      tags: ["test"],
    });

    const result = applyTemplate("inst-2", "my-template");

    expect(result.pluginsToInstall).toEqual(["plugin-a", "plugin-b"]);
    expect(result.providersToSetup).toEqual(["provider-x"]);
    expect(result.config.custom).toBe(true);
  });

  it("should merge template base config into generated config", () => {
    const result = applyTemplate("inst-3", "discord-bot");
    const daemon = result.config.daemon as Record<string, unknown>;

    expect(daemon.cronScriptsEnabled).toBe(false);
  });
});
