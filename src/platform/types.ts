/**
 * Instance lifecycle types for the platform layer (WOP-198).
 */

/** Configuration for creating a new WOPR instance container. */
export interface InstanceConfig {
  /** Unique instance identifier (used in container name: wopr-{id}). */
  id: string;
  /** Docker image to run. */
  image: string;
  /** Environment variables passed into the container. */
  env?: Record<string, string>;
  /** Host port to map to container's internal daemon port (7437). Auto-assigned if omitted. */
  hostPort?: number;
  /** Resource constraints. */
  resources?: InstanceResources;
  /** Enable Docker HEALTHCHECK + daemon polling. Default true. */
  healthCheck?: boolean;
  /** Auto-restart unhealthy containers. Default false. */
  autoRestart?: boolean;
  /** Auto-restart cooldown in ms. Default 30 000. */
  autoRestartCooldownMs?: number;
}

export interface InstanceResources {
  /** CPU limit (e.g. 1.5 = 1.5 cores). */
  cpus?: number;
  /** Memory limit string (e.g. "512m", "2g"). */
  memory?: string;
}

/** Runtime state of a managed instance. */
export interface InstanceStatus {
  id: string;
  containerId: string;
  containerName: string;
  state: "created" | "running" | "paused" | "restarting" | "exited" | "dead" | "unknown";
  health: "healthy" | "unhealthy" | "starting" | "none";
  uptime: number | null;
  startedAt: string | null;
  ports: PortBinding[];
  image: string;
}

export interface PortBinding {
  container: number;
  host: number;
  protocol: string;
}

export interface InstanceListEntry {
  id: string;
  containerName: string;
  state: string;
  image: string;
}

export interface LogOptions {
  /** Number of lines from the end. */
  tail?: number;
  /** Follow (stream) logs. Default false — returns collected output. */
  follow?: boolean;
  /** Include timestamps. Default false. */
  timestamps?: boolean;
  /** ISO date string — only logs after this time. */
  since?: string;
}

/** Internal Docker network name for inter-instance communication. */
export const WOPR_NETWORK = "wopr-network";
/** Internal daemon API port inside every WOPR container. */
export const INTERNAL_DAEMON_PORT = 7437;
/** Container name prefix. */
export const CONTAINER_PREFIX = "wopr-";
