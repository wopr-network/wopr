/**
 * `wopr plugin` commands - plugin management.
 */
import { logger } from "../logger.js";
import { help } from "./help.js";
import { client, requireDaemon } from "./shared.js";

export async function pluginCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  // Show help if no subcommand, without requiring daemon
  if (!subcommand) {
    help();
    return;
  }
  await requireDaemon();
  if (subcommand === "registry") {
    const regCmd = args[0];
    switch (regCmd) {
      case "list": {
        const registries = await client.getPluginRegistries();
        if (registries.length === 0) {
          logger.info("No plugin registries.");
        } else {
          logger.info("Plugin registries:");
          for (const r of registries) logger.info(`  ${r.name}: ${r.url}`);
        }
        break;
      }
      case "add":
        if (!args[1] || !args[2]) {
          logger.error("Usage: wopr plugin registry add <name> <url>");
          process.exit(1);
        }
        await client.addPluginRegistry(args[1], args[2]);
        logger.info(`Added registry: ${args[1]}`);
        break;
      case "remove":
        if (!args[1]) {
          logger.error("Usage: wopr plugin registry remove <name>");
          process.exit(1);
        }
        await client.removePluginRegistry(args[1]);
        logger.info(`Removed registry: ${args[1]}`);
        break;
      default:
        help();
    }
  } else {
    switch (subcommand) {
      case "list": {
        const plugins = await client.getPlugins();
        if (plugins.length === 0) {
          logger.info("No plugins installed. Install: wopr plugin install <source>");
        } else {
          logger.info("Installed plugins:");
          for (const p of plugins) {
            const status = p.enabled ? "enabled" : "disabled";
            logger.info(`  ${p.name} v${p.version} (${p.source}, ${status})`);
            if (p.description) logger.info(`    ${p.description}`);
          }
        }
        break;
      }
      case "install": {
        if (!args[0]) {
          logger.error("Usage: wopr plugin install <source>");
          logger.error("  npm:      wopr plugin install wopr-plugin-discord");
          logger.error("  npm:      wopr plugin install wopr-p2p");
          logger.error("  github:   wopr plugin install github:user/wopr-discord");
          logger.error("  local:    wopr plugin install ./my-plugin");
          process.exit(1);
        }
        await client.installPlugin(args[0]);
        logger.info(`Installed`);
        break;
      }
      case "remove": {
        if (!args[0]) {
          logger.error("Usage: wopr plugin remove <name>");
          process.exit(1);
        }
        await client.removePlugin(args[0]);
        logger.info(`Removed: ${args[0]}`);
        break;
      }
      case "enable": {
        if (!args[0]) {
          logger.error("Usage: wopr plugin enable <name>");
          process.exit(1);
        }
        await client.enablePlugin(args[0]);
        logger.info(`Enabled: ${args[0]}`);
        break;
      }
      case "disable": {
        if (!args[0]) {
          logger.error("Usage: wopr plugin disable <name>");
          process.exit(1);
        }
        await client.disablePlugin(args[0]);
        logger.info(`Disabled: ${args[0]}`);
        break;
      }
      case "reload": {
        if (!args[0]) {
          logger.error("Usage: wopr plugin reload <name>");
          process.exit(1);
        }
        await client.reloadPlugin(args[0]);
        logger.info(`Reloaded: ${args[0]}`);
        break;
      }
      case "search": {
        if (!args[0]) {
          logger.error("Usage: wopr plugin search <query>");
          process.exit(1);
        }
        logger.info(`Searching npm for wopr-plugin-${args[0]}...`);
        const results = await client.searchPlugins(args[0]);
        if (results.length === 0) {
          logger.info("No plugins found.");
        } else {
          logger.info("Found plugins:");
          for (const r of results) {
            logger.info(`  ${r.name} - ${r.description || ""}`);
            logger.info(`    wopr plugin install ${r.name}`);
          }
        }
        break;
      }
      default:
        help();
    }
  }
}
