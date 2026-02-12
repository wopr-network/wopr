# Anthropic Tool Search / defer_loading Evaluation

**Issue:** WOP-151
**Date:** 2026-02-12
**Status:** Research complete — recommendation included

## Executive Summary

Anthropic's Tool Search feature enables Claude to dynamically discover tools on-demand instead of loading all definitions into the context window upfront. This document evaluates whether WOPR should adopt it, based on measured tool surface area, architecture fit, and cost/benefit analysis.

**Recommendation: YES, implement — but only after 3+ plugins register A2A tools, pushing total token overhead past the ~10K threshold where Tool Search provides meaningful benefit. Current core-only overhead is moderate (~5.5K tokens for 28 tools), well below that threshold.**

---

## 1. Current Token Usage from Tool Definitions

### Core A2A Tools (28 tools)

WOPR registers 28 core tools via `src/core/a2a-mcp.ts`:

| Category | Tools | Est. Tokens |
|----------|-------|-------------|
| Sessions | `sessions_list`, `sessions_send`, `sessions_history`, `sessions_spawn` | ~800 |
| Config | `config_get`, `config_set`, `config_provider_defaults` | ~500 |
| Memory | `memory_read`, `memory_write`, `memory_search`, `memory_get`, `self_reflect` | ~1,200 |
| Identity | `identity_get`, `identity_update` | ~400 |
| Soul | `soul_get`, `soul_update` | ~350 |
| Cron | `cron_schedule`, `cron_once`, `cron_list`, `cron_cancel`, `cron_history` | ~900 |
| Events | `event_emit`, `event_list` | ~250 |
| Security | `security_whoami`, `security_check` | ~300 |
| HTTP/Exec | `http_fetch`, `exec_command` | ~600 |
| Notify | `notify` | ~150 |
| **Total** | **28 core tools** | **~5,450** |

Token estimates are based on typical JSON Schema serialization of Zod schemas with descriptions. Each tool definition includes name, description, and full input_schema.

### Plugin Tools (variable)

Plugins register additional tools via `registerA2ATool()` or `registerA2AServer()` (see `src/plugins/schema-converter.ts`). The current `plugins.json` shows 3 voice plugins — none of which register A2A tools. However, the architecture is designed for growth:

- **28+ repos** in the wopr-network organization could each expose tools
- The Discord plugin alone could add 5-10 tools (channel management, message sending, etc.)
- Memory-semantic plugin adds search tools
- P2P plugin adds discovery/messaging tools

**Projected growth scenario:**

| Plugin Count | Est. Tools | Est. Token Overhead |
|--------------|-----------|-------------------|
| Core only | 28 | ~5.5K |
| +3 plugins | 40-50 | ~10-15K |
| +8 plugins | 70-100 | ~20-30K |
| +15 plugins | 120-180 | ~40-60K |
| Full ecosystem (28 repos) | 200+ | ~70K+ |

The 85% reduction claim from Anthropic's article measured against 50+ tools consuming ~72K tokens. WOPR's architecture is designed to reach this scale.

## 2. Applicability of `defer_loading: true`

### How It Works

The `defer_loading` parameter is part of the Anthropic Messages API (beta: `advanced-tool-use-2025-11-20`). When set on a tool definition:

1. The tool schema is sent to the API but NOT loaded into Claude's active context
2. A `tool_search_tool` (regex or BM25 variant) is added to the tools list
3. Claude searches for tools on-demand, receiving 3-5 relevant matches
4. Discovered tools are automatically expanded into full definitions

**Two search variants:**
- `tool_search_tool_regex_20251119` — Claude constructs Python regex patterns
- `tool_search_tool_bm25_20251119` — Claude uses natural language queries

### Architecture Fit with WOPR

WOPR's A2A MCP server is built in `src/core/a2a-mcp.ts` using `@anthropic-ai/claude-agent-sdk`'s `createSdkMcpServer()`. The current flow:

```
Plugin loads → registerA2ATool() → markDirty() → getA2AMcpServer() rebuilds
```

**Key consideration:** WOPR uses the Claude Agent SDK's MCP server, not the raw Messages API. The `defer_loading` parameter is a Messages API concept. For WOPR to use Tool Search:

1. **If using Agent SDK's MCP connector:** The SDK would need to support `defer_loading` in its tool registration. This depends on SDK version support for the `advanced-tool-use-2025-11-20` beta.

2. **If using the Messages API directly:** WOPR's `src/client.ts` would need to pass `defer_loading: true` on tool definitions when constructing API calls.

3. **If Anthropic's MCP client integration is used:** The API supports `mcp_toolset` with `default_config: { defer_loading: true }` and per-tool overrides via `configs`. This is the cleanest path if WOPR exposes tools via a standard MCP server (which it already does).

### Recommended Deferred vs. Non-Deferred Split

Keep frequently-used tools loaded (non-deferred):
- `sessions_list`, `sessions_send` — core coordination
- `memory_read`, `memory_write`, `memory_search` — used nearly every turn
- `config_get` — frequently needed for context

Defer everything else:
- `cron_*` tools (5 tools) — rarely used per-turn
- `identity_*`, `soul_*` tools (4 tools) — infrequent
- `http_fetch`, `exec_command` — situational
- `security_*` tools (2 tools) — diagnostic only
- All plugin-registered tools (variable)

This follows Anthropic's guidance: "Keep 3-5 most frequently used tools as non-deferred."

## 3. MCP Tool Annotations

MCP tool annotations (`destructiveHint`, `readOnlyHint`, `idempotentHint`) are part of the MCP specification (not the Anthropic Tool Search feature). They are separate concepts that provide safety metadata.

### Current State in WOPR

WOPR does not currently set MCP tool annotations. Tools are registered via the SDK's `tool()` helper which accepts name, description, schema, and handler — no annotation support.

### Annotation Applicability

If the SDK or MCP protocol gains annotation support, WOPR's tools map cleanly:

| Tool | readOnly | destructive | idempotent |
|------|----------|-------------|------------|
| `sessions_list` | true | false | true |
| `sessions_send` | false | false | false |
| `sessions_history` | true | false | true |
| `sessions_spawn` | false | false | false |
| `config_get` | true | false | true |
| `config_set` | false | false | true |
| `config_provider_defaults` | true | false | true |
| `memory_read` | true | false | true |
| `memory_write` | false | false | false |
| `memory_search` | true | false | true |
| `memory_get` | true | false | true |
| `self_reflect` | false | false | false |
| `identity_get` | true | false | true |
| `identity_update` | false | false | true |
| `soul_get` | true | false | true |
| `soul_update` | false | false | true |
| `http_fetch` | varies | false | varies |
| `exec_command` | false | true | false |
| `cron_schedule` | false | false | false |
| `cron_once` | false | false | false |
| `cron_list` | true | false | true |
| `cron_cancel` | false | true | true |
| `cron_history` | true | false | true |
| `event_emit` | false | false | false |
| `event_list` | true | false | true |
| `security_whoami` | true | false | true |
| `security_check` | true | false | true |
| `notify` | false | false | false |

### Safety Benefits

Tool annotations would enable:
1. **Confirmation prompts** for destructive tools (`exec_command`, `cron_cancel`)
2. **Caching** of read-only tool results (`sessions_list`, `memory_read`, `config_get`)
3. **Retry safety** for idempotent tools (safe to retry on timeout)
4. **Trust-level gating** — WOPR's existing security system (`withSecurityCheck`) already does capability-based access control, but annotations would add a second layer at the protocol level

**Effort estimate:** Low. Adding annotations is a metadata-only change — no logic changes needed. Could be done in the `RegisteredTool` type and propagated through `createSdkMcpServer()`.

## 4. Recommendation

### Decision Matrix

| Factor | Score | Notes |
|--------|-------|-------|
| Current token overhead | Low (5.5K) | Below the 10K threshold where Tool Search helps |
| Projected overhead (3+ plugins) | High (15-60K+) | Well within the sweet spot |
| Architecture compatibility | Medium | Requires SDK/API integration work |
| Implementation effort | Medium | ~2-3 days for basic support |
| Risk | Low | Beta feature, but additive (no breaking changes) |
| Accuracy improvement | High | Anthropic reports 49% → 74% (Opus 4) with large tool sets |

### Phased Approach

**Phase 0 (Now — minimal effort):**
- Add MCP tool annotations to `RegisteredTool` type
- Classify all 28 core tools with `readOnly`/`destructive`/`idempotent` hints
- This is useful independent of Tool Search

**Phase 1 (When 3+ plugins register A2A tools):**
- Add `defer_loading` support to `registerA2ATool()` and `A2AToolDefinition`
- Default plugin tools to `defer_loading: true`
- Keep core high-frequency tools non-deferred
- Integrate `tool_search_tool_bm25` (better for natural language tool discovery)

**Phase 2 (When 10+ plugins or 50+ tools):**
- Implement custom embeddings-based tool search using WOPR's memory system
- Category-based tool grouping for better search accuracy
- Per-session tool preloading based on session context/purpose

### What NOT to Do

- Do not implement Tool Search now for 28 core-only tools — the overhead is too low to justify the complexity
- Do not build a custom search implementation before trying the built-in regex/BM25 variants
- Do not couple this to the existing security system — they solve different problems

## 5. Technical Notes

### API Requirements
- Beta header: `advanced-tool-use-2025-11-20`
- Supported models: Claude Opus 4.5+, Claude Sonnet 4.5+
- Max tools: 10,000
- Search returns: 3-5 tools per query

### SDK Considerations
- WOPR uses `@anthropic-ai/claude-agent-sdk`'s `createSdkMcpServer()`
- The SDK's `tool()` helper does not currently accept `defer_loading`
- Implementation would likely require either:
  - SDK update to support `defer_loading` in tool definitions
  - Direct Messages API integration bypassing the SDK's MCP layer
  - Using Anthropic's `mcp_toolset` connector with WOPR as a standard MCP server

### Prompt Caching Synergy
Tool Search is compatible with prompt caching. Deferred tools bypass the initial prompt, so cached conversations don't need to re-process tool definitions. This compounds the token savings in multi-turn WOPR sessions.

## References

- [Anthropic Advanced Tool Use (engineering blog)](https://www.anthropic.com/engineering/advanced-tool-use)
- [Tool Search Tool API Documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- WOPR source: `src/core/a2a-mcp.ts`, `src/core/a2a-tools/`, `src/plugins/schema-converter.ts`
