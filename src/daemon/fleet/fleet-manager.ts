/**
 * FleetManager — manages bot containers via the Docker API using dockerode
 */

import Docker from "dockerode";
import { logger } from "../../logger.js";
import type { BotProfile, BotStatus } from "./types.js";

/** Container name prefix for fleet-managed bots */
const CONTAINER_PREFIX = "wopr-bot-";

/** Label used to identify fleet-managed containers */
const FLEET_LABEL = "wopr.fleet.managed";
const PROFILE_ID_LABEL = "wopr.fleet.profile-id";

export class FleetManager {
  private docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker || new Docker();
  }

  /** Get the container name for a bot profile */
  private containerName(profile: BotProfile): string {
    return `${CONTAINER_PREFIX}${profile.id}`;
  }

  /** Find a container by profile ID */
  private async findContainer(profileId: string): Promise<Docker.Container | null> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: [`${PROFILE_ID_LABEL}=${profileId}`],
      },
    });
    if (containers.length === 0) return null;
    return this.docker.getContainer(containers[0].Id);
  }

  /** Pull the Docker image for a profile */
  private async pullImage(profile: BotProfile): Promise<void> {
    const imageRef = `${profile.image}:${profile.releaseChannel}`;
    logger.info({ msg: "[fleet] Pulling image", image: imageRef });
    const stream = await this.docker.pull(imageRef);
    // Wait for pull to complete
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info({ msg: "[fleet] Image pulled", image: imageRef });
  }

  /** Build Docker create options from a profile */
  private buildCreateOptions(profile: BotProfile): Docker.ContainerCreateOptions {
    const imageRef = `${profile.image}:${profile.releaseChannel}`;
    const envArray = Object.entries(profile.env).map(([k, v]) => `${k}=${v}`);

    const labels: Record<string, string> = {
      [FLEET_LABEL]: "true",
      [PROFILE_ID_LABEL]: profile.id,
      "wopr.fleet.name": profile.name,
      ...(profile.labels || {}),
    };

    const restartPolicyMap: Record<string, { Name: string; MaximumRetryCount?: number }> = {
      no: { Name: "" },
      always: { Name: "always" },
      "unless-stopped": { Name: "unless-stopped" },
      "on-failure": { Name: "on-failure", MaximumRetryCount: 5 },
    };

    const hostConfig: Docker.HostConfig = {
      RestartPolicy: restartPolicyMap[profile.restartPolicy] || { Name: "" },
    };

    // Mount named volume if specified
    if (profile.volume) {
      hostConfig.Binds = [`${profile.volume}:/data`];
    }

    const opts: Docker.ContainerCreateOptions = {
      name: this.containerName(profile),
      Image: imageRef,
      Env: envArray,
      Labels: labels,
      HostConfig: hostConfig,
    };

    // Healthcheck
    if (profile.healthcheck) {
      opts.Healthcheck = {
        Test: profile.healthcheck.test,
        Interval: profile.healthcheck.interval ? profile.healthcheck.interval * 1e6 : undefined, // ns
        Timeout: profile.healthcheck.timeout ? profile.healthcheck.timeout * 1e6 : undefined,
        Retries: profile.healthcheck.retries,
        StartPeriod: profile.healthcheck.startPeriod ? profile.healthcheck.startPeriod * 1e6 : undefined,
      };
    }

    return opts;
  }

  /** Create a container for a bot profile (pulls image first) */
  async create(profile: BotProfile): Promise<string> {
    // Check if container already exists
    const existing = await this.findContainer(profile.id);
    if (existing) {
      const info = await existing.inspect();
      return info.Id;
    }

    await this.pullImage(profile);
    const opts = this.buildCreateOptions(profile);
    const container = await this.docker.createContainer(opts);
    logger.info({ msg: "[fleet] Container created", profileId: profile.id, containerId: container.id });
    return container.id;
  }

  /** Start a bot's container */
  async start(profileId: string): Promise<void> {
    const container = await this.findContainer(profileId);
    if (!container) throw new Error(`No container found for profile ${profileId}`);
    await container.start();
    logger.info({ msg: "[fleet] Container started", profileId });
  }

  /** Stop a bot's container */
  async stop(profileId: string): Promise<void> {
    const container = await this.findContainer(profileId);
    if (!container) throw new Error(`No container found for profile ${profileId}`);
    await container.stop();
    logger.info({ msg: "[fleet] Container stopped", profileId });
  }

  /** Restart a bot's container */
  async restart(profileId: string): Promise<void> {
    const container = await this.findContainer(profileId);
    if (!container) throw new Error(`No container found for profile ${profileId}`);
    await container.restart();
    logger.info({ msg: "[fleet] Container restarted", profileId });
  }

  /** Remove a bot's container */
  async remove(profileId: string, removeVolumes = false): Promise<void> {
    const container = await this.findContainer(profileId);
    if (!container) return; // already gone
    try {
      await container.stop();
    } catch {
      // container may already be stopped
    }
    await container.remove({ v: removeVolumes });
    logger.info({ msg: "[fleet] Container removed", profileId });
  }

  /** Get the live status of a bot */
  async status(profile: BotProfile): Promise<BotStatus> {
    const container = await this.findContainer(profile.id);

    if (!container) {
      return {
        profile,
        containerId: null,
        state: "unknown",
        health: "unknown",
        uptimeSeconds: 0,
        startedAt: null,
      };
    }

    const info = await container.inspect();
    const state = (info.State?.Status as BotStatus["state"]) || "unknown";

    let health: BotStatus["health"] = "none";
    if (info.State?.Health) {
      health = (info.State.Health.Status as BotStatus["health"]) || "unknown";
    }

    let uptimeSeconds = 0;
    const startedAt = info.State?.StartedAt || null;
    if (startedAt && state === "running") {
      uptimeSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    }

    return {
      profile,
      containerId: info.Id,
      state,
      health,
      uptimeSeconds,
      startedAt,
    };
  }

  /** Get container logs */
  async logs(profileId: string, tail = 100): Promise<string> {
    const container = await this.findContainer(profileId);
    if (!container) throw new Error(`No container found for profile ${profileId}`);

    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    });

    // dockerode returns a Buffer for non-follow logs
    if (Buffer.isBuffer(logStream)) {
      return demuxDockerStream(logStream);
    }
    return String(logStream);
  }
}

/**
 * Demux Docker multiplexed stream output.
 * Docker log streams have an 8-byte header per frame:
 *   [stream_type(1), 0, 0, 0, size(4 BE)] followed by payload.
 */
function demuxDockerStream(buf: Buffer): string {
  const lines: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    if (offset + 8 + size > buf.length) break;
    lines.push(buf.subarray(offset + 8, offset + 8 + size).toString("utf-8"));
    offset += 8 + size;
  }
  return lines.join("");
}
