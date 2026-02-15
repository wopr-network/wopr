/**
 * WOPR Daemon - HTTP API Server
 *
 * Hono-based server providing REST API for all WOPR functionality.
 * Supports WebSocket for real-time streaming.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { setCanvasPublish } from "../core/canvas.js";
import { config as centralConfig } from "../core/config.js";
// Core imports for daemon functionality
import {
  addCronHistory,
  executeCronScripts,
  getCrons,
  resolveScriptTemplates,
  saveCrons,
  shouldRunCron,
} from "../core/cron.js";
// Provider registry imports
import { providerRegistry } from "../core/providers.js";
import { inject } from "../core/sessions.js";
import { logger as winstonLogger } from "../logger.js";
import { LOG_FILE, PID_FILE } from "../paths.js";
import { loadAllPlugins, registerPluginExtension, shutdownAllPlugins } from "../plugins.js";
import { ensureToken } from "./auth-token.js";
import { HealthMonitor } from "./health.js";
import { bearerAuth, requireAuth } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { checkReadiness, markCronRunning, markStartupComplete } from "./readiness.js";
import { apiKeysRouter } from "./routes/api-keys.js";
import { authRouter } from "./routes/auth.js";
import { canvasRouter } from "./routes/canvas.js";
import { configRouter } from "./routes/config.js";
import { cronsRouter } from "./routes/crons.js";
import { createHealthzRouter } from "./routes/health.js";
import { hooksRouter } from "./routes/hooks.js";
import { instancePluginsRouter } from "./routes/instance-plugins.js";
import { instancesRouter } from "./routes/instances.js";
import { marketplaceRouter } from "./routes/marketplace.js";
import { observabilityRouter } from "./routes/observability.js";
import { openaiRouter } from "./routes/openai.js";
import { pluginsRouter } from "./routes/plugins.js";
import { providersRouter } from "./routes/providers.js";
import { sessionsRouter } from "./routes/sessions.js";
import { skillsRouter } from "./routes/skills.js";
import { templatesRouter } from "./routes/templates.js";
import {
  getSubscriptionStats,
  HEARTBEAT_INTERVAL_MS,
  handleWebSocketClose,
  handleWebSocketMessage,
  heartbeatTick,
  publishToTopic,
  setupWebSocket,
} from "./ws.js";

const DEFAULT_PORT = parseInt(process.env.WOPR_DAEMON_PORT || "7437", 10);
const DEFAULT_HOST = process.env.WOPR_DAEMON_HOST || "127.0.0.1";

// Global error handlers - prevent crash on unhandled errors
process.on("uncaughtException", (error) => {
  winstonLogger.error(`[daemon] Uncaught exception: ${error.message}`);
  winstonLogger.error(`[daemon] Stack: ${error.stack}`);
  // Don't exit - log and continue
});

process.on("unhandledRejection", (reason, _promise) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  winstonLogger.error(`[daemon] Unhandled rejection: ${msg}`);
  if (stack) winstonLogger.error(`[daemon] Stack: ${stack}`);
  // Don't exit - log and continue
});

export interface DaemonConfig {
  port?: number;
  host?: string;
}

export function createApp(healthMonitor?: HealthMonitor) {
  const app = new Hono();

  // Middleware
  app.use("*", cors());
  app.use("*", logger());
  app.use("*", rateLimit());
  app.use("*", bearerAuth());

  // Health check (unauthenticated: /health)
  app.get("/", (c) =>
    c.json({
      name: "wopr",
      version: "0.0.1",
      status: "running",
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/ready", (c) => {
    const result = checkReadiness();
    return c.json(result, result.ready ? 200 : 503);
  });

  // API key management (WOP-209) — requireAuth() ensures user context
  app.use("/api/keys/*", requireAuth());
  app.route("/api/keys", apiKeysRouter);

  // Mount routers
  app.route("/auth", authRouter);
  app.route("/canvas", canvasRouter);
  app.route("/config", configRouter);
  app.route("/sessions", sessionsRouter);
  app.route("/crons", cronsRouter);
  app.route("/plugins", pluginsRouter);
  app.route("/skills", skillsRouter);
  app.route("/hooks", hooksRouter);
  app.route("/providers", providersRouter);
  app.route("/templates", templatesRouter);
  app.route("/observability", observabilityRouter);
  app.route("/v1", openaiRouter);

  // Per-instance plugin management (WOP-203)
  app.route("/api/instances/:id/plugins", instancePluginsRouter);
  // Marketplace (WOP-203)
  app.route("/api/marketplace", marketplaceRouter);
  // Instance CRUD (WOP-202)
  app.route("/instances", instancesRouter);

  // WebSocket stats endpoint (authenticated via bearerAuth middleware — not in SKIP_AUTH_PATHS)
  app.get("/ws/stats", (c) => c.json(getSubscriptionStats()));

  // Comprehensive health endpoint (unauthenticated)
  if (healthMonitor) {
    app.route("/healthz", createHealthzRouter(healthMonitor));
  }

  // Global error handler (defense-in-depth: prevents error detail leaks)
  app.onError((err, c) => {
    const status = err instanceof HTTPException ? err.status : 500;
    winstonLogger.error(`[daemon] Unhandled route error: ${err.message}`);
    return c.json({ error: status === 500 ? "Internal server error" : err.message }, status);
  });

  return app;
}

export function daemonLog(msg: string): void {
  const timestamp = new Date().toISOString();
  writeFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`, { flag: "a" });
}

function heapMB(): string {
  const m = process.memoryUsage();
  return `heap=${Math.round(m.heapUsed / 1024 / 1024)}MB rss=${Math.round(m.rss / 1024 / 1024)}MB`;
}

export async function startDaemon(config: DaemonConfig = {}): Promise<void> {
  const port = config.port ?? DEFAULT_PORT;
  const host = config.host ?? DEFAULT_HOST;

  // Inject WebSocket publish into core canvas to avoid cross-layer import
  setCanvasPublish(publishToTopic);

  daemonLog(`[heap] startup: ${heapMB()}`);

  // Track startup warnings/errors for clear reporting
  const startupWarnings: string[] = [];

  // Load config from disk first
  await centralConfig.load();
  daemonLog("Configuration loaded from disk");

  // Ensure bearer token exists for API authentication
  ensureToken();
  daemonLog("Bearer token ready for API authentication");

  // Write PID file
  writeFileSync(PID_FILE, process.pid.toString());
  daemonLog(`Daemon started (PID ${process.pid})`);

  // Initialize provider registry (load credentials only, providers register via plugins)
  daemonLog("Initializing provider registry...");
  try {
    await providerRegistry.loadCredentials();
    daemonLog("Provider credentials loaded");
  } catch (err) {
    const msg = `Provider registry initialization failed: ${err}`;
    daemonLog(`Warning: ${msg}`);
    startupWarnings.push(msg);
  }

  // Create health monitor
  const healthMonitor = new HealthMonitor({ version: "1.0.0" });

  // Create Hono app
  const app = createApp(healthMonitor);

  // Setup WebSocket using @hono/node-ws
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // WebSocket handler factory (shared by /ws and /api/ws)
  const wsHandler = upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      setupWebSocket(ws as unknown as { send(data: string): void });
    },
    onMessage(event, ws) {
      const data = event.data;
      if (data == null) return;
      let message: string;
      if (typeof data === "string") {
        message = data;
      } else if (Buffer.isBuffer(data)) {
        message = data.toString("utf-8");
      } else if (data instanceof ArrayBuffer) {
        message = Buffer.from(data).toString("utf-8");
      } else if (Array.isArray(data)) {
        message = Buffer.concat(data).toString("utf-8");
      } else {
        message = String(data);
      }
      try {
        handleWebSocketMessage(ws as unknown as { send(data: string): void }, message);
      } catch (err) {
        winstonLogger.error(
          `[daemon] WebSocket message handler error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    onClose(_event, ws) {
      handleWebSocketClose(ws as unknown as { send(data: string): void });
    },
  }));

  // WebSocket endpoints (WOP-204: /api/ws is the canonical path; /ws kept for backward compat)
  app.get("/ws", wsHandler);
  app.get("/api/ws", wsHandler);

  // Create injectors for plugins
  const injectors = {
    inject: async (
      session: string,
      message: string,
      options?: import("../types.js").PluginInjectOptions,
    ): Promise<string> => {
      // If source is provided, use it directly
      // Otherwise, parse the `from` field to create an appropriate security source
      let source = options?.source;
      if (!source && options?.from) {
        const { createInjectionSource } = await import("../security/types.js");
        const from = options.from;

        if (from.startsWith("p2p:")) {
          // P2P injection - parse peer key and create untrusted source
          const peerKey = from.slice(4); // Remove "p2p:" prefix
          source = createInjectionSource("p2p", {
            trustLevel: "untrusted", // P2P peers are untrusted by default
            identity: { publicKey: peerKey },
          });
          daemonLog(`[security] Created P2P source (untrusted) for peer ${peerKey.slice(0, 8)}...`);
        } else if (from === "cron") {
          source = createInjectionSource("cron");
        } else if (from === "api") {
          source = createInjectionSource("api", { trustLevel: "semi-trusted" });
        } else if (from.startsWith("plugin:")) {
          const pluginName = from.slice(7);
          source = createInjectionSource("plugin", {
            identity: { pluginName },
          });
        }
        // else: defaults to CLI (owner) in sessions.ts
      }

      const result = await inject(session, message, { silent: true, ...options, source });
      return result.response;
    },
    getSessions: () => {
      const { getSessions } = require("../core/sessions.js");
      return Object.keys(getSessions());
    },
  };

  daemonLog(`[heap] before memory hooks: ${heapMB()}`);

  // Initialize memory system hooks (session save on destroy)
  try {
    const { initMemoryHooks } = await import("../memory/index.js");
    initMemoryHooks();
    daemonLog("Memory system hooks initialized");
  } catch (err) {
    const msg = `Memory hooks initialization failed: ${err}`;
    daemonLog(`Warning: ${msg}`);
    startupWarnings.push(msg);
  }

  daemonLog(`[heap] after memory hooks: ${heapMB()}`);

  // Expose memory SQLite to plugins — they handle their own columns
  try {
    const { WOPR_HOME } = await import("../paths.js");
    const { join } = await import("node:path");
    const { createRequire } = await import("node:module");
    const _require = createRequire(import.meta.url);
    const { DatabaseSync } = _require("node:sqlite");
    const dbPath = join(WOPR_HOME, "memory", "index.sqlite");
    registerPluginExtension("core", "memory:db", new DatabaseSync(dbPath));
    daemonLog("Memory SQLite exposed to plugins as core.memory:db");
  } catch (err) {
    const msg = `Memory db extension setup failed: ${err}`;
    daemonLog(`Warning: ${msg}`);
    startupWarnings.push(msg);
  }

  daemonLog(`[heap] before plugins: ${heapMB()}`);

  // Load plugins (this is where providers register themselves)
  await loadAllPlugins(injectors);

  daemonLog(`[heap] after plugins: ${heapMB()}`);

  // Run initial memory sync — emits memory:filesChanged so plugins (e.g. semantic) can index
  // Only indexes global/session memory files, NOT session transcripts (those are huge and cause OOM)
  try {
    const { MemoryIndexManager } = await import("../memory/index.js");
    const { GLOBAL_IDENTITY_DIR, WOPR_HOME, SESSIONS_DIR } = await import("../paths.js");
    const { join } = await import("node:path");
    const { config: centralConfig } = await import("../core/config.js");
    interface ConfigWithMemory {
      memory?: unknown;
    }
    const memCfg = (centralConfig.get() as unknown as ConfigWithMemory).memory || {};
    const heap0 = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    daemonLog(`Memory sync starting (heap: ${heap0}MB)`);
    const mgr = await MemoryIndexManager.create({
      globalDir: GLOBAL_IDENTITY_DIR,
      sessionDir: join(SESSIONS_DIR, "_boot"),
      config: {
        ...memCfg,
        store: { path: join(WOPR_HOME, "memory", "index.sqlite") },
      },
    });
    await mgr.sync();
    const heap1 = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    daemonLog(`Initial memory sync complete (heap: ${heap1}MB)`);
  } catch (err) {
    const msg = `Initial memory sync failed: ${err}`;
    daemonLog(`Warning: ${msg}`);
    startupWarnings.push(msg);
  }

  // Check provider health after plugins have registered
  try {
    const providers = providerRegistry.listProviders();
    daemonLog(`Providers registered: ${providers.map((p) => p.id).join(", ") || "none (install provider plugins)"}`);
    daemonLog(`Provider details before health check: ${JSON.stringify(providers)}`);

    daemonLog(`Starting provider health check...`);
    await providerRegistry.checkHealth();
    daemonLog(`Health check complete, re-fetching providers...`);

    // Re-fetch providers AFTER health check to get updated availability
    const updatedProviders = providerRegistry.listProviders();
    daemonLog(`Provider details after health check: ${JSON.stringify(updatedProviders)}`);

    const available = updatedProviders
      .filter((p) => p.available)
      .map((p) => p.id)
      .join(", ");
    daemonLog(`Provider health check complete. Available: ${available || "none"}`);
  } catch (err) {
    const msg = `Provider health check failed: ${err}`;
    daemonLog(`Warning: ${msg}`);
    startupWarnings.push(msg);
  }

  // Report startup warnings clearly
  if (startupWarnings.length > 0) {
    daemonLog(`[startup] Completed with ${startupWarnings.length} warning(s):`);
    for (const w of startupWarnings) {
      daemonLog(`  - ${w}`);
    }
    winstonLogger.warn(
      `[daemon] Startup completed with ${startupWarnings.length} warning(s): ${startupWarnings.join("; ")}`,
    );
  } else {
    daemonLog("[startup] All systems initialized successfully");
  }

  // All subsystems initialized — mark startup complete for readiness probe
  markStartupComplete();

  // Start periodic health monitoring
  healthMonitor.start();
  healthMonitor.on("statusChange", ({ previous, current }) => {
    daemonLog(`[health] Status changed: ${previous} -> ${current}`);
    winstonLogger.info(`[daemon] Health status: ${previous} -> ${current}`);
  });
  daemonLog("Health monitor started");

  // Start cron scheduler
  const lastRun: Record<string, number> = {};
  const cronTick = async () => {
    const now = new Date();
    const nowTs = now.getTime();
    let crons = getCrons();
    const toRemove: string[] = [];

    for (const cron of crons) {
      const key = cron.name;
      let shouldExecute = false;

      if (cron.runAt) {
        if (nowTs >= cron.runAt && !lastRun[key]) shouldExecute = true;
      } else {
        const lastMinute = lastRun[key] || 0;
        const currentMinute = Math.floor(nowTs / 60000);
        if (currentMinute > lastMinute && shouldRunCron(cron.schedule, now)) shouldExecute = true;
      }

      if (shouldExecute) {
        lastRun[key] = Math.floor(nowTs / 60000);
        daemonLog(`Running: ${cron.name} -> ${cron.session}`);
        const startTime = Date.now();
        const CRON_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max per cron job
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          // Execute scripts and resolve templates if scripts are defined
          let resolvedMessage = cron.message;
          let scriptResults: import("../types.js").CronScriptResult[] | undefined;
          if (cron.scripts && cron.scripts.length > 0) {
            const cfg = centralConfig.get();
            if (!cfg.daemon.cronScriptsEnabled) {
              daemonLog(
                `Cron scripts disabled for ${cron.name} — set cronScriptsEnabled: true in daemon config to enable`,
              );
            } else {
              daemonLog(`Executing ${cron.scripts.length} script(s) for ${cron.name}`);
              scriptResults = await executeCronScripts(cron.scripts);
              resolvedMessage = resolveScriptTemplates(cron.message, scriptResults);
              const failedScripts = scriptResults.filter((r) => r.error);
              if (failedScripts.length > 0) {
                daemonLog(
                  `Warning: ${failedScripts.length} script(s) failed for ${cron.name}: ${failedScripts.map((r) => r.name).join(", ")}`,
                );
              }
            }
          }

          await Promise.race([
            inject(cron.session, resolvedMessage, { silent: true, from: "cron" }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error(`Cron job '${cron.name}' timed out after ${CRON_TIMEOUT_MS / 1000}s`)),
                CRON_TIMEOUT_MS,
              );
            }),
          ]);
          const durationMs = Date.now() - startTime;
          daemonLog(`Completed: ${cron.name} (${durationMs}ms)`);

          // Log success to history
          addCronHistory({
            name: cron.name,
            session: cron.session,
            timestamp: startTime,
            success: true,
            durationMs,
            message: resolvedMessage,
            scriptResults,
          });

          if (cron.once) {
            toRemove.push(cron.name);
            daemonLog(`Auto-removed one-time job: ${cron.name}`);
          }
        } catch (err) {
          const durationMs = Date.now() - startTime;
          const errorMsg = err instanceof Error ? err.message : String(err);
          daemonLog(`Error: ${cron.name} - ${errorMsg}`);

          // Log failure to history
          addCronHistory({
            name: cron.name,
            session: cron.session,
            timestamp: startTime,
            success: false,
            durationMs,
            error: errorMsg,
            message: cron.message,
          });
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId);
        }
      }
    }

    if (toRemove.length > 0) {
      // Re-read to get any jobs added during execution (avoids race condition)
      crons = getCrons();
      crons = crons.filter((c) => !toRemove.includes(c.name));
      saveCrons(crons);
    }
  };

  setInterval(cronTick, 30000);
  markCronRunning();
  cronTick();

  // WebSocket heartbeat interval (WOP-204)
  const heartbeatInterval = setInterval(() => {
    const disconnected = heartbeatTick();
    if (disconnected > 0) {
      daemonLog(`[ws] Heartbeat: disconnected ${disconnected} stale client(s)`);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Shutdown handler
  const shutdown = async () => {
    daemonLog("Daemon stopping...");
    clearInterval(heartbeatInterval);
    healthMonitor.stop();
    await shutdownAllPlugins();
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    daemonLog("Daemon stopped");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Start server
  daemonLog(`Listening on http://${host}:${port}`);
  winstonLogger.info(`WOPR daemon listening on http://${host}:${port}`);

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  // Inject WebSocket upgrade handler
  injectWebSocket(server);
}

export function getDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    unlinkSync(PID_FILE);
    return null;
  }
}

export function getDaemonUrl(): string {
  return `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
}
