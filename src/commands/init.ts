/**
 * `wopr init` / `wopr configure` commands - interactive configuration wizard.
 */
import { config } from "../core/config.js";
import { logger } from "../logger.js";

export async function initCommand(): Promise<void> {
  // Interactive onboarding wizard
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  logger.info("=== WOPR Configuration Wizard ===\n");

  // Load existing config
  await config.load();
  const existing = config.get();

  // Daemon settings
  logger.info("Daemon Settings:");
  const port = await rl.question(`  Port [${existing.daemon.port}]: `);
  if (port) config.setValue("daemon.port", parseInt(port, 10) || existing.daemon.port);

  const host = await rl.question(`  Host [${existing.daemon.host}]: `);
  if (host) config.setValue("daemon.host", host);

  const autoStart = await rl.question(`  Auto-start daemon? (y/n) [${existing.daemon.autoStart ? "y" : "n"}]: `);
  if (autoStart) config.setValue("daemon.autoStart", autoStart.toLowerCase() === "y");

  // Anthropic API Key
  logger.info("\nAnthropic:");
  const hasKey = existing.anthropic.apiKey ? "(configured)" : "(not set)";
  const apiKey = await rl.question(`  API Key ${hasKey}: `);
  if (apiKey) config.setValue("anthropic.apiKey", apiKey);

  // OAuth
  logger.info("\nOAuth (for claude.ai login):");
  const hasOAuth = existing.oauth.clientId ? "(configured)" : "(not set)";
  const clientId = await rl.question(`  Client ID ${hasOAuth}: `);
  if (clientId) {
    config.setValue("oauth.clientId", clientId);
    const clientSecret = await rl.question("  Client Secret: ");
    if (clientSecret) config.setValue("oauth.clientSecret", clientSecret);
    const redirectUri = await rl.question(
      `  Redirect URI [${existing.oauth.redirectUri || "http://localhost:3333/callback"}]: `,
    );
    config.setValue("oauth.redirectUri", redirectUri || "http://localhost:3333/callback");
  }

  // Discord
  logger.info("\nDiscord Bot (optional):");
  const hasDiscord = existing.discord?.token ? "(configured)" : "(not set)";
  const discordToken = await rl.question(`  Bot Token ${hasDiscord}: `);
  if (discordToken) {
    config.setValue("discord.token", discordToken);
    const guildId = await rl.question("  Guild ID (optional): ");
    if (guildId) config.setValue("discord.guildId", guildId);
  }

  // Discovery
  logger.info("\nDiscovery:");
  const topics = await rl.question(`  Auto-join topics (comma-separated) [${existing.discovery.topics.join(",")}]: `);
  if (topics)
    config.setValue(
      "discovery.topics",
      topics.split(",").map((t) => t.trim()),
    );

  const autoJoin = await rl.question(`  Auto-join on startup? (y/n) [${existing.discovery.autoJoin ? "y" : "n"}]: `);
  if (autoJoin) config.setValue("discovery.autoJoin", autoJoin.toLowerCase() === "y");

  // Save
  await config.save();
  rl.close();

  logger.info("\n\u2713 Configuration saved!");
  logger.info(`  Config file: ~/wopr/config.json`);
  logger.info("\nNext steps:");
  logger.info("  wopr daemon start    # Start the daemon");
  logger.info("  wopr session create  # Create a session");
}
