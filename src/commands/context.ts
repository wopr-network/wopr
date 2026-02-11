/**
 * `wopr context` commands - context provider management.
 */
import { logger } from "../logger.js";
import { help } from "./help.js";
import { client, requireDaemon } from "./shared.js";

export async function contextCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  await requireDaemon();
  switch (subcommand) {
    case "list": {
      const providers = await client.getContextProviders();
      if (providers.length === 0) {
        logger.info("No context providers registered.");
      } else {
        logger.info("Context providers:");
        logger.info("Name              | Priority | Enabled");
        logger.info("------------------|----------|--------");
        for (const p of providers) {
          const name = p.name.padEnd(17);
          const priority = p.priority.toString().padEnd(8);
          const enabled = p.enabled ? "yes" : "no";
          logger.info(`${name}| ${priority}| ${enabled}`);
        }
      }
      break;
    }
    case "show": {
      if (!args[0]) {
        logger.error("Usage: wopr context show <name>");
        process.exit(1);
      }
      try {
        const p = await client.getContextProvider(args[0]);
        logger.info(`Context provider: ${p.name}`);
        logger.info(`  Priority: ${p.priority}`);
        logger.info(`  Enabled: ${p.enabled ? "yes" : "no"}`);
      } catch (_err: any) {
        logger.error(`Context provider not found: ${args[0]}`);
        process.exit(1);
      }
      break;
    }
    case "enable": {
      if (!args[0]) {
        logger.error("Usage: wopr context enable <name>");
        process.exit(1);
      }
      await client.enableContextProvider(args[0]);
      logger.info(`Enabled context provider: ${args[0]}`);
      break;
    }
    case "disable": {
      if (!args[0]) {
        logger.error("Usage: wopr context disable <name>");
        process.exit(1);
      }
      await client.disableContextProvider(args[0]);
      logger.info(`Disabled context provider: ${args[0]}`);
      break;
    }
    case "priority": {
      if (!args[0] || args[1] === undefined) {
        logger.error("Usage: wopr context priority <name> <priority>");
        logger.error("  Lower priority runs first (appears earlier in context)");
        process.exit(1);
      }
      const priority = parseInt(args[1], 10);
      if (Number.isNaN(priority)) {
        logger.error("Priority must be a number");
        process.exit(1);
      }
      await client.setContextProviderPriority(args[0], priority);
      logger.info(`Set ${args[0]} priority to ${priority}`);
      break;
    }
    default:
      help();
  }
}
