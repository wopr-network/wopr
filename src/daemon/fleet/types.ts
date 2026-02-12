/**
 * Fleet Manager types
 */

/** Bot profile stored on disk */
export interface BotProfile {
  /** Unique identifier (UUID) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Docker image (e.g. ghcr.io/wopr-network/wopr) */
  image: string;
  /** Image tag / release channel (e.g. stable, canary, v1.2.3) */
  releaseChannel: string;
  /** Environment variables passed to the container */
  env: Record<string, string>;
  /** Docker restart policy (no | always | unless-stopped | on-failure) */
  restartPolicy: "no" | "always" | "unless-stopped" | "on-failure";
  /** Optional named volume for persistent data */
  volume?: string;
  /** Docker healthcheck override */
  healthcheck?: {
    test: string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    startPeriod?: number;
  };
  /** Container labels */
  labels?: Record<string, string>;
  /** Created timestamp (ISO) */
  createdAt: string;
  /** Updated timestamp (ISO) */
  updatedAt: string;
}

/** Live bot status returned by the API */
export interface BotStatus {
  profile: BotProfile;
  /** Docker container ID (null if not created) */
  containerId: string | null;
  /** Container state */
  state: "running" | "stopped" | "restarting" | "paused" | "exited" | "dead" | "created" | "unknown";
  /** Container health status */
  health: "healthy" | "unhealthy" | "starting" | "none" | "unknown";
  /** Uptime in seconds (0 if not running) */
  uptimeSeconds: number;
  /** Started at timestamp (ISO, null if never started) */
  startedAt: string | null;
}

/** Fields allowed when creating a bot */
export interface CreateBotInput {
  name: string;
  image?: string;
  releaseChannel?: string;
  env?: Record<string, string>;
  restartPolicy?: BotProfile["restartPolicy"];
  volume?: string;
  healthcheck?: BotProfile["healthcheck"];
  labels?: Record<string, string>;
}

/** Fields allowed when updating a bot */
export interface UpdateBotInput {
  name?: string;
  image?: string;
  releaseChannel?: string;
  env?: Record<string, string>;
  restartPolicy?: BotProfile["restartPolicy"];
  volume?: string;
  healthcheck?: BotProfile["healthcheck"];
  labels?: Record<string, string>;
}
