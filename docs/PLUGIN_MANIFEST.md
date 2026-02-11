# Plugin Manifest Specification

> **Canonical types:** `src/plugin-types/manifest.ts` and `src/plugin-types/config.ts`
>
> **Key principle:** If a plugin can't describe it in the manifest, the platform can't support it. The manifest IS the contract.

## Overview

Every WOPR plugin declares a static manifest that lets the platform understand it **without loading or executing the plugin**. The platform uses the manifest to:

- Display plugins in a marketplace UI
- Render setup wizards with the correct UX per field
- Check OS/runtime compatibility before installation
- Understand network and storage requirements for deployment
- Manage plugin lifecycle (health checks, hot-reload, shutdown)

## Format

The manifest lives in the plugin's `package.json` under the `wopr` key. This extends the existing pattern where the loader already reads `pkg.wopr.plugin.requires` and `pkg.wopr.plugin.install`.

```jsonc
{
  "name": "@wopr-network/plugin-discord",
  "version": "2.1.0",
  // ... standard package.json fields ...
  "wopr": {
    // The full PluginManifest object (see below)
  }
}
```

The runtime type is `PluginManifest` from `src/plugin-types/manifest.ts`.

## Manifest Fields

### Identity (required)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Plugin package name (e.g., `"@wopr-network/plugin-discord"`) |
| `version` | `string` | yes | Semantic version (e.g., `"2.1.0"`) |
| `description` | `string` | yes | One-line human-readable description |
| `author` | `string` | no | Author or organization |
| `license` | `string` | no | SPDX license identifier (e.g., `"MIT"`) |
| `homepage` | `string` | no | Documentation URL |
| `repository` | `string` | no | Source repository URL |
| `icon` | `string` | no | Emoji for UI display (e.g., `"🎮"`) |
| `category` | `PluginCategory` | no | Marketplace category (see below) |
| `tags` | `string[]` | no | Search/discovery tags |

### Capabilities (required)

```jsonc
{
  "capabilities": ["channel", "commands"]
}
```

Declares what the plugin provides. The platform uses this to route features (e.g., only plugins with `"channel"` appear in channel setup).

| Value | Meaning |
|-------|---------|
| `channel` | Message channel (Discord, Slack, Telegram, etc.) |
| `provider` | AI model provider |
| `stt` | Speech-to-text |
| `tts` | Text-to-speech |
| `context` | Context provider for conversations |
| `storage` | Persistent storage backend |
| `memory` | Long-term memory / RAG |
| `auth` | Authentication provider |
| `webhook` | Webhook endpoints |
| `commands` | CLI commands |
| `ui` | UI components |
| `a2a` | Agent-to-agent tools |
| `p2p` | Peer-to-peer networking |
| `middleware` | Message middleware/hooks |

### Category

One of: `channel`, `ai-provider`, `voice`, `memory`, `p2p`, `integration`, `utility`, `security`, `analytics`, `developer`.

Used for marketplace organization. A plugin has exactly one category but can have multiple capabilities.

### Config Schema

Defines every configurable field so the platform can render a settings UI **without calling init()**.

```jsonc
{
  "configSchema": {
    "title": "Discord Bot Settings",
    "description": "Connect WOPR to your Discord server",
    "fields": [
      {
        "name": "botToken",
        "type": "password",
        "label": "Bot Token",
        "required": true,
        "secret": true,
        "setupFlow": "paste",
        "description": "Create a bot at discord.com/developers and copy the token",
        "pattern": "^[A-Za-z0-9._-]+$",
        "patternError": "Must be a valid Discord bot token"
      },
      {
        "name": "guildId",
        "type": "text",
        "label": "Server ID",
        "required": true,
        "setupFlow": "paste",
        "placeholder": "Right-click your server > Copy Server ID"
      },
      {
        "name": "autoReply",
        "type": "boolean",
        "label": "Auto-reply to mentions",
        "default": true,
        "setupFlow": "none"
      }
    ]
  }
}
```

#### ConfigField

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Config key (dot-path safe) |
| `type` | see below | yes | Field type |
| `label` | `string` | yes | Human-readable label |
| `required` | `boolean` | no | Whether the field must be set |
| `default` | `unknown` | no | Default value |
| `description` | `string` | no | Help text (markdown) |
| `placeholder` | `string` | no | Input placeholder |
| `options` | `{value, label}[]` | no | For `select` type |
| `items` | `ConfigField` | no | For `array` type: item schema |
| `fields` | `ConfigField[]` | no | For `object` type: nested fields |
| `setupFlow` | `SetupFlowType` | no | How the platform collects this value |
| `oauthProvider` | `string` | no | For `oauth` flow: provider ID |
| `pattern` | `string` | no | Regex validation pattern |
| `patternError` | `string` | no | Validation error message |
| `secret` | `boolean` | no | Mask in UI, encrypt at rest |

Field types: `text`, `password`, `select`, `checkbox`, `number`, `array`, `boolean`, `object`, `textarea`.

### Setup Flows

The `setupFlow` field on each `ConfigField` tells the platform what UX to render for that field.

| Flow | UX | Example |
|------|----|---------|
| `paste` | Text input (default for text/password) | Bot tokens, API keys |
| `oauth` | "Connect" button that launches OAuth | Slack workspace auth |
| `qr` | QR code display + scan confirmation | WhatsApp Web pairing |
| `interactive` | Plugin-provided multi-step UX | Complex wizard flows |
| `none` | No input; auto-derived or uses default | Auto-detected values, booleans with defaults |

If `setupFlow` is omitted, the platform infers:
- `password` type -> `paste`
- `text` type -> `paste`
- Fields with `default` and `required: false` -> `none`
- Everything else -> `paste`

### Setup Wizard Steps

For plugins that need a multi-step onboarding wizard, the `setup` array defines ordered steps. Each step groups related config fields.

```jsonc
{
  "setup": [
    {
      "id": "credentials",
      "title": "Bot Credentials",
      "description": "Enter your Discord bot token. [Create one here](https://discord.com/developers).",
      "fields": {
        "title": "Credentials",
        "fields": [
          { "name": "botToken", "type": "password", "label": "Bot Token", "required": true, "secret": true, "setupFlow": "paste" }
        ]
      }
    },
    {
      "id": "server",
      "title": "Select Server",
      "description": "Choose which Discord server to connect.",
      "fields": {
        "title": "Server",
        "fields": [
          { "name": "guildId", "type": "text", "label": "Server ID", "required": true, "setupFlow": "paste" }
        ]
      },
      "optional": false
    },
    {
      "id": "behavior",
      "title": "Bot Behavior",
      "description": "Configure how the bot responds.",
      "fields": {
        "title": "Behavior",
        "fields": [
          { "name": "autoReply", "type": "boolean", "label": "Auto-reply to mentions", "default": true }
        ]
      },
      "optional": true
    }
  ]
}
```

### Requirements

```jsonc
{
  "requires": {
    "bins": ["ffmpeg"],
    "env": ["DISCORD_BOT_TOKEN"],
    "docker": [],
    "config": ["plugins.data.wopr-plugin-discord.botToken"],
    "os": ["linux", "darwin"],
    "node": ">=22.0.0",
    "network": {
      "outbound": true,
      "inbound": false,
      "p2p": false,
      "hosts": ["discord.com", "gateway.discord.gg"]
    },
    "services": [],
    "storage": {
      "persistent": true,
      "estimatedSize": "50MB"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `bins` | `string[]` | Executables checked via `which` |
| `env` | `string[]` | Required environment variables |
| `docker` | `string[]` | Required Docker images |
| `config` | `string[]` | Required config keys (dot-notation) |
| `os` | `("linux"\|"darwin"\|"win32")[]` | Supported platforms. Empty = all. |
| `node` | `string` | Node.js semver range (e.g., `">=22.0.0"`) |
| `network.outbound` | `boolean` | Makes outbound HTTP/WS calls |
| `network.inbound` | `boolean` | Listens on ports |
| `network.p2p` | `boolean` | Uses peer-to-peer (Hyperswarm) |
| `network.ports` | `number[]` | Ports the plugin binds |
| `network.hosts` | `string[]` | Hostnames it connects to |
| `services` | `string[]` | External services (e.g., `"redis"`) |
| `storage.persistent` | `boolean` | Needs persistent disk |
| `storage.estimatedSize` | `string` | Estimated disk usage |

### Install Methods

Ordered list of ways to install missing dependencies. The platform tries them in order.

```jsonc
{
  "install": [
    { "kind": "brew", "formula": "ffmpeg", "label": "Install FFmpeg via Homebrew" },
    { "kind": "apt", "package": "ffmpeg", "label": "Install FFmpeg via apt" },
    { "kind": "docker", "image": "jrottenberg/ffmpeg", "tag": "latest" },
    { "kind": "manual", "instructions": "Download from https://ffmpeg.org/download.html" }
  ]
}
```

| Kind | Required Fields | Description |
|------|----------------|-------------|
| `brew` | `formula` | Homebrew formula |
| `apt` | `package` | apt package name |
| `pip` | `package` | pip package name |
| `npm` | `package` | npm package name |
| `docker` | `image` | Docker image (optional `tag`) |
| `script` | `url` | Install script URL |
| `manual` | `instructions` | Human-readable fallback |

All kinds accept optional `bins` (binaries the install provides) and `label` (human-readable step name).

### Lifecycle

```jsonc
{
  "lifecycle": {
    "healthEndpoint": "/healthz",
    "healthIntervalMs": 30000,
    "hotReload": true,
    "shutdownBehavior": "graceful",
    "shutdownTimeoutMs": 10000
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `healthEndpoint` | `string` | none | HTTP path the platform pings for liveness |
| `healthIntervalMs` | `number` | `30000` | Poll interval for health checks |
| `hotReload` | `boolean` | `false` | Plugin supports reload without restart |
| `shutdownBehavior` | `"graceful"\|"immediate"\|"drain"` | `"graceful"` | How the platform shuts down the plugin |
| `shutdownTimeoutMs` | `number` | `10000` | Max wait before force-kill |

Shutdown behaviors:
- **graceful**: Platform calls `shutdown()` and waits for the promise to resolve (up to `shutdownTimeoutMs`).
- **immediate**: Platform kills without calling `shutdown()`.
- **drain**: Platform stops routing new work to the plugin, waits for in-flight operations to complete, then calls `shutdown()`.

### Plugin Dependencies and Conflicts

```jsonc
{
  "dependencies": ["@wopr-network/plugin-p2p"],
  "conflicts": ["some-incompatible-plugin"],
  "minCoreVersion": "1.0.0"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `dependencies` | `string[]` | Other plugins that must be loaded first |
| `conflicts` | `string[]` | Plugins that cannot be loaded alongside this one |
| `minCoreVersion` | `string` | Minimum WOPR core version (semver) |

## Complete Example

A Discord channel plugin's `package.json`:

```jsonc
{
  "name": "@wopr-network/plugin-discord",
  "version": "2.1.0",
  "main": "dist/index.js",
  "wopr": {
    "name": "@wopr-network/plugin-discord",
    "version": "2.1.0",
    "description": "Connect WOPR to Discord servers",
    "author": "WOPR Network",
    "license": "MIT",
    "homepage": "https://github.com/wopr-network/wopr-plugin-discord",
    "repository": "https://github.com/wopr-network/wopr-plugin-discord",
    "icon": "🎮",
    "category": "channel",
    "tags": ["discord", "chat", "bot", "gaming"],
    "capabilities": ["channel", "commands"],
    "minCoreVersion": "1.0.0",

    "configSchema": {
      "title": "Discord Bot Settings",
      "fields": [
        {
          "name": "botToken",
          "type": "password",
          "label": "Bot Token",
          "required": true,
          "secret": true,
          "setupFlow": "paste",
          "description": "Create a bot at discord.com/developers and copy the token"
        },
        {
          "name": "guildId",
          "type": "text",
          "label": "Server ID",
          "required": true,
          "setupFlow": "paste",
          "placeholder": "Right-click server > Copy Server ID"
        },
        {
          "name": "channelIds",
          "type": "array",
          "label": "Channel IDs",
          "description": "Channels the bot listens in (empty = all)",
          "items": { "name": "channelId", "type": "text", "label": "Channel ID" },
          "setupFlow": "none"
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

    "setup": [
      {
        "id": "credentials",
        "title": "Bot Credentials",
        "description": "Create a Discord bot and paste the token.\n\n1. Go to [Discord Developer Portal](https://discord.com/developers)\n2. Create an application\n3. Go to Bot > Reset Token > Copy",
        "fields": {
          "title": "Credentials",
          "fields": [
            { "name": "botToken", "type": "password", "label": "Bot Token", "required": true, "secret": true, "setupFlow": "paste" }
          ]
        }
      },
      {
        "id": "server",
        "title": "Server Selection",
        "description": "Right-click your Discord server and select 'Copy Server ID' (requires Developer Mode in Discord settings).",
        "fields": {
          "title": "Server",
          "fields": [
            { "name": "guildId", "type": "text", "label": "Server ID", "required": true, "setupFlow": "paste" }
          ]
        }
      }
    ],

    "requires": {
      "env": ["DISCORD_BOT_TOKEN"],
      "os": ["linux", "darwin", "win32"],
      "network": {
        "outbound": true,
        "inbound": false,
        "hosts": ["discord.com", "gateway.discord.gg", "cdn.discordapp.com"]
      },
      "storage": {
        "persistent": false
      }
    },

    "lifecycle": {
      "hotReload": false,
      "shutdownBehavior": "graceful",
      "shutdownTimeoutMs": 5000
    },

    "dependencies": [],
    "conflicts": []
  }
}
```

A P2P plugin:

```jsonc
{
  "name": "@wopr-network/plugin-p2p",
  "version": "1.0.0",
  "main": "dist/index.js",
  "wopr": {
    "name": "@wopr-network/plugin-p2p",
    "version": "1.0.0",
    "description": "Peer-to-peer networking, identity, and encrypted messaging",
    "icon": "🌐",
    "category": "p2p",
    "capabilities": ["p2p", "commands"],
    "minCoreVersion": "1.0.0",

    "configSchema": {
      "title": "P2P Settings",
      "fields": [
        {
          "name": "discoveryTopic",
          "type": "text",
          "label": "Discovery Topic",
          "default": "wopr-default",
          "setupFlow": "none",
          "description": "Hyperswarm topic for peer discovery"
        }
      ]
    },

    "requires": {
      "os": ["linux", "darwin"],
      "network": {
        "outbound": true,
        "inbound": true,
        "p2p": true
      },
      "storage": {
        "persistent": true,
        "estimatedSize": "10MB"
      }
    },

    "lifecycle": {
      "hotReload": false,
      "shutdownBehavior": "drain",
      "shutdownTimeoutMs": 15000
    }
  }
}
```

A voice STT plugin:

```jsonc
{
  "name": "@wopr-network/plugin-stt-whisper",
  "version": "1.0.0",
  "main": "dist/index.js",
  "wopr": {
    "name": "@wopr-network/plugin-stt-whisper",
    "version": "1.0.0",
    "description": "Local speech-to-text using Whisper",
    "icon": "🎤",
    "category": "voice",
    "capabilities": ["stt"],

    "configSchema": {
      "title": "Whisper STT Settings",
      "fields": [
        {
          "name": "model",
          "type": "select",
          "label": "Model Size",
          "default": "base",
          "options": [
            { "value": "tiny", "label": "Tiny (fastest, least accurate)" },
            { "value": "base", "label": "Base (balanced)" },
            { "value": "large", "label": "Large (slowest, most accurate)" }
          ],
          "setupFlow": "none"
        }
      ]
    },

    "requires": {
      "docker": ["ghcr.io/wopr-network/faster-whisper:latest"],
      "os": ["linux", "darwin"],
      "network": {
        "outbound": false,
        "inbound": false
      },
      "storage": {
        "persistent": true,
        "estimatedSize": "2GB"
      }
    },

    "install": [
      { "kind": "docker", "image": "ghcr.io/wopr-network/faster-whisper", "tag": "latest", "label": "Pull Whisper Docker image" },
      { "kind": "manual", "instructions": "Install faster-whisper: pip install faster-whisper" }
    ],

    "lifecycle": {
      "healthEndpoint": "/healthz",
      "healthIntervalMs": 15000,
      "hotReload": false,
      "shutdownBehavior": "drain",
      "shutdownTimeoutMs": 30000
    }
  }
}
```

## Backward Compatibility

The existing `pkg.wopr.plugin.requires` and `pkg.wopr.plugin.install` patterns used by voice plugins continue to work. The loader (`src/plugins/loading.ts`) already reads these. The new manifest schema is a superset: `pkg.wopr.requires` and `pkg.wopr.install` map directly to the same `PluginRequirements` and `InstallMethod[]` types.

Plugins can adopt the manifest incrementally:
1. **Minimum**: Just `name`, `version`, `description`, `capabilities` in the `wopr` field
2. **Recommended**: Add `configSchema` with `setupFlow` per field, `requires`, `category`
3. **Full**: Add `setup` wizard steps, `lifecycle`, `install` methods

The `WOPRPlugin.manifest` field remains optional for backward compatibility with plugins that don't use the manifest yet.

## Validation

The platform validates manifests at load time:
- `name`, `version`, `description`, `capabilities` are required
- `capabilities` must contain at least one valid value
- `category` must be a known value if present
- `configSchema.fields[].type` must be a known field type
- `configSchema.fields[].setupFlow` must be a known flow type if present
- `requires.os` values must be valid `process.platform` values
- `lifecycle.shutdownBehavior` must be a known behavior if present
- `minCoreVersion` is checked against the running core version

Invalid manifests produce clear error messages pointing to the offending field.
