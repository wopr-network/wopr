#!/usr/bin/env node
/**
 * WOPR CLI - Thin client for the WOPR daemon
 *
 * All functionality runs through the HTTP daemon. The CLI is just a thin wrapper
 * that makes HTTP calls and formats output. Command implementations live in
 * src/commands/ -- this file only parses the top-level command and dispatches.
 */

import { existsSync } from "node:fs";
import { parseGlobalFlags } from "./cli-flags.js";
import { authCommand } from "./commands/auth.js";
import { configCommand } from "./commands/config.js";
import { contextCommand } from "./commands/context.js";
import { daemonCommand } from "./commands/daemon.js";
import { doctorCommand } from "./commands/doctor.js";
import { help } from "./commands/help.js";
import { initCommand } from "./commands/init.js";
import { middlewareCommand } from "./commands/middleware.js";
import { pluginCommand } from "./commands/plugin.js";
import { tryPluginCommand } from "./commands/plugin-commands.js";
import { providersCommand } from "./commands/providers.js";
import { sessionCommand } from "./commands/session.js";
import { statusCommand } from "./commands/status.js";
import { setConfigFileOverride } from "./paths.js";

let configPath: string | undefined;
let remainingArgs: string[] = process.argv.slice(2);

try {
  ({ configPath, remainingArgs } = parseGlobalFlags(process.argv.slice(2)));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

if (configPath) {
  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }
  setConfigFileOverride(configPath);
}
const [command, subcommand, ...args] = remainingArgs;

(async () => {
  if (command === "providers") {
    await providersCommand(subcommand, args);
  } else if (command === "session") {
    await sessionCommand(subcommand, args);
  } else if (command === "config") {
    await configCommand(subcommand, args);
  } else if (command === "daemon") {
    await daemonCommand(subcommand);
  } else if (command === "auth") {
    await authCommand(subcommand, args);
  } else if (command === "plugin") {
    await pluginCommand(subcommand, args);
  } else if (command === "init") {
    await initCommand();
  } else if (command === "middleware") {
    await middlewareCommand(subcommand, args);
  } else if (command === "context") {
    await contextCommand(subcommand, args);
  } else if (command === "onboard") {
    const { onboardCommand } = await import("./commands/onboard/index.js");
    await onboardCommand(process.argv.slice(3));
  } else if (command === "configure") {
    const { onboardCommand } = await import("./commands/onboard/index.js");
    await onboardCommand(process.argv.slice(3));
  } else if (command === "status") {
    await statusCommand();
  } else if (command === "doctor") {
    await doctorCommand();
  } else {
    // Check for plugin commands
    const handled = await tryPluginCommand(command, [subcommand, ...args].filter(Boolean));
    if (!handled) {
      help();
    }
  }
})();
