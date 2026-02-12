# MCP Feasibility Study for WOPR Plugin Discovery

> **Status:** Research / Proposal
> **Issue:** WOP-95
> **Related:** WOP-63 (Plugin Manifest Specification)
> **Date:** 2026-02-12

## Executive Summary

The Model Context Protocol (MCP), now under the Linux Foundation's Agentic AI Foundation and backed by Anthropic, OpenAI, Google, Microsoft, and AWS, has reached 97M+ monthly SDK downloads and has an official registry for server discovery. This document evaluates the feasibility of exposing WOPR plugins as MCP servers and integrating MCP-based discovery into WOPR's plugin ecosystem.

**Recommendation:** Adopt a **hybrid bridge** approach. WOPR plugins should optionally expose an MCP server interface alongside the existing native plugin API. This enables external MCP clients (Claude Desktop, Cursor, OpenAI Agents SDK, etc.) to discover and use WOPR capabilities without requiring a full migration away from the native plugin system.

## 1. Current WOPR Plugin Architecture

### 1.1 Plugin Lifecycle

WOPR plugins follow a load-init-run-shutdown lifecycle managed by core:

1. **Install** from npm, GitHub, or local path into `~/wopr/plugins/<name>/`
2. **Enable** via `plugins.json`
3. **Load** at daemon startup: read `package.json`, validate manifest, dynamic ESM import
4. **Init** with a `WOPRPluginContext` providing session injection, config, events, middleware, and channel registration
5. **Run** indefinitely, reacting to events and channel messages
6. **Shutdown** gracefully on daemon stop

### 1.2 Plugin Manifest (WOP-63)

The manifest (`package.json` `wopr` field) declares:

| Field | Purpose |
|-------|---------|
| `capabilities` | What the plugin provides: `channel`, `provider`, `stt`, `tts`, `context`, `storage`, `memory`, `auth`, `webhook`, `commands`, `ui`, `a2a`, `p2p`, `middleware` |
| `configSchema` | Field-level config with setup flows (`paste`, `oauth`, `qr`, `interactive`, `none`) |
| `requires` | Runtime requirements: bins, env vars, docker images, OS, Node.js, network, storage |
| `lifecycle` | Health checks, hot reload, shutdown behavior |
| `setup` | Ordered wizard steps for onboarding |

### 1.3 Discovery

WOPR currently discovers plugins through:

- **Local installation**: `~/wopr/plugins/` directory scan
- **GitHub search**: `gh repo list` filtering for `wopr-plugin-*` repos
- **npm search**: `npm search wopr-plugin-*`
- **Plugin registries**: URL-based registries (stored in `plugin-registries.json`)
- **P2P discovery**: Hyperswarm DHT-based peer discovery (via `wopr-plugin-p2p`)

### 1.4 Plugin Context API

Plugins receive a rich context object:

```
WOPRPluginContext
  inject(session, message, options)   -- Get AI response
  logMessage(session, message, opts)  -- Log without AI response
  getSessions() / getSession(name)    -- Session access
  registerChannel(adapter)            -- Channel registration
  registerMiddleware(handler)         -- Middleware registration
  registerContextProvider(provider)   -- Context providers
  registerProvider(id, factory)       -- AI provider registration
  events / hooks                      -- Event bus and lifecycle hooks
  getConfig() / saveConfig()          -- Plugin configuration
  log                                 -- Structured logging
```

## 2. MCP Protocol Overview

### 2.1 Core Primitives

MCP defines three server-side primitives:

| Primitive | Purpose | Analogy in WOPR |
|-----------|---------|-----------------|
| **Tools** | Actions an LLM can invoke (computation, side effects, API calls). Each tool has a JSON Schema for inputs and returns structured results. | Plugin commands, session injection, A2A `sessions_send` |
| **Resources** | Read-only data exposed to clients for context. Identified by URIs. | Context providers, session history, config schemas |
| **Prompts** | Reusable prompt templates with parameters. | Session context files (`*.md`), skills |

Client-side primitives (roots, sampling, elicitation) are less relevant to the plugin-as-server use case but could enable advanced WOPR-initiated interactions.

### 2.2 Transport

MCP supports two transport mechanisms:

| Transport | How it works | Relevance |
|-----------|-------------|-----------|
| **Streamable HTTP** | Modern, fully-featured HTTP-based transport. Supports multi-node deployment. | Best fit for WOPR daemon (already runs an HTTP server) |
| **stdio** | JSON-RPC over stdin/stdout. Used for local subprocess-based servers. | Useful for CLI-based plugin invocation |

### 2.3 MCP Registry

The official MCP Registry (`registry.modelcontextprotocol.io`) provides:

- Centralized server discovery via API
- `.well-known` URL-based capability advertisement
- API v0.1 frozen (stable, no breaking changes)
- Servers self-register with metadata (name, description, capabilities, transport config)

### 2.4 TypeScript SDK

`@modelcontextprotocol/sdk` provides:

- `McpServer` class for building servers
- Transport adapters (Streamable HTTP, stdio)
- Tool, Resource, and Prompt registration APIs
- OAuth and auth helpers
- Middleware packages for common frameworks

## 3. Comparison: WOPR Plugins vs MCP Servers

### 3.1 Capability Mapping

| WOPR Capability | MCP Equivalent | Mapping Quality | Notes |
|----------------|----------------|-----------------|-------|
| `channel` | **Tools** (send/receive) + **Resources** (history) | Partial | MCP tools can model send; receiving requires client-side polling or sampling |
| `provider` | **Tools** (query model) | Good | Provider queries map cleanly to tool calls |
| `stt` / `tts` | **Tools** (transcribe/synthesize) | Good | Audio I/O as tool calls with binary data |
| `context` | **Resources** | Excellent | Context providers map directly to MCP resources with URIs |
| `storage` | **Resources** (read) + **Tools** (write) | Good | CRUD operations split across primitives |
| `memory` | **Resources** (query) + **Tools** (store) | Good | Similar to storage |
| `commands` | **Tools** | Excellent | CLI commands map 1:1 to MCP tools |
| `middleware` | N/A | Poor | MCP has no middleware concept; this is WOPR-internal |
| `webhook` | **Tools** | Good | Webhook triggers as tool invocations |
| `ui` | N/A | Poor | MCP is headless; UI components have no equivalent |
| `a2a` | **Tools** + **Sampling** | Good | Inter-agent messaging maps to tools; sampling enables server-initiated queries |
| `p2p` | **Tools** (connect, discover) + **Resources** (peers) | Partial | P2P is transport-level; MCP is application-level |
| `auth` | MCP OAuth integration | Partial | MCP has its own auth model (RFC 8707 resource indicators) |

### 3.2 Architectural Differences

| Aspect | WOPR Plugins | MCP Servers |
|--------|-------------|-------------|
| **Lifecycle** | Managed by WOPR daemon (load/init/shutdown) | Standalone processes or embedded in host |
| **State** | Shared in-process state via `WOPRPluginContext` | Stateless request/response (or session-scoped) |
| **Discovery** | npm/GitHub/registry/P2P | MCP Registry + `.well-known` URLs |
| **Config** | Rich schema with setup wizards, secrets, validation | None (handled by client) |
| **Events** | Push-based event bus | Pull-based (client polls) or sampling (server requests) |
| **Transport** | In-process function calls | HTTP or stdio (IPC) |
| **Security** | Trust levels, capabilities, sandbox isolation | OAuth 2.1, resource indicators |
| **Inter-plugin** | Direct via shared context and events | Separate servers, no built-in inter-server communication |

### 3.3 What WOPR Has That MCP Lacks

1. **Plugin configuration and setup wizards** -- MCP has no equivalent to `configSchema` with field-level setup flows. Configuration is entirely client-side.
2. **Middleware pipeline** -- Message transformation between channel and session has no MCP analogue.
3. **Event-driven composition** -- WOPR plugins react to lifecycle events; MCP is request/response.
4. **In-process performance** -- WOPR plugins run in the same process as core; MCP adds IPC/HTTP overhead.
5. **Dependency management** -- `requires`, `install`, OS/Node constraints, health checks.
6. **P2P networking** -- Hyperswarm DHT-based discovery is fundamentally different from MCP's centralized registry.

### 3.4 What MCP Has That WOPR Lacks

1. **Universal client compatibility** -- Any MCP client (Claude Desktop, Cursor, Windsurf, OpenAI Agents SDK, etc.) can use MCP servers. WOPR plugins only work inside WOPR.
2. **Standardized discovery** -- Official registry with API freeze, `.well-known` URLs.
3. **Massive ecosystem** -- 1000+ community-built servers already available.
4. **Cross-language support** -- SDKs in TypeScript, Python, Kotlin, C#, Java, Go, Swift, Rust.
5. **Industry backing** -- Linux Foundation governance with Anthropic, OpenAI, Google, Microsoft, AWS.

## 4. Migration Cost Estimate

### 4.1 Option A: Full Migration (Replace WOPR plugin system with MCP)

| Work Item | Effort | Risk |
|-----------|--------|------|
| Rewrite plugin loader to spawn MCP server processes | Large | High -- fundamental architecture change |
| Port all 10+ official plugins to MCP servers | Large | Medium -- each plugin needs rewrite |
| Replace event bus with MCP sampling/polling | Large | High -- loss of push semantics |
| Remove middleware system or emulate via MCP | Medium | High -- no MCP equivalent |
| Port config schemas to client-side handling | Medium | Medium -- loss of server-side validation |
| Update CLI commands to route through MCP | Medium | Low |
| Migrate P2P discovery to MCP registry | Large | High -- fundamentally different models |
| **Total** | **4-6 months** | **High** |

**Verdict:** Not recommended. The WOPR plugin system provides capabilities (middleware, events, in-process context, P2P) that MCP cannot replicate. A full migration would lose significant functionality.

### 4.2 Option B: Hybrid Bridge (Expose WOPR plugins as MCP servers alongside native API)

| Work Item | Effort | Risk |
|-----------|--------|------|
| Create `wopr-mcp-bridge` module that wraps loaded plugins as MCP servers | Medium | Low |
| Map plugin commands to MCP tools | Small | Low |
| Map context providers to MCP resources | Small | Low |
| Map session contexts / skills to MCP prompts | Small | Low |
| Add Streamable HTTP transport to WOPR daemon | Small | Low (already has HTTP server) |
| Add stdio transport for CLI usage | Small | Low |
| Register WOPR plugins in MCP registry | Small | Low |
| Add `mcp` field to plugin manifest (WOP-63 extension) | Small | Low |
| **Total** | **3-5 weeks** | **Low** |

**Verdict:** Recommended. Preserves the native plugin system while gaining MCP interoperability.

### 4.3 Option C: MCP Client Only (WOPR consumes external MCP servers as plugins)

| Work Item | Effort | Risk |
|-----------|--------|------|
| Add MCP client to WOPR daemon | Medium | Low |
| Create `mcp` plugin type that wraps remote MCP servers | Medium | Low |
| Map MCP tools to WOPR commands / A2A | Small | Low |
| Map MCP resources to context providers | Small | Low |
| Add MCP server discovery to plugin search | Small | Low |
| **Total** | **2-3 weeks** | **Low** |

**Verdict:** Complementary to Option B. Can be done independently or together.

## 5. Plugin-by-Plugin MCP Suitability

### 5.1 High Benefit

| Plugin | Why | MCP Mapping |
|--------|-----|-------------|
| **AI providers** (kimi, openai, anthropic) | External MCP clients could query WOPR-managed models | Tools: `query`, `models_list` |
| **A2A tools** | Cross-agent communication is a core MCP use case | Tools: `sessions_list`, `sessions_send`, `sessions_history` |
| **Context providers** | MCP resources are designed exactly for this | Resources: `wopr://context/{provider}` |
| **Commands** (all plugins with `commands` capability) | Direct 1:1 mapping | Tools: one per command |

### 5.2 Medium Benefit

| Plugin | Why | MCP Mapping |
|--------|-----|-------------|
| **STT/TTS** (whisper, piper) | MCP tools can handle transcription/synthesis | Tools: `transcribe`, `synthesize` |
| **Storage/Memory** | Standard CRUD via tools + read via resources | Tools + Resources |
| **Webhooks** | Trigger webhooks via MCP tool calls | Tools: `webhook_trigger` |

### 5.3 Low Benefit

| Plugin | Why | Limitation |
|--------|-----|------------|
| **Channels** (Discord, Slack, etc.) | Channels are event-driven with persistent connections; MCP is request/response | Incoming messages cannot be pushed to MCP clients without sampling |
| **P2P** | Hyperswarm is a fundamentally different transport | MCP has no P2P equivalent |
| **Middleware** | Internal pipeline, not externally useful | No MCP mapping |
| **UI components** | MCP is headless | No MCP mapping |

## 6. Proposed Design: Hybrid MCP Bridge

### 6.1 Architecture

```
                    External MCP Clients
                    (Claude, Cursor, etc.)
                           |
                    [MCP Protocol]
                    (Streamable HTTP / stdio)
                           |
              +------------+------------+
              |     WOPR MCP Bridge     |
              |  (wopr-mcp-bridge.ts)   |
              +------------+------------+
                           |
          +----------------+----------------+
          |                |                |
    [Tools]           [Resources]      [Prompts]
    from plugin       from context     from session
    commands +        providers +      contexts +
    inject/A2A        config schemas   skills
          |                |                |
          +----------------+----------------+
                           |
              +------------+------------+
              |    WOPR Plugin System   |
              |   (unchanged native)    |
              +-------------------------+
```

### 6.2 Manifest Extension (WOP-63 Alignment)

Add an optional `mcp` field to the plugin manifest:

```jsonc
{
  "wopr": {
    "name": "@wopr-network/plugin-discord",
    "capabilities": ["channel", "commands"],
    // ... existing manifest fields ...

    "mcp": {
      "enabled": true,
      "tools": [
        {
          "name": "discord_send",
          "description": "Send a message to a Discord channel",
          "inputSchema": {
            "type": "object",
            "properties": {
              "channelId": { "type": "string" },
              "message": { "type": "string" }
            },
            "required": ["channelId", "message"]
          }
        }
      ],
      "resources": [
        {
          "uri": "wopr://discord/channels",
          "name": "Discord Channels",
          "description": "List of connected Discord channels",
          "mimeType": "application/json"
        }
      ]
    }
  }
}
```

### 6.3 Auto-Generation from Existing Capabilities

For plugins that don't declare explicit MCP mappings, the bridge can auto-generate:

| WOPR Source | Generated MCP Primitive |
|-------------|------------------------|
| `plugin.commands.*` | Tool per command |
| `ctx.registerContextProvider(provider)` | Resource `wopr://context/{name}` |
| `ctx.inject(session, message)` | Tool `session_inject` |
| `ctx.getSessions()` | Resource `wopr://sessions` |
| Session context `.md` files | Prompt templates |
| `ctx.getConfig()` per plugin | Resource `wopr://config/{plugin}` |

### 6.4 Transport Integration

Since the WOPR daemon already runs a Hono HTTP server, add MCP endpoints:

- `POST /mcp` -- Streamable HTTP transport for MCP clients
- `GET /.well-known/mcp.json` -- MCP server metadata for registry discovery

For CLI usage, add a `wopr mcp serve` command that runs a stdio-based MCP server wrapping the loaded plugins.

### 6.5 Registry Integration

Publish WOPR's MCP endpoint to the official MCP Registry:

```json
{
  "name": "wopr",
  "description": "WOPR AI agent platform with session management, multi-provider support, and plugin ecosystem",
  "transport": {
    "type": "streamable-http",
    "url": "https://{host}/mcp"
  },
  "tools": ["session_inject", "sessions_list", "discord_send", ...],
  "resources": ["wopr://sessions", "wopr://context/*", ...]
}
```

## 7. Implementation Roadmap

### Phase 1: MCP Bridge Core (1-2 weeks)

1. Add `@modelcontextprotocol/sdk` dependency
2. Create `src/mcp/bridge.ts` that reads loaded plugins and generates MCP tool/resource/prompt registrations
3. Create `src/mcp/transport.ts` for Streamable HTTP integration with existing Hono server
4. Add `POST /mcp` and `GET /.well-known/mcp.json` endpoints
5. Auto-generate tools from plugin commands and `inject()`
6. Auto-generate resources from context providers and sessions

### Phase 2: Manifest Extension (1 week)

1. Add optional `mcp` field to `PluginManifest` type
2. Update manifest validation
3. Allow plugins to declare explicit MCP tool/resource mappings
4. Document the new field in `PLUGIN_MANIFEST.md`

### Phase 3: MCP Client Integration (1-2 weeks)

1. Add MCP client to WOPR daemon for consuming external MCP servers
2. Create `mcp` plugin capability type
3. Map external MCP tools to WOPR A2A tools
4. Map external MCP resources to context providers
5. Add MCP server discovery to `wopr plugin search`

### Phase 4: Registry and Polish (1 week)

1. Add `wopr mcp serve` CLI command for stdio transport
2. Publish to MCP Registry
3. Add `.well-known/mcp.json` generation from plugin manifests
4. Documentation and examples

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MCP spec changes before 1.0 | Medium | API v0.1 is frozen; use SDK abstractions |
| Performance overhead from HTTP transport | Low | Bridge is optional; native plugins remain in-process |
| Security model mismatch | Medium | MCP OAuth sits alongside WOPR trust levels; bridge enforces both |
| Ecosystem fragmentation (two ways to write plugins) | Medium | Clear docs: native for WOPR-specific features, MCP for interop |
| Channel plugins don't map well to MCP | Low | Don't force it; channels stay native, expose send as tool only |

## 9. Conclusion

MCP and WOPR's plugin system serve different needs that are complementary rather than competing:

- **WOPR plugins** excel at in-process, event-driven, stateful integrations with rich configuration and middleware.
- **MCP servers** excel at universal interoperability, standardized discovery, and connecting to the broader AI tooling ecosystem.

The hybrid bridge (Option B) is the recommended path:

1. **Low effort** (3-5 weeks total across 4 phases)
2. **Low risk** (additive, not replacing anything)
3. **High value** (WOPR becomes discoverable and usable by any MCP client)
4. **WOP-63 aligned** (manifest extension for MCP declarations)

The bridge makes WOPR a first-class citizen in the MCP ecosystem while preserving everything that makes the native plugin system powerful.
