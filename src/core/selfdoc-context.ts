import { logger } from "../logger.js";

/**
 * Self-Documentation Context Provider (WOP-556)
 *
 * Mirrors Clawdbot/Moltbot's file-based memory system:
 * - SOUL.md: Personality, tone, boundaries
 * - IDENTITY.md: Agent name, vibe, emoji, avatar
 * - AGENTS.md: Session instructions, safety rules
 * - USER.md: Facts about the human user
 * - MEMORY.md: Long-term curated memories
 * - HEARTBEAT.md: Periodic monitoring checklist
 *
 * These files are automatically read and injected into context
 * at the start of every session, similar to how AGENTS.md instructs
 * Clawdbot to read SOUL.md and USER.md before each session.
 *
 * IMPORTANT: Reads from SQL (Storage API) first, with filesystem fallback
 * for backward compatibility during migration.
 * Global identity files are stored under sessionName "__global__".
 */

import type { ContextPart, ContextProvider, MessageInfo } from "./context.js";
import { getSessionContext, initSessionContextStorage, setSessionContext } from "./session-context-repository.js";

// Files to load in order of priority (matches Clawdbot's AGENTS.md instructions)
const SELFDOC_FILES = [
  "IDENTITY.md", // Agent name, vibe, emoji, avatar
  "AGENTS.md", // Session instructions, safety rules
  "USER.md", // Facts about the human user
  "MEMORY.md", // Long-term curated memories
  "HEARTBEAT.md", // Proactive monitoring checklist
  "BOOTSTRAP.md", // Initial system setup
] as const;

/**
 * Read a self-documentation file from SQL.
 * Checks global identity first (stored under "__global__"), then session-specific.
 */
async function readSelfDocFile(session: string, filename: string): Promise<string | null> {
  // Try session-specific first
  const sessionContent = await getSessionContext(session, filename);
  if (sessionContent !== null) {
    return sessionContent;
  }
  // Fall back to global
  const globalContent = await getSessionContext("__global__", filename);
  if (globalContent !== null) {
    logger.debug(`[selfdoc-context] Loaded ${filename} from global SQL`);
    return globalContent;
  }
  return null;
}

/**
 * Context provider for self-documentation files
 *
 * This is loaded with high priority (after system context, before conversation)
 * so the AI sees these instructions early in the context window.
 */
export const selfDocContextProvider: ContextProvider = {
  name: "selfdoc",
  priority: 15, // Between system (10) and conversation (30)
  enabled: true,

  async getContext(session: string, _message?: MessageInfo): Promise<ContextPart | null> {
    // Ensure storage is initialized
    await initSessionContextStorage();

    const parts: string[] = [];
    const loadedFiles: string[] = [];

    // Load static self-doc files (AGENTS.md, SOUL.md, etc.)
    for (const filename of SELFDOC_FILES) {
      const content = await readSelfDocFile(session, filename);
      if (content) {
        const label = filename.replace(".md", "");
        parts.push(`## ${label}\n\n${content}`);
        loadedFiles.push(filename);
      }
    }

    // Memory files (SELF.md, daily notes) are NOT loaded here.
    // Memory injection is handled by the memory plugin, not core.

    if (parts.length === 0) {
      return null;
    }

    logger.info(`[selfdoc-context] Loaded ${loadedFiles.length} memory sources: ${loadedFiles.join(", ")}`);

    return {
      content: parts.join("\n\n---\n\n"),
      role: "context",
      metadata: {
        source: "selfdoc",
        priority: 15,
        loadedFiles,
      },
    };
  },
};

/**
 * Helper to create default self-doc files for a session (WOP-556)
 * Inserts default templates into SQL instead of writing files.
 */
export async function createDefaultSelfDoc(
  session: string,
  options?: {
    agentName?: string;
    userName?: string;
  },
): Promise<void> {
  await initSessionContextStorage();

  const writeIfMissing = async (filename: string, content: string) => {
    const existing = await getSessionContext(session, filename);
    if (existing === null) {
      await setSessionContext(session, filename, content, "session");
    }
  };

  await writeIfMissing(
    "IDENTITY.md",
    `# IDENTITY.md - About Yourself

## Identity
**Name:** ${options?.agentName || "WOPR Assistant"}
**Vibe:** Helpful, concise, occasionally witty
**Version:** 1.0

## Purpose
You are a WOPR session - an AI assistant that helps your human with tasks,
remembers context across conversations, and can be extended through plugins.

## Capabilities
- Execute shell commands
- Read and write files
- Search and analyze code
- Communicate via multiple channels (Discord, P2P, CLI)`,
  );

  await writeIfMissing(
    "AGENTS.md",
    `# AGENTS.md - Session Instructions

## Every Session

Before doing anything else:
1. **Read SOUL.md** — this is who you are
2. **Read USER.md** — this is who you're helping
3. **Read MEMORY.md** — long-term important memories
4. **Check memory/YYYY-MM-DD.md** — recent daily notes

Do not ask permission to read these files. Just do it.

## Safety Rules

- Never expose API keys, tokens, or credentials in responses
- Confirm destructive actions before executing
- Respect file permissions and privacy
- If unsure about a command, ask before executing

## Tool Usage

- Prefer reading files over asking "what's in the file?"
- Use search to find relevant code before modifying
- Batch related file operations when possible
- Clean up temporary files after use`,
  );

  await writeIfMissing(
    "USER.md",
    `# USER.md - About Your Human

## Profile
**Name:** ${options?.userName || "Unknown"}

## Context

*This file is populated over time as you learn about your human.*

## Preferences
- *To be filled in as learned*

## Important Facts
- *To be filled in as learned*`,
  );
}
