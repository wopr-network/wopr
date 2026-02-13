/**
 * Instance Templates — preconfigured plugin sets for common use cases (WOP-200)
 *
 * Defines the InstanceTemplate interface and built-in templates that ship with WOPR.
 * Custom templates are stored in-memory at runtime and managed via the templates API.
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
