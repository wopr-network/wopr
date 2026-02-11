/**
 * Plugin-scoped logger factory.
 *
 * Creates a logger instance that prefixes all messages with the plugin name.
 */

import { logger } from "../logger.js";
import type { PluginLogger } from "../types.js";

export function createPluginLogger(pluginName: string): PluginLogger {
  return {
    info: (message: string, ...args: any[]) => {
      logger.info(`[${pluginName}] ${message}`, ...args);
    },
    warn: (message: string, ...args: any[]) => {
      logger.warn(`[${pluginName}] ${message}`, ...args);
    },
    error: (message: string, ...args: any[]) => {
      logger.error(`[${pluginName}] ${message}`, ...args);
    },
    debug: (message: string, ...args: any[]) => {
      if (process.env.DEBUG) {
        logger.debug(`[${pluginName}] ${message}`, ...args);
      }
    },
  };
}
