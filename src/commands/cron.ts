/**
 * `wopr cron` commands - scheduled injection management.
 */
import { parseTimeSpec } from "../core/cron.js";
import { logger } from "../logger.js";
import { help } from "./help.js";
import { client, requireDaemon } from "./shared.js";

export async function cronCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  await requireDaemon();
  switch (subcommand) {
    case "add": {
      const flags = { now: false, once: false };
      const filtered = args.filter((a) => {
        if (a === "--now") {
          flags.now = true;
          return false;
        }
        if (a === "--once") {
          flags.once = true;
          return false;
        }
        return true;
      });
      if (filtered.length < 4) {
        logger.error("Usage: wopr cron add <name> <schedule> <session> <message>");
        process.exit(1);
      }
      await client.addCron({
        name: filtered[0],
        schedule: filtered[1],
        session: filtered[2],
        message: filtered.slice(3).join(" "),
        once: flags.once || undefined,
      });
      logger.info(`Added cron: ${filtered[0]}`);
      if (flags.now) {
        await client.inject(filtered[2], filtered.slice(3).join(" "), (msg) => {
          if (msg.type === "text") process.stdout.write(msg.content);
        });
      }
      break;
    }
    case "once": {
      if (args.length < 3) {
        logger.error("Usage: wopr cron once <time> <session> <message>");
        process.exit(1);
      }
      const runAt = parseTimeSpec(args[0]);
      await client.addCron({
        name: `once-${Date.now()}`,
        schedule: "once",
        session: args[1],
        message: args.slice(2).join(" "),
        once: true,
        runAt,
      });
      logger.info(`Scheduled for ${new Date(runAt).toLocaleString()}`);
      break;
    }
    case "now":
      if (args.length < 2) {
        logger.error("Usage: wopr cron now <session> <message>");
        process.exit(1);
      }
      await client.inject(args[0], args.slice(1).join(" "), (msg) => {
        if (msg.type === "text") process.stdout.write(msg.content);
        else if (msg.type === "complete") logger.info(`\n[wopr] ${msg.content}`);
      });
      break;
    case "remove": {
      if (!args[0]) {
        logger.error("Usage: wopr cron remove <name>");
        process.exit(1);
      }
      await client.removeCron(args[0]);
      logger.info(`Removed: ${args[0]}`);
      break;
    }
    case "list": {
      const crons = await client.getCrons();
      if (crons.length === 0) {
        logger.info("No crons.");
      } else {
        logger.info("Crons:");
        for (const c of crons) {
          if (c.runAt) {
            logger.info(`  ${c.name}: once @ ${new Date(c.runAt).toLocaleString()}`);
          } else {
            logger.info(`  ${c.name}: ${c.schedule}${c.once ? " (one-time)" : ""}`);
          }
          logger.info(`    -> ${c.session}: "${c.message}"`);
        }
      }
      break;
    }
    default:
      help();
  }
}
