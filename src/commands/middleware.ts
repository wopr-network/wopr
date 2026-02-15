/**
 * `wopr middleware` commands - middleware management.
 */
import { logger } from "../logger.js";
import { help } from "./help.js";
import { client, requireDaemon } from "./shared.js";

export async function middlewareCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  await requireDaemon();
  switch (subcommand) {
    case "list": {
      const middlewares = await client.getMiddlewares();
      if (middlewares.length === 0) {
        logger.info("No middleware registered.");
      } else {
        logger.info("Middlewares:");
        logger.info("Name              | Priority | Enabled | Hooks");
        logger.info("------------------|----------|---------|-------");
        for (const m of middlewares) {
          const name = m.name.padEnd(17);
          const priority = m.priority.toString().padEnd(8);
          const enabled = (m.enabled ? "yes" : "no").padEnd(7);
          const hooks = [];
          if (m.hasIncoming) hooks.push("in");
          if (m.hasOutgoing) hooks.push("out");
          logger.info(`${name}| ${priority}| ${enabled}| ${hooks.join(",") || "-"}`);
        }
      }
      break;
    }
    case "chain": {
      const chain = await client.getMiddlewareChain();
      if (chain.length === 0) {
        logger.info("No middleware in chain.");
      } else {
        logger.info("Middleware chain (execution order):");
        for (let i = 0; i < chain.length; i++) {
          const m = chain[i];
          const status = m.enabled ? "\u2713" : "\u2717";
          logger.info(`  ${i + 1}. [${status}] ${m.name} (priority: ${m.priority})`);
        }
      }
      break;
    }
    case "show": {
      if (!args[0]) {
        logger.error("Usage: wopr middleware show <name>");
        process.exit(1);
      }
      try {
        const m = await client.getMiddleware(args[0]);
        logger.info(`Middleware: ${m.name}`);
        logger.info(`  Priority: ${m.priority}`);
        logger.info(`  Enabled: ${m.enabled ? "yes" : "no"}`);
        logger.info(`  Incoming hook: ${m.hasIncoming ? "yes" : "no"}`);
        logger.info(`  Outgoing hook: ${m.hasOutgoing ? "yes" : "no"}`);
      } catch (_err: unknown) {
        logger.error(`Middleware not found: ${args[0]}`);
        process.exit(1);
      }
      break;
    }
    case "enable": {
      if (!args[0]) {
        logger.error("Usage: wopr middleware enable <name>");
        process.exit(1);
      }
      await client.enableMiddleware(args[0]);
      logger.info(`Enabled middleware: ${args[0]}`);
      break;
    }
    case "disable": {
      if (!args[0]) {
        logger.error("Usage: wopr middleware disable <name>");
        process.exit(1);
      }
      await client.disableMiddleware(args[0]);
      logger.info(`Disabled middleware: ${args[0]}`);
      break;
    }
    case "priority": {
      if (!args[0] || args[1] === undefined) {
        logger.error("Usage: wopr middleware priority <name> <priority>");
        logger.error("  Lower priority runs first (default: 100)");
        process.exit(1);
      }
      const priority = parseInt(args[1], 10);
      if (Number.isNaN(priority)) {
        logger.error("Priority must be a number");
        process.exit(1);
      }
      await client.setMiddlewarePriority(args[0], priority);
      logger.info(`Set ${args[0]} priority to ${priority}`);
      break;
    }
    default:
      help();
  }
}
