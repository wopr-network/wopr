# MCP Apps Evaluation for WOPR WebUI Extensibility

> **Status:** Proposal
> **Issue:** WOP-58
> **Related:** WOP-95 (MCP Feasibility Study), WOP-63 (Plugin Manifest)
> **Date:** 2026-02-12
> **Milestone:** Standalone WebUI

## 1. What MCP Apps Are and How They Work

### 1.1 Overview

MCP Apps is the first official extension to the Model Context Protocol, launched January 26, 2026. It allows MCP servers to return interactive HTML interfaces -- dashboards, forms, visualizations, multi-step workflows -- that render directly inside the conversation of an MCP host (Claude, Claude Desktop, VS Code, Goose, Postman, MCPJam).

Unlike standalone web apps, MCP Apps preserve conversational context, support bidirectional data flow through existing MCP primitives, and run in a sandboxed iframe with deny-by-default security.

### 1.2 Architecture

The pattern combines two MCP primitives: a **tool** that declares a UI resource in its metadata, and a **resource** that serves interactive HTML.

```
1. Tool definition   -- Tool declares _meta.ui.resourceUri pointing to a ui:// resource
2. Tool invocation   -- LLM calls the tool on the MCP server
3. Host renders      -- Host fetches the ui:// resource, renders it in a sandboxed iframe
4. Bidirectional     -- App and host communicate via JSON-RPC over postMessage
```

Sequence:

```
  User           Host/Agent         MCP App (iframe)      MCP Server
    |                |                     |                    |
    |-- "show X" --> |                     |                    |
    |                |-- tools/call ------>|                    |
    |                |                     |<-- ui:// fetch --- |
    |                |<-- tool result -----|                    |
    |                |-- push result ----->|                    |
    |                |                     |-- callServerTool ->|
    |                |                     |<-- fresh data -----|
    |<-- rendered ---|                     |                    |
```

### 1.3 Key Concepts

| Concept | Description |
|---------|-------------|
| **`ui://` URI scheme** | Declares UI resources in tool metadata via `_meta.ui.resourceUri`. Hosts preload these before the tool is called. |
| **Tool-UI linkage** | Tools reference UI resources through their `_meta.ui` metadata object, enabling the host to pair tool results with their visual representation. |
| **Bidirectional comms** | The iframe communicates with the host via JSON-RPC over `postMessage`. The app can call `callServerTool()` to invoke any MCP tool; the host can push tool results and context updates. |
| **CSP configuration** | `_meta.ui.csp` controls what external origins the app can load. `_meta.ui.permissions` requests device capabilities (mic, camera). |
| **Sandboxed iframe** | Apps cannot access the parent page DOM, cookies, storage, or scripts. All interaction goes through the auditable `postMessage` channel. |

### 1.4 SDK

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/ext-apps` | Main SDK: `App` class for UI-side, `registerAppTool` / `registerAppResource` for server-side |
| `@modelcontextprotocol/ext-apps/react` | React hooks for building MCP App UIs |
| `@modelcontextprotocol/ext-apps/app-bridge` | Host-side SDK for rendering apps in sandboxed iframes |
| `@mcp-ui/client` | Third-party React components for host implementations |

### 1.5 Client Support

MCP Apps are supported by: Claude (web), Claude Desktop, VS Code (Insiders), Goose, Postman, and MCPJam. The ecosystem is shipping and production-ready.

## 2. WOPR's Existing MCP Surface

### 2.1 A2A MCP Server

WOPR already exposes an MCP server (`src/core/a2a-mcp.ts`) using the Claude Agent SDK. This server provides 25+ core tools (sessions, config, memory, identity, cron, events, security, http, exec, notify) plus dynamically registered plugin tools.

The server is built with `@anthropic-ai/claude-agent-sdk`'s `createSdkMcpServer`, which creates a standard MCP-compatible server. Key points:

- Tools return `{ content: [{ type: "text", text: string }] }` -- standard MCP tool result format
- Plugin tools are auto-registered via `registerA2ATool()` and exposed alongside core tools
- The server is rebuilt when plugins register/unregister tools (dirty-flag caching)

### 2.2 Plugin Context UI Capabilities

The plugin system already defines two UI extension mechanisms:

**WebUiExtension** -- navigation links in the dashboard:
```typescript
interface WebUiExtension {
  id: string;
  title: string;
  url: string;
  description?: string;
  category?: string;
}
```

**UiComponentExtension** -- SolidJS components rendered inline:
```typescript
interface UiComponentExtension {
  id: string;
  title: string;
  moduleUrl: string;
  slot: "sidebar" | "settings" | "statusbar" | "chat-header" | "chat-footer";
  description?: string;
}
```

These are served via the daemon's HTTP API at `GET /api/plugins/ui` and `GET /api/plugins/components`.

### 2.3 MCP Feasibility Study (WOP-95)

The existing feasibility study (`docs/MCP_FEASIBILITY.md`) already recommends a **hybrid bridge** approach: expose WOPR plugins as MCP servers while keeping the native plugin system. The proposed bridge maps:

- Plugin commands -> MCP Tools
- Context providers -> MCP Resources (`wopr://context/{name}`)
- Session contexts/skills -> MCP Prompts
- Transport via Streamable HTTP on the daemon's existing Hono server

Notably, the feasibility study identifies the `ui` capability as **"Poor"** for MCP mapping because "MCP is headless; UI components have no equivalent." MCP Apps changes this assessment entirely.

## 3. Integration Points with the WebUI Plugin

### 3.1 What Changes with MCP Apps

MCP Apps fills the gap identified in WOP-95. The `ui` capability mapping is no longer "Poor" -- it maps cleanly to MCP Apps:

| WOPR UI Capability | MCP Apps Mapping | Quality |
|-------------------|------------------|---------|
| `WebUiExtension` (nav links) | App resource serving a full page | Good |
| `UiComponentExtension` (inline SolidJS) | App resource for a slot-specific UI | Good |
| Plugin config forms | App with form UI + `callServerTool` for config reads/writes | Excellent |
| Session chat interface | App with bidirectional messaging via `tools/call` | Good |
| Dashboard/monitoring | App with periodic `callServerTool` for metrics | Excellent |

### 3.2 How the WebUI Plugin Could Use MCP Apps

The WebUI plugin (`wopr-plugin-webui`) could expose its pages as MCP App resources, making WOPR's dashboard usable from any MCP Apps-compatible client:

1. **Dashboard App** -- Session list, system status, and metrics rendered as an interactive MCP App. Users in Claude Desktop could say "show me WOPR status" and get an embedded dashboard.

2. **Plugin Browser App** -- The plugin installer UI (WOP-230) served as an MCP App. Users could browse, install, and configure plugins directly from a Claude conversation.

3. **Chat Interface App** -- A WOPR session chat UI embedded in the MCP client. Send messages via `callServerTool("sessions_send")`, receive responses via tool result push.

4. **Configuration App** -- Plugin and system configuration forms. Read config with `callServerTool("config_get")`, write with `callServerTool("config_set")`.

5. **Memory Explorer App** -- Search and browse WOPR's memory store. Interactive search via `callServerTool("memory_search")`.

### 3.3 Architecture: Where MCP Apps Sit

```
  MCP Client (Claude, VS Code, etc.)
       |
  [MCP Protocol - Streamable HTTP]
       |
  +----+----+
  | WOPR    |
  | Daemon  |
  | (Hono)  |
  +----+----+
       |
  +----+----+------------+-------------+
  |         |            |             |
  A2A MCP   MCP Apps     Plugin       WebUI
  Server    Resources    System       Plugin
  (tools)   (ui://)     (native)     (SolidJS)
       \       |            /            |
        \      |           /             |
         +-----+---------+              |
         | WOPR MCP Bridge |            |
         | (future WOP-95) |            |
         +-----------------+            |
                                        |
                               Standalone Web UI
                               (existing, for browser)
```

The WebUI plugin continues to serve the standalone browser UI. MCP Apps adds a parallel path where the same tool interactions are wrapped in `ui://` resources for embedding in MCP clients.

### 3.4 Reuse Opportunity

The WebUI plugin uses SolidJS. MCP Apps supports any framework (React, Vue, Svelte, Preact, Solid, vanilla JS) via the `App` class from `@modelcontextprotocol/ext-apps`. This means:

- Existing SolidJS components could be adapted as MCP App UIs with minimal changes
- The `App` class replaces direct API calls with `callServerTool()` for data fetching
- The `PluginUiComponentProps.api` pattern already abstracts the API surface, making it straightforward to swap the transport layer

## 4. Recommended Approach

### 4.1 Decision: Integrate (Extend the MCP Bridge)

| Option | Description | Recommendation |
|--------|-------------|----------------|
| **Build from scratch** | Create a standalone MCP Apps server for WOPR | Not recommended. Duplicates the MCP bridge work from WOP-95. |
| **Integrate into MCP bridge** | Extend the planned MCP bridge (WOP-95) to serve `ui://` resources alongside tools/resources/prompts | **Recommended.** Minimal incremental effort on top of already-planned work. |
| **Defer** | Wait for MCP Apps ecosystem to mature further | Not recommended. The spec is stable (v2026-01-26), SDK is at v1.0.1, and 6+ major clients support it. |

### 4.2 Implementation Plan

#### Phase 0: Prerequisites (from WOP-95)

The MCP bridge from WOP-95 Phase 1 must land first. That provides:
- `@modelcontextprotocol/sdk` dependency
- `POST /mcp` endpoint on the Hono server (Streamable HTTP transport)
- Tool and resource registration from plugin capabilities

**If WOP-95 has not started:** MCP Apps work can be scoped as an extension to the WOP-95 implementation, done in the same pass.

#### Phase 1: MCP Apps Server Extension (1 week)

Add MCP Apps support to the MCP bridge:

1. **Add dependency**: `@modelcontextprotocol/ext-apps` (server-side helpers)
2. **Register App Tools**: For each tool that has a corresponding UI, use `registerAppTool` instead of plain `server.tool()`. The tool's `_meta.ui.resourceUri` points to a `ui://` resource.
3. **Register App Resources**: Serve bundled HTML pages as `ui://` resources via `registerAppResource`. Pages are built from the WebUI plugin's existing SolidJS components, bundled with Vite into single-file HTML.
4. **CSP configuration**: Configure `_meta.ui.csp` to allow the WOPR daemon's origin for API calls from within the iframe.

Example registration:

```typescript
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE }
  from "@modelcontextprotocol/ext-apps/server";

const dashboardUri = "ui://wopr/dashboard.html";

registerAppTool(server, "wopr_dashboard", {
  title: "WOPR Dashboard",
  description: "Interactive dashboard showing sessions, status, and metrics",
  inputSchema: {},
  _meta: { ui: { resourceUri: dashboardUri } },
}, async () => {
  const sessions = await getSessions();
  return { content: [{ type: "text", text: JSON.stringify(sessions) }] };
});

registerAppResource(server, dashboardUri, dashboardUri, {
  mimeType: RESOURCE_MIME_TYPE,
}, async () => {
  const html = await readFile("dist/apps/dashboard.html", "utf-8");
  return { contents: [{ uri: dashboardUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
});
```

#### Phase 2: App UIs (1-2 weeks)

Build the MCP App UIs. Start with high-value, low-complexity surfaces:

| App | Priority | Complexity | Notes |
|-----|----------|------------|-------|
| **Dashboard** | P1 | Medium | Session list, system status. Reuses WebUI dashboard components. |
| **Memory Explorer** | P1 | Low | Search interface. Single tool interaction (`memory_search`). |
| **Config Editor** | P2 | Medium | Form-based. Reuses config schema definitions. |
| **Plugin Browser** | P2 | Medium | Depends on WOP-230 landing first. |
| **Chat Interface** | P3 | High | Full bidirectional messaging. Most complex due to streaming. |

Each app is a Vite-bundled single-file HTML that uses the `App` class:

```typescript
import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "WOPR Dashboard", version: "1.0.0" });
app.connect();

app.ontoolresult = (result) => {
  // Render initial data pushed by host
  renderDashboard(JSON.parse(result.content[0].text));
};

document.getElementById("refresh").addEventListener("click", async () => {
  const result = await app.callServerTool({ name: "sessions_list", arguments: {} });
  renderDashboard(JSON.parse(result.content[0].text));
});
```

#### Phase 3: Plugin API for MCP Apps (1 week)

Extend the plugin context so any plugin can register MCP App surfaces:

```typescript
interface McpAppExtension {
  id: string;
  toolName: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  htmlPath: string;  // Path to bundled HTML file
  csp?: string[];    // Additional CSP origins
  permissions?: string[];  // iframe permissions (mic, camera, etc.)
}

// On WOPRPluginContext:
registerMcpApp(app: McpAppExtension): void;
unregisterMcpApp(id: string): void;
```

This lets third-party plugins expose their own MCP App UIs without touching core.

### 4.3 What NOT to Do

- **Do not replace the standalone WebUI.** MCP Apps are complementary. The browser-based SolidJS UI remains the primary interface for users who access WOPR directly. MCP Apps serve users who interact with WOPR through AI clients.
- **Do not duplicate the A2A tool surface.** MCP App tools should wrap existing A2A tools, not reimplement them. The App's `callServerTool()` invokes the same tool handlers.
- **Do not build a custom postMessage protocol.** Use the `@modelcontextprotocol/ext-apps` SDK. It handles the JSON-RPC dialect, initialization handshake, and security model.

## 5. Estimated Effort and Dependencies

### 5.1 Dependencies

| Dependency | Status | Blocking? |
|------------|--------|-----------|
| WOP-95 MCP Bridge (Phase 1) | Proposed | Yes -- MCP Apps extends the bridge |
| WOP-63 Plugin Manifest | Completed | No |
| WOP-230 Plugin Browser UI | In Progress | No (P2 app only) |
| `@modelcontextprotocol/sdk` v1.x | Stable | No |
| `@modelcontextprotocol/ext-apps` v1.0.1 | Stable | No |

### 5.2 Effort Estimate

| Phase | Work | Effort | Risk |
|-------|------|--------|------|
| Phase 1: MCP Apps Server Extension | Add ext-apps SDK, register app tools + resources | 1 week | Low |
| Phase 2: App UIs (Dashboard + Memory) | Build 2 bundled HTML apps with SolidJS | 1-2 weeks | Low |
| Phase 2: App UIs (Config + Plugin Browser) | Build 2 more apps | 1 week | Low |
| Phase 3: Plugin API | Extend WOPRPluginContext with `registerMcpApp` | 1 week | Low |
| **Total** | | **4-5 weeks** | **Low** |

This estimate assumes WOP-95 Phase 1 (MCP bridge) is done. If WOP-95 has not started, add 1-2 weeks for the bridge foundation.

### 5.3 Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| MCP Apps spec changes | Low | Low | v2026-01-26 spec is stable; SDK at v1.0.1 |
| SolidJS-to-MCP-App adaptation complexity | Medium | Low | MCP Apps is framework-agnostic; SolidJS works in iframes |
| Host rendering inconsistencies across clients | Medium | Medium | Test with Claude, VS Code, and basic-host; stick to standard HTML/CSS |
| CSP restrictions block required functionality | Low | Low | ext-apps SDK provides CSP configuration helpers |
| Performance of bundled single-file HTML | Low | Low | Vite + `vite-plugin-singlefile` is the recommended approach |

## 6. Conclusion

MCP Apps is production-ready and directly addresses the gap identified in WOP-95 around UI extensibility. WOPR is well-positioned to adopt it because:

1. **The A2A MCP server already exists** -- tools are registered and functional.
2. **The plugin context already has UI extension points** -- the pattern of registering UI surfaces is established.
3. **The MCP bridge is planned** -- MCP Apps is a natural extension, not a new initiative.
4. **The SDK is stable and framework-agnostic** -- SolidJS works without adaptation.

**Recommendation: Integrate MCP Apps as Phase 2 of the WOP-95 MCP Bridge implementation.** Start with Dashboard and Memory Explorer apps (highest value, lowest complexity), then expand to Config and Plugin Browser. Expose a plugin API so third-party plugins can register their own MCP App surfaces.

Total incremental effort beyond WOP-95: **4-5 weeks, low risk.**

## References

- [MCP Apps Documentation](https://modelcontextprotocol.io/docs/extensions/apps)
- [MCP Apps GitHub (ext-apps)](https://github.com/modelcontextprotocol/ext-apps)
- [MCP Apps Specification (2026-01-26)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [MCP Apps Launch Blog Post](http://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- [MCP Apps SDK API Docs](https://modelcontextprotocol.github.io/ext-apps/api/)
- [WOPR MCP Feasibility Study (WOP-95)](../MCP_FEASIBILITY.md)
