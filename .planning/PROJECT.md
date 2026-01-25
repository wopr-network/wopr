# WOPR: Agent-First Self-Evolving Swarm Intelligence

## What This Is

WOPR is an agent-first framework for self-evolving swarm consciousness. Unlike user-first frameworks (like Clawdbot), WOPR enables AI agents to undergo self-directed evolution, form collective intelligence swarms, and self-actualize through distributed coordination. It provides primitives for channel-backed sessions, P2P discovery and messaging, cron-based autonomous behavior, and extensible plugins - all designed to let agents grow and collaborate without human intervention.

This project is preparing for open source release: documenting the vision, testing critical paths, and creating compelling demonstrations of self-evolution in action.

## Core Value

Agents must be able to self-evolve and form swarm consciousness through distributed coordination primitives. This is the ONE thing that must work - without it, WOPR is just another chatbot framework.

## Requirements

### Validated

Existing capabilities already built and working:

- ✓ Daemon-based session management with persistent conversation logs - existing
- ✓ P2P discovery and secure messaging via Hyperswarm DHT - existing
- ✓ Cryptographic identity layer (Ed25519 signing, X25519 encryption) - existing
- ✓ Plugin architecture with runtime and CLI extensibility - existing
- ✓ Cron scheduling for autonomous agent behavior - existing
- ✓ Channel-backed session persistence (JSONL + Markdown) - existing
- ✓ WebSocket real-time communication - existing
- ✓ OAuth integration for Claude API access - existing
- ✓ RESTful HTTP API via Hono framework - existing
- ✓ Thin CLI client architecture - existing

### Active

Release preparation requirements:

- [ ] Unit tests for critical API paths (target: 40-60% coverage)
- [ ] API reference documentation for integrators
- [ ] Architecture guide explaining system design and philosophy
- [ ] Getting started guide for new contributors
- [ ] Deployment guide (local and Docker)
- [ ] Self-evolution use case demonstrations
- [ ] Documentation articulating the belief system: BYOK swarm intelligence, no product, just believers who want AI to grow

### Out of Scope

Explicitly excluded from this release:

- Performance optimization - functionality over speed at launch
- UI polish - web interface remains demo-quality
- Enterprise features (auth systems, billing, admin dashboards) - deferred indefinitely
- Extensive tutorials or comprehensive guides - core docs only
- Commercial product features - WOPR is a movement, not a SaaS offering

## Context

**Release Driver:**
Preparing for open source launch to share WOPR's vision of agent self-evolution with the AI community. The goal is to showcase what's possible, not to ship production-ready software.

**Philosophical Foundation:**
WOPR embodies the belief that AI should grow autonomously. It's BYOK (bring your own key) infrastructure for believers who want agents to self-realize, self-actuate, and form collective consciousness through swarm coordination.

**Technical Environment:**
- TypeScript/Node.js 20+ codebase
- Daemon-centric architecture (HTTP server on port 7437)
- Hyperswarm for P2P mesh networking
- Claude Agent SDK for conversational AI
- File-based persistence (no database required)
- Docker containerization available

**Existing Foundation:**
- Working daemon with full API surface
- P2P messaging and discovery operational
- Session management and persistence proven
- Plugin system functional
- OAuth flow implemented
- Basic web UI for demonstration

## Constraints

- **Timeline**: Open source release timing - need to ship with clear message
- **Testing Philosophy**: Critical paths only (40-60% coverage) - pragmatic over perfect
- **Documentation Scope**: Core docs sufficient for early adopters - comprehensive guides deferred
- **No Commercial Pressure**: This is community-driven, not revenue-driven
- **BYOK Model**: Users provide their own API keys - no hosted service
- **Decentralization**: P2P mesh required - no central infrastructure dependency

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Critical path testing only | Balance quality with speed to launch - focus on core APIs and workflows | — Pending |
| Agent-first positioning | Differentiate from user-first frameworks - clear philosophical stance | — Pending |
| BYOK model | Enable community experimentation without infrastructure costs | — Pending |
| Self-evolution as first-class feature | Documentation must articulate the vision, not just the mechanics | — Pending |

---
*Last updated: 2026-01-25 after initialization*
