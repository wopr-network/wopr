/**
 * Instance Templates — preconfigured plugin sets for common use cases (WOP-200)
 *
 * Defines the InstanceTemplate interface, built-in templates, CRUD operations,
 * and the template application engine.
 *
 * Inlined from src/platform/templates.ts and src/platform/template-engine.ts
 * as part of WOP-297 (extract platform code from core).
 */

export interface InstanceTemplate {
  name: string;
  description: string;
  plugins: string[];
  providers: string[];
  config: Record<string, unknown>;
  tags: string[];
}

/**
 * Built-in templates that ship with WOPR.
 * These cannot be deleted or overwritten via the API.
 */
export const BUILTIN_TEMPLATES: readonly InstanceTemplate[] = [
  {
    name: "discord-bot",
    description: "Discord AI assistant with semantic memory",
    plugins: ["@wopr-network/plugin-discord", "@wopr-network/plugin-memory-semantic"],
    providers: ["@wopr-network/provider-anthropic"],
    config: {
      daemon: { cronScriptsEnabled: false },
    },
    tags: ["discord", "chat", "memory"],
  },
  {
    name: "slack-bot",
    description: "Slack AI assistant with semantic memory",
    plugins: ["@wopr-network/plugin-slack", "@wopr-network/plugin-memory-semantic"],
    providers: ["@wopr-network/provider-anthropic"],
    config: {
      daemon: { cronScriptsEnabled: false },
    },
    tags: ["slack", "chat", "memory"],
  },
  {
    name: "multi-channel",
    description: "Multi-channel bot with Discord, Slack, and WhatsApp support",
    plugins: [
      "@wopr-network/plugin-discord",
      "@wopr-network/plugin-slack",
      "@wopr-network/plugin-whatsapp",
      "@wopr-network/plugin-memory-semantic",
    ],
    providers: ["@wopr-network/provider-anthropic"],
    config: {
      daemon: { cronScriptsEnabled: false },
    },
    tags: ["discord", "slack", "whatsapp", "multi-channel", "memory"],
  },
  {
    name: "developer",
    description: "Developer assistant with Discord, GitHub, browser, and web search",
    plugins: [
      "@wopr-network/plugin-discord",
      "@wopr-network/plugin-github",
      "@wopr-network/plugin-memory-semantic",
      "@wopr-network/plugin-browser",
      "@wopr-network/plugin-web-search",
    ],
    providers: ["@wopr-network/provider-anthropic"],
    config: {
      daemon: { cronScriptsEnabled: false },
    },
    tags: ["developer", "github", "browser", "search", "discord"],
  },
  {
    name: "minimal",
    description: "Bare WOPR instance with no plugins or providers",
    plugins: [],
    providers: [],
    config: {},
    tags: ["minimal", "bare"],
  },
] as const;

/** Set of built-in template names for quick lookup. */
export const BUILTIN_TEMPLATE_NAMES = new Set(BUILTIN_TEMPLATES.map((t) => t.name));

/**
 * In-memory store for custom templates.
 * In a production system this would be persisted to disk or a database.
 */
const customTemplates = new Map<string, InstanceTemplate>();

/** List all templates (built-in + custom). */
export function listTemplates(): InstanceTemplate[] {
  return [...BUILTIN_TEMPLATES, ...customTemplates.values()];
}

/** Get a template by name. Returns undefined if not found. */
export function getTemplate(name: string): InstanceTemplate | undefined {
  const builtin = BUILTIN_TEMPLATES.find((t) => t.name === name);
  if (builtin) return builtin;
  return customTemplates.get(name);
}

/** Create or update a custom template. Throws if name collides with a built-in. */
export function createCustomTemplate(template: InstanceTemplate): void {
  if (BUILTIN_TEMPLATE_NAMES.has(template.name)) {
    throw new Error(`Cannot overwrite built-in template "${template.name}"`);
  }
  customTemplates.set(template.name, template);
}

/** Delete a custom template. Returns true if deleted, false if not found. Throws if built-in. */
export function deleteCustomTemplate(name: string): boolean {
  if (BUILTIN_TEMPLATE_NAMES.has(name)) {
    throw new Error(`Cannot delete built-in template "${name}"`);
  }
  return customTemplates.delete(name);
}

/** Check if a template name belongs to a built-in template. */
export function isBuiltinTemplate(name: string): boolean {
  return BUILTIN_TEMPLATE_NAMES.has(name);
}

/** Clear all custom templates. Useful for testing. */
export function clearCustomTemplates(): void {
  customTemplates.clear();
}

// --- Template Application Engine ---

export interface TemplateApplicationResult {
  instanceId: string;
  templateName: string;
  config: Record<string, unknown>;
  pluginsToInstall: string[];
  providersToSetup: string[];
}

/**
 * Apply a template to an instance. Generates a config object from the template
 * and returns the list of plugins and providers that need to be installed/configured.
 *
 * @param instanceId - The target instance identifier
 * @param templateName - The name of the template to apply
 * @returns The generated configuration and required plugin/provider lists
 * @throws If the template is not found
 */
export function applyTemplate(instanceId: string, templateName: string): TemplateApplicationResult {
  const template = getTemplate(templateName);
  if (!template) {
    throw new Error(`Template "${templateName}" not found`);
  }

  const config: Record<string, unknown> = {
    ...template.config,
    instanceId,
    templateName: template.name,
    plugins: Object.fromEntries(template.plugins.map((p) => [p, {}])),
    providers: Object.fromEntries(template.providers.map((p) => [p, {}])),
  };

  return {
    instanceId,
    templateName: template.name,
    config,
    pluginsToInstall: [...template.plugins],
    providersToSetup: [...template.providers],
  };
}
