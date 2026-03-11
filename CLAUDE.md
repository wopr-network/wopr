# WOPR Core

`@wopr-network/wopr` — the runtime daemon, CLI, and plugin host.

## Commands

```bash
npm run build          # tsc — compile to dist/
npm run dev            # tsx src/cli.ts — run CLI without building
npm run daemon         # tsx src/daemon/index.ts — run daemon directly
npm run lint           # biome check src/
npm run lint:fix       # biome check --fix src/
npm run format         # biome format --write src/
npm run check          # lint + tsc --noEmit (run before committing)
npm test               # vitest run
npm run test:coverage  # vitest run --coverage
```

**Linter/formatter is Biome, not ESLint/Prettier.** Never add ESLint config.

## Architecture

```
src/
  cli.ts              # Entry point — parses commands, delegates to core
  daemon/index.ts     # Hono HTTP + WebSocket server (REST API for all functionality)
  core/
    config.ts         # Central config (single source of truth)
    capability-registry.ts  # Hosted capability catalog (TTS, ImageGen, etc.)
    capability-catalog.ts   # Available capability definitions
    capability-health.ts    # Health prober for capabilities
    channels.ts             # Channel adapter registry
    providers.ts            # LLM provider registry
    sessions.ts / session-*.ts  # Session lifecycle
    registries.ts / registries-*.ts  # Plugin registry (load, validate, store)
    events.ts               # Internal event bus
  plugins/
    registry.ts       # Plugin discovery and registration
    loading.ts        # Dynamic plugin import
    requirements.ts   # Capability dependency resolution
    hook-manager.ts   # Plugin lifecycle hooks
  plugin-types/       # Internal copy — canonical source is wopr-plugin-types repo
  memory/             # Persistence layer
  security/           # Input validation, auth
  commands/           # CLI subcommands
```

## Plugin System

Plugins are **separate repos** under `wopr-network/wopr-plugin-<name>`. Never add bundled plugins here.

- Plugins import from `@wopr-network/plugin-types` (published package)
- Plugins receive `WOPRPluginContext` at init time — they never import core internals
- Plugin registry lives in `src/plugins/registry.ts`
- Capability dependencies declared in plugin manifest → resolved by `src/plugins/requirements.ts`

## Business Model (Critical Context)

- Plugins are FREE. Revenue comes from hosted capabilities (TTS, ImageGen, etc.)
- `capability-registry.ts` is where hosted capabilities are registered
- Zero-downtime capability activation = revenue-critical (WOP-489)
- Declarative capability resolution: plugins declare `requires: ["tts"]`, platform resolves generically

## Issue Tracking

All issues in **Linear** (team: WOPR). No GitHub issues. PRs auto-move issues to In Review; merges auto-close to Done.

Issue descriptions start with `**Repo:** wopr-network/wopr` (required for CodeRabbit).

## Key Conventions

- Node ≥ 24, ESM (`"type": "module"`)
- Conventional commits: `feat:`, `fix:`, `test:`, `refactor:`, `security:`, `docs:`, `chore:`
- `npm run check` must pass before every commit (lint + type check)
- Daemon is Hono-based (not Express). WebSocket via `@hono/node-ws`.

## Marketing Context (Read Before Writing Any User-Facing Words)

Before writing any copy, changelog entry, feature description, error message, onboarding text, README section, or any string a human will read — consult these three Linear documents:

- **What We're Building and Why**: https://linear.app/wopr/document/wopr-what-were-building-and-why-d5fdeda00d27
- **Voice & Framing — How We Talk About WOPR**: https://linear.app/wopr/document/voice-and-framing-how-we-talk-about-wopr-e061b58bd3f7
- **Story Bank — Things WOPR Actually Did**: https://linear.app/wopr/document/story-bank-things-wopr-actually-did-093e59d3c986
- **Audiences — Who We're Talking To**: https://linear.app/wopr/document/audiences-who-were-talking-to-6bf24f81a0e9

The short version: never sell the feature, sell what happened. "Voice support" is wrong. "It called me on my drive home to talk about a revenue stream it created" is right.

## Session Memory

At the start of every WOPR session, **read `~/.wopr-memory.md` if it exists.** It contains recent session context: which repos were active, what branches are in flight, and how many uncommitted changes exist. Use it to orient quickly without re-investigating.

The `Stop` hook writes to this file automatically at session end. Only non-main branches are recorded — if everything is on `main`, nothing is written for that repo.

## Gotchas

- **WebSocket auth**: Upgrade requests require auth token in `Sec-WebSocket-Protocol: auth.<token>` header. Remove `/ws` and `/api/ws` from SKIP_AUTH_PATHS; browser clients that can't set custom headers use this mechanism (WOP-1407).
- **Trust level defaults cascade**: When changing `DEFAULT_TRUST_BY_SOURCE` values, ALL downstream test assertions must be updated. Grep for hardcoded trust expectations in tests and fix them proactively (WOP-1408).
- **Always run `npm run check` before committing** — catches unused imports and type errors that block merge queue.
- **Plugin dependency checks after install**: In `installPlugin()`, run dependency validation AFTER the plugin is successfully installed and in the registry. Checking dependencies before install fails because the plugin isn't yet available to validate against (WOP-1461).
- **Rollback error handling**: When `removePlugin()` is called during dep-check failure, wrap it in try/catch. If removePlugin throws, log the error and return the original 422, not a generic 400 (WOP-1461).
- **Test mocks must match production**: Mock `normalizeDependencyName()` exactly as production implements it. If production does NOT strip "plugin-" prefix, tests must not either — mismatches cause false test passes and real failures in production (WOP-1461).
- **Plugin-types context must import canonical types**: `src/plugin-types/context.ts` is an internal copy. When provider methods use `ModelProvider`, import it from `types.ts` and use it (not `unknown`). Divergence breaks type safety for plugins (WOP-1465).

## Version Control: Prefer jj

Use `jj` (Jujutsu) for all VCS operations instead of `git`:
- `jj status`, `jj diff`, `jj log` for inspection
- `jj new` to start a change, `jj describe` to set the message
- `jj commit` to commit, `jj git push` to push
- `jj squash`, `jj rebase`, `jj edit` for history manipulation

Fall back to `git` only for operations not yet supported by `jj`.

