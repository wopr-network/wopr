/**
 * `wopr status` — Show system status overview.
 */
import { logger } from "../logger.js";
import { client, getDaemonPid } from "./shared.js";

export async function statusCommand(): Promise<void> {
  const pid = getDaemonPid();
  const running = await client.isRunning();

  if (!pid && !running) {
    logger.info("Daemon:    stopped");
    logger.info('Run "wopr daemon start" to start the daemon.');
    return;
  }

  if (pid && !running) {
    logger.info(`Daemon:    PID ${pid} (not responding)`);
    logger.info("The daemon process exists but is not accepting connections.");
    return;
  }

  // Daemon is running and responding
  logger.info(`Daemon:    running (PID ${pid ?? "unknown"})`);

  try {
    const plugins = await client.getPlugins();
    logger.info(`Plugins:   ${plugins.length} loaded`);
  } catch {
    logger.info("Plugins:   unknown (API error)");
  }

  try {
    const providers = (await client.getProviders()) as { id: string; available: boolean }[];
    const active = providers.filter((p) => p.available).length;
    logger.info(`Providers: ${active}/${providers.length} active`);
  } catch {
    logger.info("Providers: unknown (API error)");
  }
}
