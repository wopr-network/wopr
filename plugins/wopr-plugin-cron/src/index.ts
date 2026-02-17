import type { WOPRPlugin, WOPRPluginContext } from "../../../src/types.js";
import { initCronStorage } from "./cron-repository.js";
import { migrateCronsToSql } from "./cron-migrate.js";
import { createCronTickLoop } from "./cron-tick.js";
import { buildCronA2ATools } from "./cron-a2a-tools.js";

let tickInterval: ReturnType<typeof setInterval> | null = null;

const plugin: WOPRPlugin = {
  name: "wopr-plugin-cron",
  version: "1.0.0",
  description: "Cron scheduling — recurring and one-time message injection with optional script execution",

  async init(ctx: WOPRPluginContext) {
    // 1. Register storage schema and get repositories
    await initCronStorage(ctx.storage);

    // 2. Run idempotent JSON-to-SQL migration
    await migrateCronsToSql();

    // 3. Start tick loop (30s interval)
    const cronTick = createCronTickLoop(ctx);
    tickInterval = setInterval(cronTick, 30000);
    cronTick(); // Run immediately on startup

    // 4. Register A2A tools
    if (ctx.registerA2AServer) {
      ctx.registerA2AServer(buildCronA2ATools());
    }

    ctx.log.info("Cron plugin initialized");
  },

  async shutdown() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  },
};

export default plugin;
