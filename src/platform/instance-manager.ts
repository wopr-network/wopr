/**
 * InstanceManager — create / start / stop / restart / destroy / status / list / logs
 * for WOPR instance containers via the Docker Engine API (WOP-198).
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { logger } from "../logger.js";
import { dockerCall, ensureImage, ensureNetwork, getDocker } from "./docker-client.js";
import type { InstanceConfig, InstanceListEntry, InstanceStatus, LogOptions, PortBinding } from "./types.js";
import { CONTAINER_PREFIX, INTERNAL_DAEMON_PORT, WOPR_NETWORK } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_INSTANCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9\-]*$/;

function validateInstanceId(instanceId: string): void {
  if (!VALID_INSTANCE_ID.test(instanceId)) {
    throw new Error(
      `Invalid instanceId "${instanceId}": must be alphanumeric with hyphens only and not start with a hyphen`,
    );
  }
}

function containerName(instanceId: string): string {
  validateInstanceId(instanceId);
  return `${CONTAINER_PREFIX}${instanceId}`;
}

function woprHomeDir(instanceId: string): string {
  validateInstanceId(instanceId);
  return join(homedir(), "wopr-instances", instanceId);
}

// ---------------------------------------------------------------------------
// InstanceManager
// ---------------------------------------------------------------------------

export class InstanceManager {
  private healthWatchers = new Map<string, AbortController>();

  // ------- create -------
  async create(config: InstanceConfig): Promise<string> {
    const name = containerName(config.id);
    const docker = getDocker();

    await ensureNetwork();
    await ensureImage(config.image);

    const hostDir = woprHomeDir(config.id);
    mkdirSync(hostDir, { recursive: true });

    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    const exposedPorts: Record<string, Record<string, never>> = {};

    const daemonPort = `${INTERNAL_DAEMON_PORT}/tcp`;
    exposedPorts[daemonPort] = {};
    portBindings[daemonPort] = [
      { HostPort: config.hostPort ? String(config.hostPort) : "" }, // empty = auto
    ];

    const env = Object.entries(config.env ?? {}).map(([k, v]) => `${k}=${v}`);
    env.push(`WOPR_HOME=/data/wopr`);

    const hostConfig: Record<string, unknown> = {
      Binds: [`${hostDir}:/data/wopr`],
      PortBindings: portBindings,
      NetworkMode: WOPR_NETWORK,
      RestartPolicy: { Name: "" }, // no auto-restart by Docker; we handle it ourselves
    };

    if (config.resources?.cpus) {
      hostConfig.NanoCpus = Math.round(config.resources.cpus * 1e9);
    }
    if (config.resources?.memory) {
      hostConfig.Memory = parseMemoryString(config.resources.memory);
    }

    const healthcheck =
      config.healthCheck !== false
        ? {
            Test: ["CMD-SHELL", `curl -sf http://localhost:${INTERNAL_DAEMON_PORT}/health || exit 1`],
            Interval: 30_000_000_000, // 30 s in nanoseconds
            Timeout: 5_000_000_000,
            Retries: 3,
            StartPeriod: 10_000_000_000,
          }
        : undefined;

    const container = await dockerCall("create container", () =>
      docker.createContainer({
        name,
        Image: config.image,
        Env: env,
        ExposedPorts: exposedPorts,
        Healthcheck: healthcheck,
        Labels: {
          "wopr.managed": "true",
          "wopr.instance": config.id,
        },
        HostConfig: hostConfig as any,
      }),
    );

    logger.info(`[instance] Created container ${name} (${container.id.slice(0, 12)})`);

    if (config.autoRestart) {
      // Cancel any previously running watcher for this instance.
      this.healthWatchers.get(config.id)?.abort();
      const ac = new AbortController();
      this.healthWatchers.set(config.id, ac);
      this.watchHealth(config, ac.signal)
        .catch((err: unknown) => {
          logger.error(`[instance] Health watcher for ${name} failed: ${err}`);
        })
        .finally(() => {
          // Clean up map entry when watcher exits.
          if (this.healthWatchers.get(config.id) === ac) {
            this.healthWatchers.delete(config.id);
          }
        });
    }

    return container.id;
  }

  // ------- start -------
  async start(id: string): Promise<void> {
    const name = containerName(id);
    const docker = getDocker();
    const container = docker.getContainer(name);
    await dockerCall(`start ${name}`, () => container.start());
    logger.info(`[instance] Started ${name}`);
  }

  // ------- stop -------
  async stop(id: string, timeoutSec = 10): Promise<void> {
    const name = containerName(id);
    const docker = getDocker();
    const container = docker.getContainer(name);
    await dockerCall(`stop ${name}`, () => container.stop({ t: timeoutSec }));
    logger.info(`[instance] Stopped ${name}`);
  }

  // ------- restart -------
  async restart(id: string, timeoutSec = 10): Promise<void> {
    const name = containerName(id);
    try {
      await this.stop(id, timeoutSec);
    } catch (err: unknown) {
      // If stop fails, attempt to start anyway; if start also fails, throw original error.
      logger.warn(`[instance] Stop failed during restart of ${name}: ${err}`);
      try {
        await this.start(id);
        return;
      } catch {
        throw err;
      }
    }
    await this.start(id);
    logger.info(`[instance] Restarted ${name}`);
  }

  // ------- destroy -------
  async destroy(id: string, opts?: { removeVolumes?: boolean }): Promise<void> {
    const name = containerName(id);
    const docker = getDocker();
    const container = docker.getContainer(name);

    // Stop first (ignore errors if already stopped).
    try {
      await container.stop({ t: 5 });
    } catch {
      // already stopped or doesn't exist — fine
    }

    await dockerCall(`remove ${name}`, () => container.remove({ v: opts?.removeVolumes ?? false }));
    logger.info(`[instance] Destroyed ${name}${opts?.removeVolumes ? " (volumes removed)" : ""}`);
  }

  // ------- status -------
  async status(id: string): Promise<InstanceStatus> {
    const name = containerName(id);
    const docker = getDocker();
    const container = docker.getContainer(name);
    const info = await dockerCall(`inspect ${name}`, () => container.inspect());

    const state = (info.State?.Status as InstanceStatus["state"]) ?? "unknown";
    const healthStatus = info.State?.Health?.Status as InstanceStatus["health"] | undefined;
    const startedAt = info.State?.StartedAt ?? null;

    let uptime: number | null = null;
    if (state === "running" && startedAt) {
      uptime = Date.now() - new Date(startedAt).getTime();
    }

    const ports: PortBinding[] = [];
    const portMap = info.NetworkSettings?.Ports ?? {};
    for (const [containerPort, bindings] of Object.entries(portMap)) {
      if (!bindings) continue;
      const [portNum, protocol] = containerPort.split("/");
      for (const b of bindings as Array<{ HostPort: string }>) {
        ports.push({
          container: Number(portNum),
          host: Number(b.HostPort),
          protocol: protocol ?? "tcp",
        });
      }
    }

    return {
      id,
      containerId: info.Id,
      containerName: name,
      state,
      health: healthStatus ?? "none",
      uptime,
      startedAt,
      ports,
      image: info.Config?.Image ?? "",
    };
  }

  // ------- list -------
  async list(): Promise<InstanceListEntry[]> {
    const docker = getDocker();
    const containers = await docker.listContainers({
      all: true,
      filters: { label: ["wopr.managed=true"] },
    });

    return containers.map((c) => ({
      id: c.Labels?.["wopr.instance"] ?? c.Names?.[0]?.replace(/^\//, "").replace(CONTAINER_PREFIX, "") ?? "unknown",
      containerName: c.Names?.[0]?.replace(/^\//, "") ?? "",
      state: c.State ?? "unknown",
      image: c.Image ?? "",
    }));
  }

  // ------- logs -------
  async logs(id: string, opts?: LogOptions): Promise<string> {
    const name = containerName(id);
    const docker = getDocker();
    const container = docker.getContainer(name);

    const logOpts: Record<string, unknown> = {
      stdout: true,
      stderr: true,
      tail: opts?.tail ?? 100,
      timestamps: opts?.timestamps ?? false,
    };
    if (opts?.since) {
      logOpts.since = Math.floor(new Date(opts.since).getTime() / 1000);
    }

    if (opts?.follow) {
      // For follow mode we collect for a bounded time then return.
      // In a real streaming scenario this would be piped to a writable.
      logOpts.follow = true;
      const stream = (await dockerCall(`logs ${name}`, async () =>
        container.logs(logOpts as any),
      )) as unknown as Readable;

      return new Promise<string>((resolve, reject) => {
        let buf = "";
        const timer = setTimeout(() => {
          stream.destroy();
          resolve(buf);
        }, 5_000);
        stream.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf-8");
        });
        stream.on("end", () => {
          clearTimeout(timer);
          resolve(buf);
        });
        stream.on("error", (err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    }

    const output = await dockerCall(`logs ${name}`, async () => container.logs(logOpts as any));
    // dockerode returns a Buffer for non-follow logs
    return Buffer.isBuffer(output) ? output.toString("utf-8") : String(output);
  }

  // ------- health watcher (private) -------
  private async watchHealth(config: InstanceConfig, signal: AbortSignal): Promise<void> {
    const cooldown = config.autoRestartCooldownMs ?? 30_000;
    const name = containerName(config.id);

    // Simple poll loop — exits when container is removed or watcher is aborted.
    for (;;) {
      await sleep(cooldown);
      if (signal.aborted) break;
      try {
        const s = await this.status(config.id);
        if (s.state !== "running") break; // container gone or stopped externally
        if (s.health === "unhealthy") {
          logger.warn(`[instance] ${name} is unhealthy — restarting`);
          await this.restart(config.id);
        }
      } catch {
        // Container no longer exists
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseMemoryString(mem: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(b|k|m|g|t)?$/i.exec(mem.trim());
  if (!match) throw new Error(`Invalid memory string: "${mem}"`);
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const multipliers: Record<string, number> = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
  return Math.round(value * (multipliers[unit] ?? 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
