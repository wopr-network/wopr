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
import { migrateBrowserProfilesToSql } from "../core/browser-profile-migrate.js";
import { initBrowserProfileStorage } from "../core/browser-profile-repository.js";
// Core imports for daemon functionality
import { getCapabilityHealthProber } from "../core/capability-health.js";
import { config as centralConfig } from "../core/config.js";
// Provider registry imports
import { providerRegistry } from "../core/providers.js";
import { inject } from "../core/sessions.js";
import { logger as winstonLogger } from "../logger.js";
import { LOG_FILE, PID_FILE } from "../paths.js";
import { loadAllPlugins, shutdownAllPlugins } from "../plugins.js";
import { ensureToken } from "./auth-token.js";
import { HealthMonitor } from "./health.js";
import { bearerAuth, requireAuth } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { checkReadiness, markStartupComplete } from "./readiness.js";
import { restartOnIdleManager } from "./restart-on-idle.js";
import { apiKeysRouter } from "./routes/api-keys.js";
import { authRouter } from "./routes/auth.js";
import { capabilitiesRouter } from "./routes/capabilities.js";
import { capabilityHealthRouter } from "./routes/capability-health.js";
import { configRouter } from "./routes/config.js";
import { createHealthzRouter } from "./routes/health.js";
import { hooksRouter } from "./routes/hooks.js";
import { instancePluginsRouter } from "./routes/instance-plugins.js";
import { instancesRouter } from "./routes/instances.js";
import { marketplaceRouter } from "./routes/marketplace.js";
import { observabilityRouter } from "./routes/observability.js";
import { openaiRouter } from "./routes/openai.js";
import { pluginsRouter } from "./routes/plugins.js";
import { providersRouter } from "./routes/providers.js";
import { restartRouter } from "./routes/restart.js";
import { sessionsRouter } from "./routes/sessions.js";
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
  app.route("/config", configRouter);
  app.route("/sessions", sessionsRouter);
  app.route("/plugins", pluginsRouter);
  app.route("/hooks", hooksRouter);
  app.route("/providers", providersRouter);
  app.route("/templates", templatesRouter);
  app.route("/observability", observabilityRouter);
  app.route("/v1", openaiRouter);
  app.route("/api/daemon", restartRouter);

  // Per-instance plugin management (WOP-203)
  app.route("/api/instances/:id/plugins", instancePluginsRouter);
  // Marketplace (WOP-203)
  app.route("/api/marketplace", marketplaceRouter);
  // Capability health (WOP-501)
  app.route("/api/capability-health", capabilityHealthRouter);
  // Capability activation (WOP-504)
  app.route("/api/capabilities", capabilitiesRouter);
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

  daemonLog(`[heap] startup: ${heapMB()}`);

  // Track startup warnings/errors for clear reporting
  const startupWarnings: string[] = [];

  // Load config from disk first
  await centralConfig.load();
  daemonLog("Configuration loaded from disk");

  // Initialize security system (must be after config load, before plugins)
  const { initSecurity } = await import("../security/index.js");
  const { WOPR_HOME } = await import("../paths.js");
  try {
    await initSecurity(WOPR_HOME);
    daemonLog("Security system initialized");
  } catch (err) {
    const msg = `Security initialization failed: ${err}`;
    daemonLog(`Warning: ${msg}`);
    startupWarnings.push(msg);
  }

  // Initialize auth storage and migrate from auth.json/auth.sqlite (WOP-546)
  daemonLog("Initializing auth storage...");
  const { initAuthStorage, getAuthStore } = await import("../auth.js");
  const { migrateAuth } = await import("../auth/auth-migrate.js");
  const { setAuthStore } = await import("./api-keys.js");
  try {
    await initAuthStorage();
    daemonLog("Auth storage initialized");

    // Get the auth store instance and wire it to api-keys module
    const authStore = getAuthStore();
    if (authStore) {
      setAuthStore(authStore);

      // Run migrations (idempotent)
      await migrateAuth(authStore);
      daemonLog("Auth migration complete");
    } else {
      throw new Error("Auth store not initialized");
    }
  } catch (err) {
    const msg = `Auth initialization failed: ${err}`;
    daemonLog(`Warning: ${msg}`);
    startupWarnings.push(msg);
  }

  // Initialize browser profile storage and migrate from JSON
  daemonLog("Initializing browser profile storage...");
  await initBrowserProfileStorage();
  await migrateBrowserProfilesToSql();
  daemonLog("Browser profile storage initialized");

  // Initialize sandbox storage and migrate from JSON
  daemonLog("Initializing sandbox storage...");
  const { initSandboxStorage } = await import("../sandbox/sandbox-repository.js");
  const { migrateSandboxRegistryToSql } = await import("../sandbox/sandbox-migrate.js");
  await initSandboxStorage();
  await migrateSandboxRegistryToSql();
  daemonLog("Sandbox storage initialized");

  // Initialize registries storage and migrate from JSON
  daemonLog("Initializing registries storage...");
  const { initRegistriesStorage } = await import("../core/registries-repository.js");
  const { migrateRegistriesToSql } = await import("../core/registries-migrate.js");
  await initRegistriesStorage();
  await migrateRegistriesToSql();
  daemonLog("Registries storage initialized");

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

  daemonLog(`[heap] before plugins: ${heapMB()}`);

  // Migrate plugins.json and plugin-registries.json to SQL (one-time, idempotent)
  const { migratePluginJsonToSql } = await import("../plugins/migrate-json.js");
  await migratePluginJsonToSql();

  // Memory system (indexing, FTS5, file watching, session hooks) delegated to memory-semantic plugin
  daemonLog("Memory system delegated to memory-semantic plugin");

  // Load plugins (this is where providers register themselves)
  await loadAllPlugins(injectors);

  daemonLog(`[heap] after plugins: ${heapMB()}`);

  // Mount plugin-provided REST routers
  const { getPluginExtension } = await import("../plugins/extensions.js");
  const maybeSkillsRouter = getPluginExtension("skills:router");
  if (maybeSkillsRouter) {
    app.route("/skills", maybeSkillsRouter as Hono);
    daemonLog("Skills REST routes mounted from plugin");
  }

  const maybeCronsRouter = getPluginExtension("crons:router");
  if (maybeCronsRouter) {
    app.route("/crons", maybeCronsRouter as Hono);
    daemonLog("Crons REST routes mounted from plugin");
  }

  const maybeCanvasRouter = getPluginExtension("canvas:router");
  if (maybeCanvasRouter) {
    app.route("/canvas", maybeCanvasRouter as Hono);
    daemonLog("Canvas REST routes mounted from plugin");
  }

  // Wire WebSocket publish into canvas plugin if loaded
  const maybeCanvasSetPublish = getPluginExtension<(fn: typeof publishToTopic) => void>("canvas:setPublish");
  if (maybeCanvasSetPublish) {
    maybeCanvasSetPublish(publishToTopic);
    daemonLog("Canvas WebSocket publish wired");
  }

  // Initial memory sync is handled by the memory-semantic plugin during init()

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

  // Start capability health probing
  const capabilityProber = getCapabilityHealthProber();
  capabilityProber.start();
  daemonLog("Capability health prober started");

  // Wire up capability health alerting via WebSocket
  capabilityProber.on("providerStatusChange", (event) => {
    try {
      const { capability, providerId, providerName, currentHealthy, error } = event;
      const wsEvent = {
        type: "capability:health",
        capability,
        providerId,
        providerName,
        healthy: currentHealthy,
        error: error || undefined,
        ts: Date.now(),
      };
      publishToTopic("capability:health", wsEvent);
      if (!currentHealthy) {
        winstonLogger.warn(
          `[capability-health] Provider ${providerId} (${capability}) is unhealthy: ${error || "health check failed"}`,
        );
      } else {
        winstonLogger.info(`[capability-health] Provider ${providerId} (${capability}) recovered`);
      }
    } catch (err) {
      winstonLogger.error(
        `[capability-health] Failed to publish health change event: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  // WebSocket heartbeat interval (WOP-204)
  const heartbeatInterval = setInterval(() => {
    const disconnected = heartbeatTick();
    if (disconnected > 0) {
      daemonLog(`[ws] Heartbeat: disconnected ${disconnected} stale client(s)`);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Wire up restart-on-idle manager to trigger exit code 75
  restartOnIdleManager.onRestart(() => {
    daemonLog("[restart-on-idle] Graceful restart triggered - exit code 75");
    shutdown(75);
  });

  // Shutdown handler (supports custom exit codes for restart-on-idle)
  const shutdown = async (exitCode: number = 0) => {
    daemonLog("Daemon stopping...");
    clearInterval(heartbeatInterval);
    healthMonitor.stop();
    capabilityProber.stop();
    restartOnIdleManager.shutdown();
    await shutdownAllPlugins();
    // Close storage database handle
    try {
      const { resetStorage } = await import("../storage/public.js");
      resetStorage(); // closes DB + nullifies singleton
    } catch {
      // Storage may not have been initialized
    }
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    daemonLog("Daemon stopped");
    process.exit(exitCode);
  };

  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));

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
