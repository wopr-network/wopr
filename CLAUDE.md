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

## Session Memory

At the start of every WOPR session, **read `~/.wopr-memory.md` if it exists.** It contains recent session context: which repos were active, what branches are in flight, and how many uncommitted changes exist. Use it to orient quickly without re-investigating.

The `Stop` hook writes to this file automatically at session end. Only non-main branches are recorded — if everything is on `main`, nothing is written for that repo.