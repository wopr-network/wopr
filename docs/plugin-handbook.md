# WOPR Plugin Development Handbook

> **Repo:** wopr-network/wopr
> Canonical types live in `src/plugin-types/`. Always import from `@wopr-network/plugin-types`.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Getting Started](#2-getting-started)
3. [Plugin Manifest](#3-plugin-manifest)
4. [Plugin Context (WOPRPluginContext)](#4-plugin-context-woprplugincontext)
5. [Capability Declaration](#5-capability-declaration)
6. [Storage API](#6-storage-api)
7. [Command Registration](#7-command-registration)
8. [A2A (Agent-to-Agent) Tools](#8-a2a-agent-to-agent-tools)
9. [Events and Hooks](#9-events-and-hooks)
10. [Real Examples](#10-real-examples)
11. [Testing](#11-testing)
12. [Publishing](#12-publishing)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Introduction

### What WOPR Plugins Are

WOPR plugins are separate npm packages that extend the WOPR AI bot daemon. They live in independent repositories (always `wopr-network/wopr-plugin-<name>`) and are installed explicitly by users — never bundled into core.

Plugins can connect WOPR to external services, add commands, register capabilities like text-to-speech, provide context to AI conversations, or expose tools to the AI itself.

**Key rules:**
- Plugins are **always separate repos** — never monorepo subdirectories
- Plugins import from `@wopr-network/plugin-types`, not relative paths into core
- Every plugin exports a default `WOPRPlugin` object
- The manifest (in `package.json` under the `wopr` key) is the contract between plugin and platform

### Plugin Categories

| Category | Description | Example |
|----------|-------------|---------|
| `channel` | Message platforms (Discord, Slack, Telegram) | `wopr-plugin-discord` |
| `ai-provider` | AI model providers | `wopr-plugin-provider-openai` |
| `voice` | Speech-to-text or text-to-speech | `wopr-plugin-stt-whisper` |
| `memory` | Persistent memory / RAG | `wopr-plugin-memory` |
| `p2p` | Peer-to-peer networking | `wopr-plugin-p2p` |
| `integration` | Third-party service integrations | `wopr-plugin-github` |
| `utility` | General-purpose tooling | `wopr-plugin-router` |
| `security` | Auth and security features | `wopr-plugin-auth` |
| `analytics` | Usage tracking and analytics | `wopr-plugin-analytics` |
| `developer` | Developer tooling and debugging | `wopr-plugin-devtools` |

### The Business Model

Plugins are **free**. Revenue comes from hosted capabilities that power them. When a plugin declares `requires.capabilities: ["tts"]`, the platform routes the user to set up a TTS provider — which may be a hosted (paid) service. This is why zero-friction plugin activation matters: every extra click is a lost subscription.

---

## 2. Getting Started

### Prerequisites

- Node.js 22+ (the WOPR ecosystem targets `>=22.0.0`)
- TypeScript 5.3+
- A running WOPR daemon for local testing (`wopr daemon start`)
- Git and an npm account for publishing

### Scaffold a New Plugin

The fastest way to start is to clone the reference plugin and adapt it:

```bash
# Clone the reference plugin
git clone https://github.com/wopr-network/wopr-plugin-discord wopr-plugin-myplugin
cd wopr-plugin-myplugin

# Remove git history and reinitialize
rm -rf .git
git init

# Install dependencies
npm install
```

Then update `package.json`:
- Change `name` to `@wopr-network/wopr-plugin-myplugin` (or your npm scope)
- Update `description`, `version`, `author`
- Update the `wopr` manifest block (see Section 3)

### Install Plugin Types

```bash
npm install @wopr-network/plugin-types
```

The plugin-types package is the **only** import you need from the WOPR ecosystem. It exports all interfaces you implement.

### File Structure of a Plugin Repo

```
wopr-plugin-myplugin/
├── package.json          # npm manifest + wopr manifest under "wopr" key
├── tsconfig.json
├── biome.json            # linting (optional, recommended)
├── src/
│   ├── index.ts          # Default export: WOPRPlugin object
│   ├── config.ts         # Config schema definition (optional)
│   ├── handlers.ts       # Event/message handlers (optional)
│   └── types.ts          # Local re-exports from @wopr-network/plugin-types
├── tests/
│   └── index.test.ts
├── docs/
│   ├── CONFIGURATION.md
│   └── TROUBLESHOOTING.md
└── README.md
```

**`src/types.ts`** — local re-export pattern used by the reference plugin:

```typescript
// src/types.ts
export type {
  ChannelAdapter,
  ChannelCommand,
  ChannelCommandContext,
  ChannelProvider,
  ConfigSchema,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";
```

This lets you change the import path once if the package ever moves.

### Minimal Plugin

```typescript
// src/index.ts
import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-myplugin",
  version: "1.0.0",
  description: "My first WOPR plugin",

  async init(ctx: WOPRPluginContext) {
    ctx.log.info("myplugin initialized");
  },

  async shutdown() {
    // Clean up connections, stop listeners, etc.
  },
};

export default plugin;
```

---

## 3. Plugin Manifest

The manifest lives in `package.json` under the `wopr` key. It describes your plugin's identity, capabilities, requirements, and config schema — everything the platform needs to display, install, and configure your plugin **without executing it**.

### Where the Manifest Lives

```jsonc
{
  "name": "@wopr-network/wopr-plugin-myplugin",
  "version": "1.0.0",
  "main": "dist/index.js",
  "type": "module",
  "wopr": {
    // The PluginManifest object lives here
  }
}
```

### Identity Fields (Required)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Package name (e.g., `"@wopr-network/plugin-discord"`) |
| `version` | `string` | yes | Semantic version |
| `description` | `string` | yes | One-line description |
| `author` | `string` | no | Author or org |
| `license` | `string` | no | SPDX identifier (e.g., `"MIT"`) |
| `homepage` | `string` | no | Docs URL |
| `repository` | `string` | no | Source repo URL |
| `icon` | `string` | no | Emoji for UI (e.g., `"🎮"`) |
| `category` | `PluginCategory` | no | Marketplace category (see Section 1) |
| `tags` | `string[]` | no | Search/discovery tags |

### `capabilities` (Required)

Declares what the plugin provides. At least one value is required.

```jsonc
{
  "capabilities": ["channel", "commands"]
}
```

Known capability values:

| Value | Meaning |
|-------|---------|
| `channel` | Connects WOPR to a messaging platform |
| `provider` | AI model provider |
| `stt` | Speech-to-text |
| `tts` | Text-to-speech |
| `context` | Context provider for AI conversations |
| `storage` | Persistent storage backend |
| `memory` | Long-term memory / RAG |
| `auth` | Authentication provider |
| `webhook` | Webhook endpoints |
| `commands` | Adds CLI commands |
| `ui` | Registers dashboard UI components |
| `a2a` | Exposes AI tools (Agent-to-Agent) |
| `p2p` | Peer-to-peer networking |
| `middleware` | Message middleware / hooks |

Any string is valid — the list above is conventional.

### `configSchema`

Defines the settings UI the platform renders without calling `init()`. Fields map 1:1 to what you read via `ctx.getConfig()`.

```jsonc
{
  "configSchema": {
    "title": "My Plugin Settings",
    "description": "Configure my plugin",
    "fields": [
      {
        "name": "apiKey",
        "type": "password",
        "label": "API Key",
        "required": true,
        "secret": true,
        "setupFlow": "paste",
        "description": "Your API key from example.com/keys"
      },
      {
        "name": "region",
        "type": "select",
        "label": "Region",
        "default": "us-east",
        "setupFlow": "none",
        "options": [
          { "value": "us-east", "label": "US East" },
          { "value": "eu-west", "label": "EU West" }
        ]
      },
      {
        "name": "enabled",
        "type": "boolean",
        "label": "Enable feature",
        "default": true,
        "setupFlow": "none"
      }
    ]
  }
}
```

#### ConfigField Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Config key (dot-path safe) |
| `type` | see below | yes | Field type |
| `label` | `string` | yes | Human-readable label |
| `required` | `boolean` | no | Must be set for plugin to work |
| `default` | `unknown` | no | Default value |
| `description` | `string` | no | Help text (supports markdown) |
| `placeholder` | `string` | no | Input placeholder |
| `options` | `{value, label}[]` | no | For `select` type |
| `items` | `ConfigField` | no | For `array` type: schema of each item |
| `fields` | `ConfigField[]` | no | For `object` type: nested fields |
| `setupFlow` | `SetupFlowType` | no | How the platform collects this field |
| `oauthProvider` | `string` | no | For `oauth` flow: provider identifier |
| `pattern` | `string` | no | Regex validation pattern |
| `patternError` | `string` | no | Validation error message |
| `secret` | `boolean` | no | Mask in UI, encrypt at rest |

**Field types:** `text`, `password`, `select`, `checkbox`, `number`, `array`, `boolean`, `object`, `textarea`

#### Setup Flows

The `setupFlow` field tells the platform which UX to render for collecting a field's value:

| Flow | UX | Use For |
|------|----|---------|
| `paste` | Text/password input | API keys, tokens |
| `oauth` | "Connect" button + OAuth redirect | Slack workspace auth |
| `qr` | QR code display + scan confirm | WhatsApp Web pairing |
| `interactive` | Plugin-provided multi-step wizard | Complex setup flows |
| `none` | No input; auto-derived or uses default | Booleans with defaults, auto-detected values |

If omitted, the platform infers `paste` for `text`/`password` fields, and `none` for fields with a default and `required: false`.

### `requires`

Declares what must be present for the plugin to run. The platform checks these before installation.

```jsonc
{
  "requires": {
    "bins": ["ffmpeg"],
    "env": ["MY_API_KEY"],
    "node": ">=22.0.0",
    "os": ["linux", "darwin"],
    "network": {
      "outbound": true,
      "hosts": ["api.example.com"]
    },
    "storage": {
      "persistent": true,
      "estimatedSize": "100MB"
    },
    "capabilities": [
      { "capability": "tts" },
      { "capability": "stt", "optional": true }
    ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `bins` | `string[]` | Binaries checked via `which` |
| `env` | `string[]` | Required environment variables |
| `docker` | `string[]` | Required Docker images |
| `config` | `string[]` | Required config keys (dot-notation) |
| `os` | `("linux"\|"darwin"\|"win32")[]` | Supported OS. Empty = all. |
| `node` | `string` | Node.js semver range |
| `network.outbound` | `boolean` | Makes outbound HTTP/WS calls |
| `network.inbound` | `boolean` | Listens on ports |
| `network.p2p` | `boolean` | Uses Hyperswarm P2P |
| `network.ports` | `number[]` | Ports the plugin binds |
| `network.hosts` | `string[]` | Hostnames it connects to |
| `services` | `string[]` | External services (e.g., `"redis"`) |
| `storage.persistent` | `boolean` | Needs persistent disk |
| `storage.estimatedSize` | `string` | Human-readable disk estimate |
| `capabilities` | `CapabilityRequirement[]` | Abstract capabilities needed |

`capabilities` in `requires` means "I need a provider for this capability to be configured." Required capabilities block activation if no provider is available. Optional capabilities are surfaced as suggestions.

### `provides`

Declares capabilities this plugin makes available to others. On load, each entry is auto-registered in the capability registry.

```jsonc
{
  "provides": {
    "capabilities": [
      {
        "type": "tts",
        "id": "my-tts-provider",
        "displayName": "My TTS Service",
        "configSchema": {
          "title": "TTS Settings",
          "fields": [
            { "name": "apiKey", "type": "password", "label": "API Key", "required": true, "secret": true }
          ]
        },
        "healthProbe": "builtin"
      }
    ]
  }
}
```

### `lifecycle`

```jsonc
{
  "lifecycle": {
    "healthEndpoint": "/healthz",
    "healthIntervalMs": 30000,
    "hotReload": false,
    "shutdownBehavior": "graceful",
    "shutdownTimeoutMs": 10000
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `healthEndpoint` | none | HTTP path the platform pings for liveness |
| `healthIntervalMs` | `30000` | Poll interval in milliseconds |
| `hotReload` | `false` | Plugin supports reload without restart |
| `shutdownBehavior` | `"graceful"` | `graceful` / `immediate` / `drain` |
| `shutdownTimeoutMs` | `10000` | Max wait before force-kill |

**Shutdown behaviors:**
- `graceful` — platform calls `shutdown()` and waits
- `immediate` — platform kills without calling `shutdown()`
- `drain` — platform stops new work, waits for in-flight ops, then calls `shutdown()`

### `install`

Ordered list of ways to install missing dependencies:

```jsonc
{
  "install": [
    { "kind": "brew", "formula": "ffmpeg", "label": "Install FFmpeg via Homebrew" },
    { "kind": "apt", "package": "ffmpeg", "label": "Install FFmpeg via apt" },
    { "kind": "manual", "instructions": "Download from https://ffmpeg.org/download.html" }
  ]
}
```

Kinds: `brew`, `apt`, `pip`, `npm`, `docker`, `script`, `manual`

### `setup`

Ordered wizard steps for first-time configuration. The platform renders these as a setup flow.

```jsonc
{
  "setup": [
    {
      "id": "credentials",
      "title": "API Credentials",
      "description": "Enter your API credentials from [example.com](https://example.com/keys).",
      "fields": {
        "title": "Credentials",
        "fields": [
          { "name": "apiKey", "type": "password", "label": "API Key", "required": true, "secret": true }
        ]
      }
    },
    {
      "id": "preferences",
      "title": "Preferences",
      "description": "Customize behavior (optional).",
      "optional": true,
      "fields": {
        "title": "Preferences",
        "fields": [
          { "name": "region", "type": "select", "label": "Region", "default": "us-east", "options": [
            { "value": "us-east", "label": "US East" },
            { "value": "eu-west", "label": "EU West" }
          ]}
        ]
      }
    }
  ]
}
```

### Complete Manifest Example

```jsonc
{
  "name": "@wopr-network/wopr-plugin-myplugin",
  "version": "1.0.0",
  "main": "dist/index.js",
  "type": "module",
  "wopr": {
    "name": "@wopr-network/wopr-plugin-myplugin",
    "version": "1.0.0",
    "description": "Connects WOPR to the Acme messaging platform",
    "author": "WOPR Network",
    "license": "MIT",
    "homepage": "https://github.com/wopr-network/wopr-plugin-myplugin",
    "icon": "🚀",
    "category": "channel",
    "tags": ["acme", "messaging", "channel"],
    "capabilities": ["channel", "commands"],
    "minCoreVersion": "1.0.0",

    "configSchema": {
      "title": "Acme Plugin Settings",
      "fields": [
        {
          "name": "apiKey",
          "type": "password",
          "label": "API Key",
          "required": true,
          "secret": true,
          "setupFlow": "paste"
        },
        {
          "name": "autoReply",
          "type": "boolean",
          "label": "Auto-reply to mentions",
          "default": true,
          "setupFlow": "none"
        }
      ]
    },

    "requires": {
      "os": ["linux", "darwin", "win32"],
      "node": ">=22.0.0",
      "network": {
        "outbound": true,
        "hosts": ["api.acme.com"]
      }
    },

    "lifecycle": {
      "shutdownBehavior": "graceful",
      "shutdownTimeoutMs": 5000
    }
  }
}
```

---

## 4. Plugin Context (WOPRPluginContext)

`WOPRPluginContext` is the full API surface delivered to your plugin during `init()`. Everything your plugin does goes through this object.

```typescript
async init(ctx: WOPRPluginContext) {
  // ctx is your gateway to the WOPR daemon
}
```

### Sessions

```typescript
// Inject a message into a session and get an AI response
const response = await ctx.inject("default", "Summarize the latest news");

// Inject with streaming
const response = await ctx.inject("default", "Tell me a story", {
  onStream: (msg) => {
    if (msg.type === "text") process.stdout.write(msg.content);
  },
});

// Log a message to a session without triggering AI response
ctx.logMessage("default", "Bot connected", { from: "myplugin" });

// List active session names
const sessions = ctx.getSessions();

// Cancel an in-progress injection
ctx.cancelInject("default");
```

### Config

```typescript
// Read plugin config (typed)
interface MyConfig {
  apiKey: string;
  region: string;
  enabled: boolean;
}
const config = ctx.getConfig<MyConfig>();

// Save config (persists to disk)
await ctx.saveConfig({ ...config, region: "eu-west" });

// Read global WOPR config
const mainConfig = ctx.getMainConfig("agents.a2a.enabled");
```

### Logging

```typescript
ctx.log.info("Plugin started", { version: "1.0.0" });
ctx.log.warn("Rate limit approaching", { remaining: 10 });
ctx.log.error("Connection failed", { error: err.message });
ctx.log.debug("Raw response", { payload });
```

### Agent Identity and User Profile

```typescript
// Get the bot's persona (from IDENTITY.md workspace file)
const identity = await ctx.getAgentIdentity();
// { name: "WOPR", creature: "computer", vibe: "cold war AI", emoji: "💻" }

// Get the user's profile (from USER.md)
const user = await ctx.getUserProfile();
// { name: "Alice", timezone: "America/New_York", pronouns: "she/her" }
```

### Plugin Directory

```typescript
// Get the filesystem path where your plugin is installed
const dir = ctx.getPluginDir();
// e.g., ~/.wopr/plugins/wopr-plugin-myplugin
```

### Inter-Plugin Communication (Extensions)

```typescript
// Register a typed API for other plugins to use
ctx.registerExtension("myplugin", {
  doSomething: async (input: string) => `result: ${input}`,
});

// Use another plugin's extension
const p2p = ctx.getExtension<{ acceptFriendRequest: (from: string) => Promise<void> }>("p2p");
if (p2p) {
  await p2p.acceptFriendRequest("alice");
}
```

### Config Schemas

```typescript
import type { ConfigSchema } from "@wopr-network/plugin-types";

const schema: ConfigSchema = {
  title: "My Plugin Settings",
  fields: [
    { name: "apiKey", type: "password", label: "API Key", required: true, secret: true },
  ],
};

// Register so the platform can render a settings UI
ctx.registerConfigSchema("myplugin", schema);

// Clean up on shutdown
ctx.unregisterConfigSchema("myplugin");
```

### Web UI Extensions

```typescript
// Add a link to the dashboard navigation
ctx.registerWebUiExtension({
  id: "myplugin-dashboard",
  title: "My Plugin",
  url: "http://localhost:3100",
  description: "My plugin's dashboard",
  category: "integrations",
});

// Register a SolidJS component that renders inline in the dashboard
ctx.registerUiComponent({
  id: "myplugin-settings",
  title: "My Plugin Settings",
  moduleUrl: "http://localhost:3100/component.js",
  slot: "settings", // "sidebar" | "settings" | "statusbar" | "chat-header" | "chat-footer"
});
```

### Context Providers

Context providers inject information into AI conversations before the LLM sees the message.

```typescript
import type { ContextProvider, ContextPart, MessageInfo } from "@wopr-network/plugin-types";

const weatherProvider: ContextProvider = {
  name: "weather",
  priority: 50, // lower = runs first
  enabled: true, // or a function: (session, msg) => boolean
  async getContext(session: string, message: MessageInfo): Promise<ContextPart | null> {
    if (!message.content.toLowerCase().includes("weather")) return null;
    const weather = await fetchCurrentWeather();
    return {
      content: `Current weather: ${weather.description}, ${weather.tempF}°F`,
      role: "context",
      metadata: { source: "weather-provider", priority: 50 },
    };
  },
};

ctx.registerContextProvider(weatherProvider);

// Remove on shutdown
ctx.unregisterContextProvider("weather");
```

---

## 5. Capability Declaration

The capability system lets plugins declare abstract needs ("I need TTS") and abstract provisions ("I provide TTS via ElevenLabs"). The platform resolves providers without any bespoke per-capability UI.

### Declaring What You Need

In your manifest's `requires.capabilities`:

```jsonc
{
  "requires": {
    "capabilities": [
      { "capability": "tts" },
      { "capability": "image-generation", "optional": true }
    ]
  }
}
```

Required capabilities block plugin activation if no provider is configured. Optional capabilities are surfaced as suggestions.

At runtime, resolve the provider:

```typescript
async init(ctx: WOPRPluginContext) {
  // Check if any TTS provider is available
  if (!ctx.hasCapability("tts")) {
    ctx.log.warn("No TTS provider configured — voice disabled");
    return;
  }

  // Resolve the best available provider
  const resolved = ctx.resolveCapability("tts");
  if (!resolved) return;

  ctx.log.info(`Using TTS provider: ${resolved.provider.displayName}`);

  // Or prefer a specific provider
  const preferred = ctx.resolveCapability("tts", { preferredProvider: "elevenlabs" });
}
```

### Declaring What You Provide

**Option A: Via manifest (recommended)** — the platform auto-registers on load:

```jsonc
{
  "provides": {
    "capabilities": [
      {
        "type": "tts",
        "id": "my-tts",
        "displayName": "My TTS Service",
        "configSchema": {
          "title": "TTS Settings",
          "fields": [
            { "name": "apiKey", "type": "password", "label": "API Key", "required": true, "secret": true },
            { "name": "voice", "type": "select", "label": "Voice", "default": "nova",
              "options": [
                { "value": "nova", "label": "Nova" },
                { "value": "echo", "label": "Echo" }
              ]
            }
          ]
        },
        "healthProbe": "builtin"
      }
    ]
  }
}
```

**Option B: Imperatively in init()** — for dynamic providers:

```typescript
async init(ctx: WOPRPluginContext) {
  ctx.registerCapabilityProvider("tts", {
    id: "my-tts",
    name: "My TTS Service",
    configSchema: { /* ... */ },
  });

  // Register a health probe (if healthProbe: "builtin")
  ctx.registerHealthProbe?.("tts", "my-tts", async () => {
    try {
      await ping(); // check your service
      return true;
    } catch {
      return false;
    }
  });
}

async shutdown() {
  ctx.unregisterCapabilityProvider("tts", "my-tts");
}
```

### BYOK vs Hosted Provider Pattern

**BYOK (Bring Your Own Key)** — user provides credentials, plugin calls external API:

```typescript
// User configures their ElevenLabs API key
const config = ctx.getConfig<{ apiKey: string; voice: string }>();
const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech", {
  headers: { "xi-api-key": config.apiKey },
  // ...
});
```

**Hosted provider** — plugin calls the WOPR platform's hosted capability endpoint. The platform handles billing, credentials, and routing. (Implementation details provided by the platform team.)

---

## 6. Storage API

The storage API lets plugins persist data using a type-safe repository pattern. The platform manages the underlying SQLite/PostgreSQL database; plugins never see raw SQL (unless they need it).

### Registering a Schema

Define your schema with Zod, then register it in `init()`:

```typescript
import { z } from "zod";
import type { PluginSchema } from "@wopr-network/plugin-types";

// Define your record types
const NoteSchema = z.object({
  id: z.string(),
  session: z.string(),
  content: z.string(),
  createdAt: z.number(),
  tags: z.array(z.string()).optional(),
});

type Note = z.infer<typeof NoteSchema>;

const pluginSchema: PluginSchema = {
  namespace: "myplugin",   // tables: myplugin_notes, myplugin_tags, etc.
  version: 1,
  tables: {
    notes: {
      schema: NoteSchema,
      primaryKey: "id",
      indexes: [
        { fields: ["session"] },
        { fields: ["createdAt"] },
      ],
    },
  },
  // Optional: run custom migration when version changes
  async migrate(fromVersion, toVersion, storage) {
    if (fromVersion === 1 && toVersion === 2) {
      await storage.run("ALTER TABLE myplugin_notes ADD COLUMN summary TEXT");
    }
  },
};

async init(ctx: WOPRPluginContext) {
  await ctx.storage.register(pluginSchema);
}
```

### CRUD Operations

```typescript
const notes = ctx.storage.getRepository<Note>("myplugin", "notes");

// Insert
const note = await notes.insert({
  id: crypto.randomUUID(),
  session: "default",
  content: "Remember to follow up",
  createdAt: Date.now(),
});

// Find by ID
const found = await notes.findById(note.id);

// Find with filter
const sessionNotes = await notes.findMany({ session: "default" });

// Update
await notes.update(note.id, { content: "Updated content" });

// Delete
await notes.delete(note.id);

// Count
const total = await notes.count({ session: "default" });
```

### Query Builder

For more complex queries:

```typescript
const recent = await notes
  .query()
  .where("session", "$eq", "default")
  .where("createdAt", "$gt", Date.now() - 86_400_000)
  .orderBy("createdAt", "desc")
  .limit(10)
  .execute();

// Count matching
const count = await notes
  .query()
  .where("session", "default")
  .count();

// Select specific fields
const ids = await notes
  .query()
  .select("id", "createdAt")
  .execute();
```

### Filter Operators

| Operator | Meaning |
|----------|---------|
| `$eq` | Equal (default) |
| `$ne` | Not equal |
| `$gt` / `$gte` | Greater than / or equal |
| `$lt` / `$lte` | Less than / or equal |
| `$in` / `$nin` | In / not in array |
| `$contains` | Array contains value |
| `$startsWith` | String starts with |
| `$endsWith` | String ends with |
| `$regex` | Regex match |

### Transactions

```typescript
await ctx.storage.transaction(async (storage) => {
  const notes = storage.getRepository<Note>("myplugin", "notes");
  const tags = storage.getRepository<Tag>("myplugin", "tags");

  await notes.insert({ /* ... */ });
  await tags.insert({ /* ... */ });
  // If either throws, both are rolled back
});
```

---

## 7. Command Registration

Plugins can add commands to WOPR's CLI. These are exposed via `wopr plugin cmd <plugin-name> <command>`.

### Registering CLI Commands

Define commands in the `commands` array on your `WOPRPlugin` object:

```typescript
import type { WOPRPlugin, WOPRPluginContext, PluginCommand } from "@wopr-network/plugin-types";

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-myplugin",
  version: "1.0.0",

  commands: [
    {
      name: "status",
      description: "Show connection status",
      usage: "status",
      handler: async (ctx: WOPRPluginContext, args: string[]) => {
        const config = ctx.getConfig<{ apiKey: string }>();
        console.log(`API key configured: ${!!config.apiKey}`);
        console.log(`Sessions: ${ctx.getSessions().join(", ")}`);
      },
    },
    {
      name: "ping",
      description: "Test connection to the external service",
      usage: "ping [host]",
      handler: async (ctx: WOPRPluginContext, args: string[]) => {
        const host = args[0] ?? "api.example.com";
        try {
          const resp = await fetch(`https://${host}/health`);
          console.log(`Connected: ${resp.status === 200}`);
        } catch (err) {
          console.error(`Connection failed: ${err}`);
        }
      },
    },
  ],

  async init(ctx: WOPRPluginContext) {
    ctx.log.info("myplugin started");
  },
};
```

Usage: `wopr plugin cmd myplugin status`

### Channel Commands (for Channel Plugins)

Channel plugins register protocol-level slash commands (e.g., `/status` in Discord) through the `ChannelProvider` interface:

```typescript
import type { ChannelCommand, ChannelCommandContext, ChannelProvider } from "@wopr-network/plugin-types";

const helloCommand: ChannelCommand = {
  name: "hello",
  description: "Say hello",
  handler: async (ctx: ChannelCommandContext) => {
    await ctx.reply(`Hello, ${ctx.sender}! Bot is ${ctx.getBotUsername()}`);
  },
};

// In your channel provider:
const provider: ChannelProvider = {
  id: "myplugin",
  // ...
  registerCommand(cmd) { /* store it */ },
  // ...
};

// Other plugins can also register commands on your provider:
// via ctx.getChannelProvider("myplugin")?.registerCommand(...)
```

---

## 8. A2A (Agent-to-Agent) Tools

A2A tools are functions the AI itself can call during a conversation. They follow the MCP (Model Context Protocol) tool pattern.

### When to Use A2A vs Commands

| A2A Tools | CLI Commands |
|-----------|-------------|
| AI calls them mid-conversation | User invokes them explicitly |
| Return structured data | Print to console |
| Part of AI reasoning loop | One-off administrative tasks |
| Example: `search_web`, `get_weather` | Example: `wopr plugin cmd status` |

### Registering A2A Tools

```typescript
import type { A2AServerConfig, A2AToolDefinition, A2AToolResult, WOPRPlugin } from "@wopr-network/plugin-types";

const searchTool: A2AToolDefinition = {
  name: "search_docs",
  description: "Search the plugin's knowledge base",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      limit: {
        type: "number",
        description: "Maximum results (default: 5)",
      },
    },
    required: ["query"],
  },
  handler: async (args: Record<string, unknown>): Promise<A2AToolResult> => {
    const query = args.query as string;
    const limit = (args.limit as number) ?? 5;

    const results = await searchKnowledgeBase(query, limit);

    return {
      content: [
        {
          type: "text",
          text: results.map((r) => `- ${r.title}: ${r.excerpt}`).join("\n"),
        },
      ],
    };
  },
};

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-myplugin",
  version: "1.0.0",

  async init(ctx) {
    const serverConfig: A2AServerConfig = {
      name: "myplugin",
      version: "1.0.0",
      tools: [searchTool],
    };

    ctx.registerA2AServer?.(serverConfig);
  },
};
```

### Tool Return Types

`A2AToolResult.content` is an array of content blocks:

```typescript
// Text response
{ type: "text", text: "The answer is 42" }

// Image (base64)
{ type: "image", data: "<base64>", mimeType: "image/png" }

// Resource (URI reference)
{ type: "resource", text: "file:///path/to/resource" }

// Signal an error
{ isError: true, content: [{ type: "text", text: "Service unavailable" }] }
```

---

## 9. Events and Hooks

The event bus (`ctx.events`) is for observing system events. Hooks (`ctx.hooks`) are for intercepting and optionally modifying or blocking messages.

### Event Bus

```typescript
async init(ctx: WOPRPluginContext) {
  // Subscribe to session lifecycle
  const unsubCreate = ctx.events.on("session:create", (event) => {
    ctx.log.info(`New session: ${event.session}`);
  });

  // React to messages going in
  ctx.events.on("session:beforeInject", (event) => {
    // event: { session, message, from, channel }
    analytics.track(event.session, event.message);
  });

  // React to AI responses
  ctx.events.on("session:afterInject", (event) => {
    // event: { session, message, response, from }
    ctx.log.debug(`Response: ${event.response.substring(0, 50)}...`);
  });

  // Capability events
  ctx.events.on("capability:providerRegistered", (event) => {
    ctx.log.info(`New ${event.capability} provider: ${event.providerName}`);
  });

  // Custom inter-plugin events
  await ctx.events.emitCustom("myplugin:ready", { timestamp: Date.now() });

  // Subscribe to custom events from other plugins
  ctx.events.on("otherplugin:event" as keyof typeof ctx.events, (payload) => {
    // handle it
  });

  // Store unsubscribe functions for cleanup
  this._cleanup = [unsubCreate];
}

async shutdown() {
  for (const unsub of this._cleanup) unsub();
}
```

### Core Event Map

| Event | Payload | When |
|-------|---------|------|
| `session:create` | `{ session, config? }` | New session created |
| `session:beforeInject` | `{ session, message, from, channel? }` | Before AI processes message |
| `session:afterInject` | `{ session, message, response, from }` | After AI responds |
| `session:responseChunk` | `{ session, message, response, from, chunk }` | Each streaming chunk |
| `session:destroy` | `{ session, history, reason? }` | Session destroyed |
| `channel:message` | `{ channel, message, from, metadata? }` | Message from a channel |
| `channel:send` | `{ channel, content }` | Message sent to a channel |
| `plugin:afterInit` | `{ plugin, version }` | A plugin finished init |
| `plugin:error` | `{ plugin, error, context? }` | Plugin threw an error |
| `config:change` | `{ key, oldValue, newValue, plugin? }` | Config value changed |
| `system:shutdown` | `{ reason, code? }` | Daemon shutting down |
| `capability:providerRegistered` | `{ capability, providerId, providerName }` | New provider available |

### Hook Manager

Hooks can **modify or block** data before it's processed, unlike events which are read-only.

```typescript
async init(ctx: WOPRPluginContext) {
  // Intercept incoming messages — can transform or block
  const removeHook = ctx.hooks.on(
    "message:incoming",
    (event) => {
      const msg = event.data;

      // Block profanity
      if (containsProfanity(msg.message)) {
        event.preventDefault(); // Stops AI from seeing the message
        return;
      }

      // Transform the message
      msg.message = translateToEnglish(msg.message);
    },
    { priority: 10, name: "profanity-filter" },
  );

  // Intercept outgoing responses
  ctx.hooks.on("message:outgoing", (event) => {
    const msg = event.data;
    // Add a signature to all responses
    msg.response += "\n\n— powered by MyPlugin";
  });

  // React to session creation
  ctx.hooks.on("session:create", (event) => {
    setupSessionResources(event.session);
  });
}
```

**Hook priority:** Lower numbers run first (default: 100).

**Hook options:**
- `priority` — execution order (lower = earlier)
- `name` — identifier for debugging and `offByName()`
- `once` — auto-remove after first execution

---

## 10. Real Examples

### Example 1: Hello World Plugin

The minimal viable plugin. Responds to a `/hello` CLI command and logs all session injections.

```typescript
// src/index.ts
import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-hello",
  version: "1.0.0",
  description: "Greets users and logs activity",

  manifest: {
    name: "@wopr-network/wopr-plugin-hello",
    version: "1.0.0",
    description: "Greets users and logs activity",
    icon: "👋",
    category: "utility",
    capabilities: ["commands"],
    tags: ["example", "hello"],
  },

  commands: [
    {
      name: "hello",
      description: "Greet the user",
      usage: "hello [name]",
      handler: async (ctx: WOPRPluginContext, args: string[]) => {
        const identity = await ctx.getAgentIdentity();
        const name = args[0] ?? "World";
        console.log(`Hello, ${name}! I am ${identity.name ?? "WOPR"}.`);
        console.log(`Active sessions: ${ctx.getSessions().join(", ") || "none"}`);
      },
    },
  ],

  async init(ctx: WOPRPluginContext) {
    ctx.log.info("hello-plugin initialized");

    // Log every message injected into any session
    ctx.events.on("session:beforeInject", (event) => {
      ctx.log.info(`[hello-plugin] Message in ${event.session}: "${event.message.substring(0, 50)}..."`);
    });
  },

  async shutdown() {
    // No connections to close — nothing to do
  },
};

export default plugin;
```

**`package.json` (minimal):**

```json
{
  "name": "@wopr-network/wopr-plugin-hello",
  "version": "1.0.0",
  "description": "Hello World WOPR plugin",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@wopr-network/plugin-types": "^0.2.1"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vitest": "^4.0.0"
  },
  "wopr": {
    "name": "@wopr-network/wopr-plugin-hello",
    "version": "1.0.0",
    "description": "Hello World WOPR plugin",
    "capabilities": ["commands"],
    "category": "utility"
  }
}
```

---

### Example 2: Discord Channel Plugin

A full channel plugin that registers a `ChannelProvider`, handles incoming messages, and responds via WOPR sessions.

```typescript
// src/index.ts
import type {
  ChannelAdapter,
  ChannelCommand,
  ChannelCommandContext,
  ChannelProvider,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

interface DiscordConfig {
  token: string;
  guildId?: string;
  autoReply: boolean;
}

// Minimal channel provider implementation
class SimpleChannelProvider implements ChannelProvider {
  id = "my-discord";
  private commands: ChannelCommand[] = [];
  private client: any; // your Discord client

  constructor(client: any) {
    this.client = client;
  }

  registerCommand(cmd: ChannelCommand) {
    this.commands.push(cmd);
  }

  unregisterCommand(name: string) {
    this.commands = this.commands.filter((c) => c.name !== name);
  }

  getCommands(): ChannelCommand[] {
    return this.commands;
  }

  addMessageParser() {}
  removeMessageParser() {}
  getMessageParsers() { return []; }

  async send(channel: string, content: string) {
    await this.client.channels.fetch(channel).then((ch: any) => ch.send(content));
  }

  getBotUsername() {
    return this.client.user?.username ?? "WOPR";
  }
}

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-my-discord",
  version: "1.0.0",
  description: "Discord integration",

  manifest: {
    name: "@wopr-network/wopr-plugin-my-discord",
    version: "1.0.0",
    description: "Discord integration",
    icon: "🎮",
    category: "channel",
    capabilities: ["channel", "commands"],
    configSchema: {
      title: "Discord Settings",
      fields: [
        { name: "token", type: "password", label: "Bot Token", required: true, secret: true, setupFlow: "paste" },
        { name: "guildId", type: "text", label: "Server ID (optional)", setupFlow: "paste" },
        { name: "autoReply", type: "boolean", label: "Auto-reply to mentions", default: true, setupFlow: "none" },
      ],
    },
    requires: {
      os: ["linux", "darwin", "win32"],
      network: { outbound: true, hosts: ["discord.com", "gateway.discord.gg"] },
    },
    lifecycle: { shutdownBehavior: "graceful", shutdownTimeoutMs: 5000 },
  },

  async init(ctx: WOPRPluginContext) {
    const config = ctx.getConfig<DiscordConfig>();

    if (!config.token) {
      ctx.log.error("Discord bot token not configured");
      return;
    }

    // Connect your Discord client (e.g., discord.js)
    const client = await connectDiscord(config.token);
    const provider = new SimpleChannelProvider(client);

    // Register a slash command
    provider.registerCommand({
      name: "status",
      description: "Show WOPR status",
      handler: async (cmdCtx: ChannelCommandContext) => {
        const sessions = ctx.getSessions();
        await cmdCtx.reply(
          `WOPR online. Active sessions: ${sessions.length}`,
        );
      },
    });

    // Register the channel provider so other plugins can use it
    ctx.registerChannelProvider(provider);

    // Register a channel adapter per active session
    const adapter: ChannelAdapter = {
      channel: { type: "discord", id: "general", name: "#general" },
      session: "default",
      async getContext() {
        return "Discord channel: #general";
      },
      async send(message: string) {
        await provider.send("CHANNEL_ID", message);
      },
    };
    ctx.registerChannel(adapter);

    // Handle incoming messages
    if (config.autoReply) {
      client.on("messageCreate", async (msg: any) => {
        if (msg.author.bot) return;
        if (!msg.mentions.has(client.user)) return;

        const sessionKey = `discord-${msg.channelId}`;
        const response = await ctx.inject(sessionKey, msg.content, {
          channel: { type: "discord", id: msg.channelId },
          from: msg.author.username,
        });

        await msg.reply(response);
      });
    }

    ctx.log.info("Discord plugin started");
  },

  async shutdown() {
    // discord.js client cleanup
    // ctx.unregisterChannelProvider("my-discord") if you stored ctx
  },
};

export default plugin;

// Stub — replace with actual discord.js setup
async function connectDiscord(token: string) {
  return { on: () => {}, user: { username: "WOPR", id: "123" } };
}
```

---

### Example 3: ImageGen Capability Plugin

A plugin that provides an `image-generation` capability (wrapping an external API) and registers a `/imagine` command for other channel plugins to use.

```typescript
// src/index.ts
import type {
  A2AServerConfig,
  A2AToolResult,
  ChannelCommand,
  ChannelCommandContext,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

interface ImageGenConfig {
  apiKey: string;
  model: string;
  defaultSize: string;
}

let _ctx: WOPRPluginContext | null = null;

async function generateImage(prompt: string, size: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.example.com/v1/images/generate", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, size, n: 1 }),
  });

  if (!response.ok) {
    throw new Error(`Image generation failed: ${response.statusText}`);
  }

  const data = await response.json() as { data: Array<{ url: string }> };
  return data.data[0]!.url;
}

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-imagegen",
  version: "1.0.0",
  description: "Image generation capability via Acme API",

  manifest: {
    name: "@wopr-network/wopr-plugin-imagegen",
    version: "1.0.0",
    description: "Image generation capability via Acme API",
    icon: "🎨",
    category: "integration",
    capabilities: ["a2a"],
    tags: ["image", "generation", "ai"],
    configSchema: {
      title: "Image Generation Settings",
      fields: [
        { name: "apiKey", type: "password", label: "API Key", required: true, secret: true, setupFlow: "paste" },
        {
          name: "model",
          type: "select",
          label: "Model",
          default: "standard",
          setupFlow: "none",
          options: [
            { value: "standard", label: "Standard" },
            { value: "hd", label: "HD (slower, higher quality)" },
          ],
        },
        { name: "defaultSize", type: "text", label: "Default Size", default: "1024x1024", setupFlow: "none" },
      ],
    },
    provides: {
      capabilities: [
        {
          type: "image-generation",
          id: "acme-imagegen",
          displayName: "Acme ImageGen",
          configSchema: {
            title: "Acme ImageGen Settings",
            fields: [
              { name: "apiKey", type: "password", label: "API Key", required: true, secret: true },
            ],
          },
          healthProbe: "builtin",
        },
      ],
    },
    requires: {
      network: { outbound: true, hosts: ["api.example.com"] },
    },
    lifecycle: {
      shutdownBehavior: "graceful",
    },
  },

  async init(ctx: WOPRPluginContext) {
    _ctx = ctx;
    const config = ctx.getConfig<ImageGenConfig>();

    if (!config.apiKey) {
      ctx.log.warn("ImageGen API key not configured");
      return;
    }

    // Register health probe for the capability
    ctx.registerHealthProbe?.("image-generation", "acme-imagegen", async () => {
      try {
        const resp = await fetch("https://api.example.com/health", {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        return resp.ok;
      } catch {
        return false;
      }
    });

    // Register an A2A tool so the AI can call /imagine mid-conversation
    const a2aConfig: A2AServerConfig = {
      name: "imagegen",
      version: "1.0.0",
      tools: [
        {
          name: "generate_image",
          description: "Generate an image from a text prompt",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string", description: "Detailed image description" },
              size: { type: "string", description: "Image dimensions (e.g., 1024x1024)", default: "1024x1024" },
            },
            required: ["prompt"],
          },
          handler: async (args): Promise<A2AToolResult> => {
            const prompt = args.prompt as string;
            const size = (args.size as string) ?? config.defaultSize ?? "1024x1024";

            try {
              const imageUrl = await generateImage(prompt, size, config.apiKey);
              return {
                content: [
                  { type: "text", text: `Generated image: ${imageUrl}` },
                  { type: "image", data: imageUrl, mimeType: "image/png" },
                ],
              };
            } catch (err) {
              return {
                isError: true,
                content: [{ type: "text", text: `Image generation failed: ${err}` }],
              };
            }
          },
        },
      ],
    };

    ctx.registerA2AServer?.(a2aConfig);

    // Register /imagine as a channel command for Discord and other channels
    const imagineCommand: ChannelCommand = {
      name: "imagine",
      description: "Generate an image from a text prompt",
      handler: async (cmdCtx: ChannelCommandContext) => {
        const prompt = cmdCtx.args.join(" ");
        if (!prompt) {
          await cmdCtx.reply("Usage: /imagine <prompt>");
          return;
        }

        await cmdCtx.reply("Generating image...");
        try {
          const imageUrl = await generateImage(prompt, config.defaultSize ?? "1024x1024", config.apiKey);
          await cmdCtx.reply(imageUrl);
        } catch (err) {
          await cmdCtx.reply(`Failed: ${err}`);
        }
      },
    };

    // Register on all available channel providers
    for (const provider of ctx.getChannelProviders()) {
      provider.registerCommand(imagineCommand);
    }

    // Also register on providers that load after us
    ctx.events.on("plugin:afterInit", async () => {
      for (const provider of ctx.getChannelProviders()) {
        if (!provider.getCommands().find((c) => c.name === "imagine")) {
          provider.registerCommand(imagineCommand);
        }
      }
    });

    ctx.log.info("ImageGen plugin started");
  },

  async shutdown() {
    if (_ctx) {
      _ctx.unregisterCapabilityProvider("image-generation", "acme-imagegen");
    }
    _ctx = null;
  },
};

export default plugin;
```

---

## 11. Testing

### Unit Testing with Vitest

Use Vitest (the standard across all WOPR repos):

```typescript
// tests/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WOPRPluginContext } from "@wopr-network/plugin-types";
import plugin from "../src/index.js";

// Build a mock context
function buildMockContext(config: Record<string, unknown> = {}): WOPRPluginContext {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const eventHandlers: Record<string, Function[]> = {};

  return {
    log,
    getConfig: vi.fn(() => config),
    saveConfig: vi.fn(),
    getMainConfig: vi.fn(),
    inject: vi.fn().mockResolvedValue("mock response"),
    logMessage: vi.fn(),
    getSessions: vi.fn().mockReturnValue(["default"]),
    cancelInject: vi.fn().mockReturnValue(false),
    getAgentIdentity: vi.fn().mockResolvedValue({ name: "WOPR" }),
    getUserProfile: vi.fn().mockResolvedValue({ name: "Test User" }),
    getPluginDir: vi.fn().mockReturnValue("/tmp/plugins/myplugin"),
    events: {
      on: vi.fn((event, handler) => {
        if (!eventHandlers[event]) eventHandlers[event] = [];
        eventHandlers[event].push(handler);
        return () => {};
      }),
      once: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      emitCustom: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    },
    hooks: {
      on: vi.fn().mockReturnValue(() => {}),
      off: vi.fn(),
      offByName: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    },
    storage: {
      driver: "sqlite",
      register: vi.fn(),
      getRepository: vi.fn(),
      isRegistered: vi.fn().mockReturnValue(false),
      getVersion: vi.fn().mockResolvedValue(0),
      raw: vi.fn().mockResolvedValue([]),
      run: vi.fn().mockResolvedValue({ changes: 0, lastInsertRowid: 0 }),
      transaction: vi.fn(),
      close: vi.fn(),
    },
    // Add other methods as needed...
  } as unknown as WOPRPluginContext;
}

describe("hello plugin", () => {
  let ctx: WOPRPluginContext;

  beforeEach(() => {
    ctx = buildMockContext({ apiKey: "test-key" });
  });

  it("initializes without error", async () => {
    await plugin.init!(ctx);
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("initialized"));
  });

  it("logs each message injection", async () => {
    await plugin.init!(ctx);

    // Simulate the session:beforeInject event
    const handler = (ctx.events.on as ReturnType<typeof vi.fn>).mock.calls
      .find(([event]) => event === "session:beforeInject")?.[1];

    handler?.({ session: "default", message: "hello world", from: "user" });

    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("hello world"));
  });

  it("shuts down cleanly", async () => {
    await plugin.init!(ctx);
    await plugin.shutdown?.();
    // No errors thrown = pass
  });
});

describe("hello command", () => {
  it("greets with default name", async () => {
    const ctx = buildMockContext({});
    const consoleSpy = vi.spyOn(console, "log");

    const cmd = plugin.commands?.find((c) => c.name === "hello");
    await cmd?.handler(ctx, []);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Hello, World!"));
  });

  it("greets with custom name", async () => {
    const ctx = buildMockContext({});
    const consoleSpy = vi.spyOn(console, "log");

    const cmd = plugin.commands?.find((c) => c.name === "hello");
    await cmd?.handler(ctx, ["Alice"]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Hello, Alice!"));
  });
});
```

**`vitest.config.ts`:**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "istanbul",
      reporter: ["text", "lcov"],
    },
  },
});
```

### Testing Patterns

**Testing storage:**

```typescript
it("stores and retrieves notes", async () => {
  const ctx = buildMockContext({});
  const mockRepo = {
    insert: vi.fn().mockResolvedValue({ id: "1", content: "test", session: "default", createdAt: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
    // ...
  };
  (ctx.storage.getRepository as ReturnType<typeof vi.fn>).mockReturnValue(mockRepo);

  await plugin.init!(ctx);
  // trigger your plugin's logic that stores data
  expect(mockRepo.insert).toHaveBeenCalled();
});
```

**Testing A2A tools:**

```typescript
it("generates an image", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: [{ url: "https://example.com/img.png" }] }),
  });

  const ctx = buildMockContext({ apiKey: "test" });
  await plugin.init!(ctx);

  const a2aCall = (ctx.registerA2AServer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
  const tool = a2aCall?.tools.find((t: any) => t.name === "generate_image");

  const result = await tool?.handler({ prompt: "a red cat" });
  expect(result.content[0].text).toContain("example.com");
});
```

---

## 12. Publishing

### NPM Publish Workflow

1. Build: `npm run build`
2. Test: `npm test`
3. Bump version: `npm version patch|minor|major`
4. Publish: `npm publish --access public`

Your `package.json` must have:
```json
{
  "publishConfig": { "access": "public" },
  "files": ["dist"],
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
```

### GitHub Actions Auto-Publish

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    tags:
      - "v*"

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Versioning Conventions

Follow semver strictly:
- **Patch** (`1.0.x`) — Bug fixes, non-breaking changes
- **Minor** (`1.x.0`) — New features, backward compatible
- **Major** (`x.0.0`) — Breaking changes to the plugin API or config schema

When bumping `major` or `minor`, also update the `wopr.version` field in `package.json` to match.

### Installation by Users

Once published, users install your plugin with:

```bash
# From npm
wopr plugin install @wopr-network/wopr-plugin-myplugin

# From GitHub
wopr plugin install github:wopr-network/wopr-plugin-myplugin

# From local path (development)
wopr plugin install /path/to/wopr-plugin-myplugin
```

---

## 13. Troubleshooting

### Plugin won't load

**Symptom:** `wopr plugin list` shows the plugin as disabled, or daemon logs show an error on startup.

**Checks:**
1. `npm run build` in the plugin directory — ensure no TypeScript errors
2. `cat dist/index.js | head -5` — ensure `export default` is present
3. `node -e "import('./dist/index.js').then(m => console.log(m.default.name))"` — verify the export
4. Check the `main` field in `package.json` points to `dist/index.js`

---

### Plugin loads but does nothing

**Symptom:** Plugin appears in `wopr plugin list` as enabled, but its features don't work.

**Checks:**
1. Is `init()` being called? Add `ctx.log.info("init called")` as the first line
2. Check config: `ctx.getConfig()` returns `{}` if no config is set. Required fields with no values mean the plugin can't connect.
3. Check `wopr daemon logs` for errors from your plugin

---

### `ctx.getConfig()` returns empty object

Config is empty until the user sets it:
```bash
wopr config set plugins.data.@wopr-network/wopr-plugin-myplugin '{"apiKey": "..."}'
```

Or use the dashboard settings UI if you've defined a `configSchema`.

---

### TypeScript import errors

`@wopr-network/plugin-types` not found:
```bash
npm install @wopr-network/plugin-types
```

If you're in a monorepo setup and need local types, use a path alias in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@wopr-network/plugin-types": ["../wopr/src/plugin-types/index.js"]
    }
  }
}
```

---

### `ctx.registerA2AServer is not a function`

A2A registration is optional (`registerA2AServer?`). Use optional chaining:
```typescript
ctx.registerA2AServer?.(config);
```

If `undefined`, A2A is disabled in the WOPR config. Enable it:
```bash
wopr config set agents.a2a.enabled true
wopr daemon restart
```

---

### Events not firing

Check that:
1. You're subscribing in `init()`, not at module load time
2. The event name is correct — check `WOPREventMap` in `src/plugin-types/events.ts`
3. You're returning the unsubscribe function and calling it in `shutdown()`

---

### Capability resolution returns null

```typescript
const resolved = ctx.resolveCapability("tts");
// null = no providers registered
```

Either no plugin providing `tts` is installed, or the provider isn't healthy. Check:
```bash
wopr plugin list  # Is the TTS plugin installed and enabled?
```

---

### Storage tables not created

You must `await ctx.storage.register(schema)` in `init()` before calling `ctx.storage.getRepository()`. If `register()` isn't awaited, the table may not exist yet.

---

### Channel commands not appearing in Discord

Discord slash commands are registered globally or per-guild and take up to an hour to propagate. For instant registration, use guild-specific commands (pass `guildId` to the Discord REST API).

---

### Plugin conflicts with another plugin

If two plugins register the same channel provider ID or extension name, the second one wins. Use unique, namespaced IDs:
- Channel providers: `"myplugin-discord"` not `"discord"`
- Extensions: `"myplugin"` not `"api"`

Check for conflicts: `wopr plugin list --verbose`

---

### Memory leak in event handlers

Always store unsubscribe functions and call them in `shutdown()`:

```typescript
private _cleanups: Array<() => void> = [];

async init(ctx: WOPRPluginContext) {
  const unsub = ctx.events.on("session:create", () => { /* ... */ });
  this._cleanups.push(unsub);
}

async shutdown() {
  for (const cleanup of this._cleanups) cleanup();
  this._cleanups = [];
}
```

---

### Plugin hangs on shutdown

Your `shutdown()` must resolve within `lifecycle.shutdownTimeoutMs` (default: 10 seconds). Common causes:
- Infinite loops in cleanup code
- Waiting for a network request that never completes
- Not clearing setInterval / setTimeout handles

Use `AbortController` for network requests and store timer handles:

```typescript
private _timer: ReturnType<typeof setInterval> | null = null;

async init(ctx) {
  this._timer = setInterval(() => pollForUpdates(), 5000);
}

async shutdown() {
  if (this._timer) clearInterval(this._timer);
}
```

---

### Debug logging not appearing

Enable debug output:

```bash
DEBUG=wopr:* wopr daemon start
```

Or set in config:
```bash
wopr config set daemon.logLevel debug
wopr daemon restart
```

In your plugin, use `ctx.log.debug()` for verbose output that only appears in debug mode.

---

## Appendix: Type Reference Summary

| Type | Package | Description |
|------|---------|-------------|
| `WOPRPlugin` | `@wopr-network/plugin-types` | Interface every plugin implements |
| `WOPRPluginContext` | `@wopr-network/plugin-types` | Runtime API delivered to `init()` |
| `PluginManifest` | `@wopr-network/plugin-types` | Full manifest schema |
| `ConfigSchema` | `@wopr-network/plugin-types` | Config UI schema |
| `ConfigField` | `@wopr-network/plugin-types` | Individual config field |
| `PluginCommand` | `@wopr-network/plugin-types` | CLI command definition |
| `ChannelAdapter` | `@wopr-network/plugin-types` | Bridges a session to a channel |
| `ChannelProvider` | `@wopr-network/plugin-types` | Protocol-level command registration |
| `ChannelCommand` | `@wopr-network/plugin-types` | Slash/bot command for channels |
| `ContextProvider` | `@wopr-network/plugin-types` | Contributes context to AI conversations |
| `A2AToolDefinition` | `@wopr-network/plugin-types` | Tool the AI can call |
| `A2AServerConfig` | `@wopr-network/plugin-types` | Collection of A2A tools |
| `StorageApi` | `@wopr-network/plugin-types` | Plugin database access |
| `PluginSchema` | `@wopr-network/plugin-types` | Schema registration for storage |
| `Repository<T>` | `@wopr-network/plugin-types` | CRUD interface for a table |
| `WOPREventBus` | `@wopr-network/plugin-types` | Event pub/sub |
| `WOPRHookManager` | `@wopr-network/plugin-types` | Intercepting lifecycle hooks |
| `CapabilityRequirement` | `@wopr-network/plugin-types` | Declares a required capability |
| `ManifestProviderEntry` | `@wopr-network/plugin-types` | Declares a provided capability |

All types are importable from `@wopr-network/plugin-types`. Never import from relative paths into the core repo.
