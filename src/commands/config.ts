/**
 * `wopr config` commands - configuration management.
 */
import { config } from "../core/config.js";
import { logger } from "../logger.js";
import { help } from "./help.js";

export async function configCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  // Config doesn't require daemon - it's local file management
  await config.load();

  switch (subcommand) {
    case "get":
    case "list": {
      if (args[0]) {
        // Get specific key
        const value = config.getValue(args[0]);
        if (value === undefined) {
          logger.error(`Config key "${args[0]}" not found`);
          process.exit(1);
        }
        logger.info(JSON.stringify(value, null, 2));
      } else {
        // Show all config
        logger.info(JSON.stringify(config.get(), null, 2));
      }
      break;
    }
    case "set": {
      if (!args[0] || args[1] === undefined) {
        logger.error("Usage: wopr config set <key> <value>");
        process.exit(1);
      }
      const key = args[0];
      let value: string | number | boolean | Record<string, unknown> | unknown[] = args.slice(1).join(" ");

      // Try to parse as JSON for objects/arrays/numbers/booleans
      try {
        value = JSON.parse(value);
      } catch {
        // Keep as string if not valid JSON
      }

      config.setValue(key, value);
      await config.save();
      logger.info(`Set ${key} = ${JSON.stringify(value)}`);
      break;
    }
    case "reset": {
      config.reset();
      await config.save();
      logger.info("Config reset to defaults");
      break;
    }
    default:
      help();
  }
}
