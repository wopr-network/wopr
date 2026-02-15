/**
 * `wopr providers` commands - provider management.
 */
import { config } from "../core/config.js";
import { providerRegistry } from "../core/providers.js";
import { logger } from "../logger.js";
import { help } from "./help.js";
import { client, parseFlags, requireDaemon } from "./shared.js";

export async function providersCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  await requireDaemon();
  await providerRegistry.loadCredentials();

  switch (subcommand) {
    case "list": {
      const providers = (await client.getProviders()) as {
        id: string;
        name?: string;
        available?: boolean;
      }[];
      if (providers.length === 0) {
        logger.info("No providers registered.");
      } else {
        logger.info("Registered providers:");
        logger.info("ID              | Name              | Available");
        logger.info("----------------|-------------------|----------");
        for (const p of providers) {
          const id = p.id.padEnd(15);
          const name = (p.name || "N/A").padEnd(19);
          const status = p.available ? "Yes" : "No";
          logger.info(`${id}| ${name}| ${status}`);
        }
      }
      break;
    }

    case "add": {
      if (!args[0]) {
        logger.error("Usage: wopr providers add <provider-id> [credential]");
        process.exit(1);
      }

      const providerId = args[0];
      let credential = args[1];

      // If no credential provided, prompt for it
      if (!credential) {
        const readline = await import("node:readline/promises");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        credential = await rl.question(`Enter credential for ${providerId}: `);
        rl.close();

        if (!credential) {
          logger.error("Credential required");
          process.exit(1);
        }
      }

      try {
        await client.addProviderCredential(providerId, credential);
        logger.info(`Credential added for provider: ${providerId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to add credential: ${msg}`);
        process.exit(1);
      }
      break;
    }

    case "remove": {
      if (!args[0]) {
        logger.error("Usage: wopr providers remove <provider-id>");
        process.exit(1);
      }

      const providerId = args[0];
      try {
        await providerRegistry.removeCredential(providerId);
        logger.info(`Removed credential for provider: ${providerId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to remove credential: ${msg}`);
        process.exit(1);
      }
      break;
    }

    case "health-check": {
      logger.info("Checking provider health...");
      await client.checkProvidersHealth();

      const providers = (await client.getProviders()) as {
        id: string;
        available?: boolean;
      }[];
      const healthy = providers.filter((p) => p.available);
      const unhealthy = providers.filter((p) => !p.available);

      if (healthy.length > 0) {
        logger.info("\nHealthy:");
        for (const p of healthy) {
          logger.info(`  ${p.id}: OK`);
        }
      }

      if (unhealthy.length > 0) {
        logger.info("\nUnhealthy:");
        for (const p of unhealthy) {
          logger.info(`  ${p.id}: Not available`);
        }
      }

      if (providers.length === 0) {
        logger.info("No providers registered.");
      }
      break;
    }

    case "default": {
      if (!args[0]) {
        logger.error("Usage: wopr providers default <provider-id> [--model name] [--reasoning-effort level]");
        process.exit(1);
      }

      const providerId = args[0];
      const { flags } = parseFlags(args.slice(1));

      if (!flags.model && !flags["reasoning-effort"]) {
        logger.error("Specify at least one: --model <name> or --reasoning-effort <level>");
        process.exit(1);
      }

      // Set global provider defaults
      if (flags.model) {
        config.setProviderDefault(providerId, "model", flags.model as string);
      }
      if (flags["reasoning-effort"]) {
        config.setProviderDefault(providerId, "reasoningEffort", flags["reasoning-effort"] as string);
      }

      await config.save();

      const defaults = config.getProviderDefaults(providerId);
      logger.info(`Updated global defaults for ${providerId}:`);
      if (defaults?.model) logger.info(`  model: ${defaults.model}`);
      if (defaults?.reasoningEffort) logger.info(`  reasoningEffort: ${defaults.reasoningEffort}`);
      break;
    }

    case "show-defaults": {
      const providerId = args[0];

      if (providerId) {
        const defaults = config.getProviderDefaults(providerId);
        if (!defaults || Object.keys(defaults).length === 0) {
          logger.info(`No global defaults set for ${providerId}`);
        } else {
          logger.info(`Global defaults for ${providerId}:`);
          for (const [key, value] of Object.entries(defaults)) {
            logger.info(`  ${key}: ${value}`);
          }
        }
      } else {
        // Show all provider defaults
        const allConfig = config.get();
        if (!allConfig.providers || Object.keys(allConfig.providers).length === 0) {
          logger.info("No global provider defaults set.");
          logger.info("Set with: wopr providers default <id> --model <name>");
        } else {
          logger.info("Global provider defaults:");
          for (const [pid, defaults] of Object.entries(allConfig.providers)) {
            logger.info(`\n  ${pid}:`);
            for (const [key, value] of Object.entries(defaults as Record<string, unknown>)) {
              logger.info(`    ${key}: ${value}`);
            }
          }
        }
      }
      break;
    }

    default:
      help();
  }
}
