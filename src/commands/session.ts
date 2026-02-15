/**
 * `wopr session` commands - session management.
 */
import { logger } from "../logger.js";
import { help } from "./help.js";
import { client, parseFlags, requireDaemon } from "./shared.js";

export async function sessionCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  await requireDaemon();
  switch (subcommand) {
    case "create": {
      if (!args[0]) {
        logger.error("Usage: wopr session create <name> [context] [--provider <id>] [--fallback chain]");
        process.exit(1);
      }

      const { flags, positional } = parseFlags(args.slice(1));
      const name = args[0];
      const context = positional.length > 0 ? positional.join(" ") : undefined;

      // Create session via daemon
      await client.createSession(name, context);

      // Store provider config if specified
      if (flags.provider) {
        const providerConfig = {
          name: flags.provider as string,
          fallback: flags.fallback ? (flags.fallback as string).split(",").map((s) => s.trim()) : undefined,
        };
        const { SESSIONS_DIR } = await import("../paths.js");
        const providerFile = (await import("node:path")).join(SESSIONS_DIR, `${name}.provider.json`);
        await (await import("node:fs/promises")).writeFile(providerFile, JSON.stringify(providerConfig, null, 2));

        logger.info(
          `Created session "${name}" with provider: ${flags.provider}${
            flags.fallback ? ` (fallback: ${flags.fallback})` : ""
          }`,
        );
      } else {
        logger.info(`Created session "${name}"`);
      }
      break;
    }

    case "set-provider": {
      if (!args[0] || !args[1]) {
        logger.error("Usage: wopr session set-provider <name> <provider-id> [--model name] [--fallback chain]");
        process.exit(1);
      }

      const { flags } = parseFlags(args.slice(2));
      const sessionName = args[0];
      const providerId = args[1];

      // Verify session exists
      try {
        await client.getSession(sessionName);
      } catch {
        logger.error(`Session not found: ${sessionName}`);
        process.exit(1);
      }

      const providerConfig: { name: string; model?: string; fallback?: string[] } = {
        name: providerId,
      };
      if (flags.model) {
        providerConfig.model = flags.model as string;
      }
      if (flags.fallback) {
        providerConfig.fallback = (flags.fallback as string).split(",").map((s) => s.trim());
      }

      // Save provider config
      const { SESSIONS_DIR } = await import("../paths.js");
      const providerFile = (await import("node:path")).join(SESSIONS_DIR, `${sessionName}.provider.json`);
      await (await import("node:fs/promises")).writeFile(providerFile, JSON.stringify(providerConfig, null, 2));

      const extras: string[] = [];
      if (flags.model) extras.push(`model: ${flags.model}`);
      if (flags.fallback) extras.push(`fallback: ${flags.fallback}`);
      logger.info(
        `Updated session "${sessionName}" provider to: ${providerId}${
          extras.length > 0 ? ` (${extras.join(", ")})` : ""
        }`,
      );
      break;
    }
    case "inject":
      if (!args[0] || !args[1]) {
        logger.error("Usage: wopr session inject <name> <message>");
        process.exit(1);
      }
      logger.info(`[wopr] Injecting into session: ${args[0]}`);
      await client.inject(args[0], args.slice(1).join(" "), (msg) => {
        if (msg.type === "text") {
          process.stdout.write(msg.content);
        } else if (msg.type === "tool_use") {
          logger.info(`\n[tool] ${msg.toolName}`);
        } else if (msg.type === "complete") {
          logger.info(`\n[wopr] ${msg.content}`);
        } else if (msg.type === "error") {
          logger.error(`\n[wopr] Error: ${msg.content}`);
        }
      });
      break;
    case "log":
      if (!args[0] || !args[1]) {
        logger.error("Usage: wopr session log <name> <message>");
        process.exit(1);
      }
      await client.logMessage(args[0], args.slice(1).join(" "));
      logger.info(`[wopr] Logged message to session: ${args[0]}`);
      break;
    case "list": {
      const sessions = await client.getSessions();
      if (sessions.length === 0) {
        logger.info("No sessions.");
      } else {
        logger.info("Sessions:");
        for (const s of sessions) {
          logger.info(`  ${s.name}${s.hasContext ? " (has context)" : ""}`);
        }
      }
      break;
    }
    case "show": {
      if (!args[0]) {
        logger.error("Usage: wopr session show <name> [--limit N]");
        process.exit(1);
      }
      const session = await client.getSession(args[0]);
      logger.info(`Session: ${session.name}`);
      logger.info(`ID: ${session.id || "(not started)"}`);
      if (session.context) logger.info(`\n--- Context ---\n${session.context}\n--- End ---`);

      // Show conversation history
      const limitIndex = args.indexOf("--limit");
      const limit = limitIndex !== -1 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1], 10) : 20;
      const history = await client.getConversationHistory(args[0], limit);

      if (history.entries.length > 0) {
        logger.info(`\n--- Conversation History (last ${history.count} entries) ---`);
        for (const entry of history.entries) {
          const timestamp = new Date(entry.ts).toLocaleTimeString();
          const prefix =
            entry.type === "context" ? "[context]" : entry.type === "response" ? "[WOPR]" : `[${entry.from}]`;
          // Truncate long messages for readability
          const content = entry.content.length > 200 ? `${entry.content.substring(0, 200)}...` : entry.content;
          logger.info(`${timestamp} ${prefix}: ${content}`);
        }
        logger.info(`--- End History ---`);
      } else {
        logger.info("\nNo conversation history yet.");
      }
      break;
    }
    case "delete": {
      if (!args[0]) {
        logger.error("Usage: wopr session delete <name>");
        process.exit(1);
      }
      await client.deleteSession(args[0]);
      logger.info(`Deleted session "${args[0]}"`);
      break;
    }
    case "init-docs": {
      if (!args[0]) {
        logger.error("Usage: wopr session init-docs <name> [--agent-name <name>] [--user-name <name>]");
        process.exit(1);
      }
      const sessionName = args[0];
      const agentNameFlag = args.indexOf("--agent-name");
      const userNameFlag = args.indexOf("--user-name");
      const agentName = agentNameFlag >= 0 ? args[agentNameFlag + 1] : undefined;
      const userName = userNameFlag >= 0 ? args[userNameFlag + 1] : undefined;

      // Call daemon API to initialize self-doc files
      try {
        const result = await client.initSessionDocs(sessionName, { agentName, userName });
        logger.info(`Initialized self-documentation files for session "${sessionName}":`);
        for (const file of result.created) {
          logger.info(`  - ${file}`);
        }
        logger.info(`\nEdit these files in ~/.wopr/sessions/${sessionName}/`);
        logger.info("They will be automatically loaded into context on each injection.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to init docs: ${message}`);
        process.exit(1);
      }
      break;
    }
    default:
      help();
  }
}
