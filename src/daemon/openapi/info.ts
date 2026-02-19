/**
 * OpenAPI document metadata for the WOPR Daemon API.
 */
export const openApiDocumentation = {
  info: {
    title: "WOPR Daemon API",
    version: "1.2.0",
    description:
      "REST API for WOPR daemon — manage sessions, plugins, providers, instances, capabilities, and more. Supports WebSocket for real-time streaming. Note: plugin-provided routes (skills, crons, canvas) are mounted dynamically and do not appear in this spec.",
    contact: {
      name: "WOPR",
      url: "https://wopr.bot",
    },
    license: {
      name: "MIT",
    },
  },
  servers: [
    {
      url: "http://localhost:7437",
      description: "Local daemon",
    },
    {
      url: "https://{subdomain}.wopr.bot",
      description: "Hosted instance",
      variables: {
        subdomain: {
          default: "your-bot",
          description: "Your bot's subdomain",
        },
      },
    },
  ],
  tags: [
    { name: "Auth", description: "Authentication (OAuth, API keys)" },
    { name: "Sessions", description: "Session lifecycle and message injection" },
    { name: "Plugins", description: "Plugin install, enable, disable, config" },
    { name: "Providers", description: "AI provider credentials and health" },
    { name: "Instances", description: "Instance CRUD and lifecycle" },
    { name: "Capabilities", description: "Capability activation and health" },
    { name: "Marketplace", description: "Plugin discovery and metadata" },
    { name: "Templates", description: "Instance templates" },
    { name: "Config", description: "Daemon configuration" },
    { name: "Observability", description: "Metrics, logs, and health" },
    { name: "API Keys", description: "API key management (WOP-209)" },
    { name: "OpenAI Compatible", description: "OpenAI-compatible /v1/* endpoints" },
    { name: "Hooks", description: "Plugin hooks and context providers" },
    { name: "Health", description: "Health checks and readiness" },
    { name: "Daemon", description: "Daemon restart and management" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http" as const,
        scheme: "bearer",
        description: "Daemon bearer token (from ~/.wopr/token) or wopr_ prefixed API key",
      },
    },
  },
  security: [{ bearerAuth: [] }],
};
