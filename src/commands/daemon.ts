/**
 * `wopr daemon` commands - daemon lifecycle management.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { logger } from "../logger.js";
import { LOG_FILE } from "../paths.js";
import { help } from "./help.js";
import { getDaemonPid } from "./shared.js";

export async function daemonCommand(subcommand: string | undefined): Promise<void> {
  switch (subcommand) {
    case "start": {
      const existing = getDaemonPid();
      if (existing) {
        logger.info(`Daemon already running (PID ${existing})`);
        return;
      }
      const script = process.argv[1];
      const child = spawn("npx", ["tsx", script, "daemon", "run"], {
        detached: true,
        stdio: "ignore",
        shell: false,
      });
      child.on("error", (err) => {
        logger.error(`Failed to start daemon: ${err.message}`);
      });
      child.unref();
      const pid = child.pid;
      if (!pid) {
        logger.error("Failed to start daemon - could not obtain PID");
        return;
      }
      logger.info(`Daemon started (PID ${pid})`);
      break;
    }
    case "stop": {
      const pid = getDaemonPid();
      if (!pid) {
        logger.info("Daemon not running");
        return;
      }
      process.kill(pid, "SIGTERM");
      logger.info(`Daemon stopped (PID ${pid})`);
      break;
    }
    case "status": {
      const pid = getDaemonPid();
      logger.info(pid ? `Daemon running (PID ${pid})` : "Daemon not running");
      break;
    }
    case "run": {
      // Run the daemon directly (used by daemon start)
      const { startDaemon } = await import("../daemon/index.js");
      await startDaemon();
      break;
    }
    case "logs":
      if (existsSync(LOG_FILE)) {
        logger.info(readFileSync(LOG_FILE, "utf-8"));
      } else {
        logger.info("No logs");
      }
      break;
    default:
      help();
  }
}
