/**
 * Dockerode wrapper with error handling (WOP-198).
 *
 * Thin layer around the dockerode client that standardises error messages,
 * ensures the wopr-network exists, and provides typed helpers used by
 * InstanceManager.
 */

import Docker from "dockerode";
import { logger } from "../logger.js";
import { WOPR_NETWORK } from "./types.js";

let _docker: Docker | undefined;

/** Return a singleton Dockerode client. */
export function getDocker(): Docker {
  if (!_docker) {
    _docker = new Docker();
  }
  return _docker;
}

/** Replace the singleton — useful for testing with a mock. */
export function setDocker(docker: Docker): void {
  _docker = docker;
}

/**
 * Ensure the shared `wopr-network` Docker network exists.
 * Creates it (bridge driver) if missing.
 */
export async function ensureNetwork(): Promise<void> {
  const docker = getDocker();
  try {
    const net = docker.getNetwork(WOPR_NETWORK);
    await net.inspect();
  } catch {
    logger.info(`[instance] Creating Docker network "${WOPR_NETWORK}"`);
    await docker.createNetwork({ Name: WOPR_NETWORK, Driver: "bridge" });
  }
}

/**
 * Pull an image if it is not already present locally.
 * Resolves when the pull stream finishes.
 */
export async function ensureImage(image: string): Promise<void> {
  const docker = getDocker();
  try {
    const img = docker.getImage(image);
    await img.inspect();
    return; // already present
  } catch {
    // not found — pull
  }

  logger.info(`[instance] Pulling image ${image}`);
  const stream = await docker.pull(image);
  // Wait for the pull to complete.
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Wrap a docker API call with a human-readable error context.
 */
export async function dockerCall<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[instance] ${label}: ${msg}`);
  }
}
