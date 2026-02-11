/**
 * CLI help text.
 */
import { logger } from "../logger.js";

export function help(): void {
  logger.info(`
wopr - Self-sovereign AI session management

Usage:
  wopr onboard                           Interactive onboarding wizard
  wopr configure                         Re-run configuration wizard

  wopr session create <name> [context]   Create a session with optional context
  wopr session create <name> --provider <id> [--fallback chain]  Create with provider
  wopr session inject <name> <message>   Inject a message into a session (gets AI response)
  wopr session log <name> <message>      Log a message to session history (no AI response)
  wopr session list                      List all sessions
  wopr session show <name> [--limit N]   Show session details and conversation history
  wopr session delete <name>             Delete a session
  wopr session set-provider <name> <id> [--model name] [--fallback chain]  Update session provider
  wopr session init-docs <name>          Initialize SOUL.md, AGENTS.md, USER.md for session

  wopr skill list                        List installed skills
  wopr skill install <url|slug> [name]   Install skill from URL or registry
  wopr skill create <name> [desc]        Create a new skill
  wopr skill remove <name>               Remove a skill
  wopr skill search <query>              Search registries for skills
  wopr skill cache clear                 Clear registry cache

  wopr skill registry list               List configured registries
  wopr skill registry add <name> <url>   Add a skill registry
  wopr skill registry remove <name>      Remove a registry

  wopr cron add <name> <sched> <sess> <msg>  Add scheduled injection [--now] [--once]
  wopr cron once <time> <session> <message>  One-time job (time: now, +5m, +1h, 09:00)
  wopr cron now <session> <message>          Run immediately (no scheduling)
  wopr cron remove <name>                    Remove a cron
  wopr cron list                             List crons

  wopr config get [key]                      Show config (all or specific key)
  wopr config set <key> <value>              Set config value (e.g., daemon.port)
  wopr config reset                          Reset to defaults
  wopr config list                           List all config values

  wopr daemon start                          Start scheduler daemon
  wopr daemon stop                           Stop daemon
  wopr daemon status                         Check if daemon is running
  wopr daemon logs                           Show daemon logs

  wopr auth                                  Show auth status
  wopr auth login                            Login with Claude Max/Pro (OAuth)
  wopr auth api-key <key>                    Use API key instead
  wopr auth logout                           Clear credentials

  wopr plugin list                           List installed plugins
  wopr plugin install <source>               Install (npm pkg, github:u/r, or ./local)
  wopr plugin remove <name>                  Remove a plugin
  wopr plugin enable <name>                  Enable a plugin
  wopr plugin disable <name>                 Disable a plugin
  wopr plugin reload <name>                  Reload a plugin (hot-reload code changes)
  wopr plugin search <query>                 Search npm for plugins

  wopr plugin registry list                  List plugin registries
  wopr plugin registry add <name> <url>      Add a plugin registry
  wopr plugin registry remove <name>         Remove a plugin registry

  wopr providers list                        List all providers and status
  wopr providers add <id> [credential]       Add/update provider credential
  wopr providers remove <id>                 Remove provider credential
  wopr providers health-check                Check health of all providers
  wopr providers default <id> [options]      Set global provider defaults
    --model <name>                           Default model for this provider
    --reasoning-effort <level>               For Codex: minimal/low/medium/high/xhigh
  wopr providers show-defaults [id]          Show global provider defaults

  wopr middleware list                       List all middleware
  wopr middleware chain                      Show execution order
  wopr middleware show <name>                Show middleware details
  wopr middleware enable <name>              Enable middleware
  wopr middleware disable <name>             Disable middleware
  wopr middleware priority <name> <n>        Set middleware priority

  wopr context list                          List all context providers
  wopr context show <name>                   Show context provider details
  wopr context enable <name>                 Enable context provider
  wopr context disable <name>                Disable context provider
  wopr context priority <name> <n>           Set context provider priority

Environment:
  WOPR_HOME                              Base directory (default: ~/wopr)
  ANTHROPIC_API_KEY                      API key for Claude (Anthropic)
  OPENAI_API_KEY                         API key for Codex (OpenAI)

Supported Providers:
  anthropic                              Claude models via Agent SDK
  codex                                  OpenAI Codex agent for coding tasks

Install plugins for additional functionality:
  wopr plugin install wopr-plugin-p2p    P2P networking, identity, and peer management
  wopr plugin install wopr-plugin-discord Discord bot integration
`);
  process.exit(0);
}
