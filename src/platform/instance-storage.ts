import fs from "node:fs/promises";
import { join, normalize, resolve } from "node:path";

/**
 * Default base directory for all WOPR instances.
 * Override with WOPR_INSTANCES_DIR environment variable.
 */
const DEFAULT_BASE = "/var/wopr/instances";

/**
 * UUID v4 pattern — only valid UUIDs are accepted as instance IDs
 * to prevent path traversal attacks.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Subdirectories created inside each instance home.
 */
const INSTANCE_SUBDIRS = ["plugins", "sessions", "attachments", "data"] as const;

/**
 * Default permission mode for instance directories (owner-only rwx).
 */
const DIR_MODE = 0o700;

/**
 * Default permission mode for instance files (owner-only rw).
 */
const FILE_MODE = 0o600;

export interface InstanceConfig {
  [key: string]: unknown;
}

export interface ProvisionOptions {
  /** Optional template config to copy into the new instance. */
  template?: InstanceConfig;
}

export interface DeprovisionOptions {
  /** When true, preserve the data/ subdirectory. */
  keepData?: boolean;
}

/**
 * Validates that an instance ID is a well-formed UUID.
 * Throws if the ID is invalid — this is the primary path traversal defence.
 */
function validateInstanceId(instanceId: string): void {
  if (!UUID_RE.test(instanceId)) {
    throw new Error(`Invalid instance ID: must be a UUID (got "${instanceId}")`);
  }
}

/**
 * Return the base directory that holds all instance homes.
 */
function getBaseDir(): string {
  return process.env.WOPR_INSTANCES_DIR || DEFAULT_BASE;
}

/**
 * Verify that a resolved path is contained within the expected base.
 * Belt-and-suspenders check on top of UUID validation.
 */
function assertWithinBase(resolvedPath: string, base: string): void {
  const normalizedBase = `${normalize(base)}/`;
  const normalizedPath = normalize(resolvedPath);
  if (!normalizedPath.startsWith(normalizedBase) && normalizedPath !== normalize(base)) {
    throw new Error("Path escapes instance base directory");
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Return the WOPR_HOME path for a given instance.
 */
export function getHomePath(instanceId: string): string {
  validateInstanceId(instanceId);
  const base = getBaseDir();
  const home = resolve(join(base, instanceId));
  assertWithinBase(home, base);
  return home;
}

/**
 * Check whether storage for the given instance has been provisioned.
 */
export async function exists(instanceId: string): Promise<boolean> {
  const home = getHomePath(instanceId);
  try {
    const stat = await fs.stat(home);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Create the full directory tree and initial config for an instance.
 * No-ops if the instance already exists.
 */
export async function provision(instanceId: string, options?: ProvisionOptions): Promise<string> {
  const home = getHomePath(instanceId);

  // Create root + subdirectories
  await fs.mkdir(home, { recursive: true, mode: DIR_MODE });
  for (const sub of INSTANCE_SUBDIRS) {
    await fs.mkdir(join(home, sub), { recursive: true, mode: DIR_MODE });
  }

  // Write initial config (only if it doesn't exist yet)
  const configPath = join(home, "config.json");
  try {
    await fs.access(configPath);
    // Config already exists — leave it alone
  } catch {
    const config = options?.template ?? {};
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      mode: FILE_MODE,
    });
  }

  // Write empty plugins registry if absent
  const pluginsPath = join(home, "plugins.json");
  try {
    await fs.access(pluginsPath);
  } catch {
    await fs.writeFile(pluginsPath, "[]\n", { mode: FILE_MODE });
  }

  return home;
}

/**
 * Remove an instance's directory tree.
 *
 * When `keepData` is true the `data/` subdirectory is moved to a sibling
 * `.data-backup-{id}` before the rest is deleted, then moved back.
 */
export async function deprovision(instanceId: string, options?: DeprovisionOptions): Promise<void> {
  const home = getHomePath(instanceId);

  if (!(await exists(instanceId))) {
    return; // nothing to do
  }

  if (options?.keepData) {
    const dataDir = join(home, "data");
    const base = getBaseDir();
    const backup = join(base, `.data-backup-${instanceId}`);

    try {
      await fs.access(dataDir);
      await fs.rename(dataDir, backup);
    } catch {
      // data/ doesn't exist — nothing to preserve
    }

    await fs.rm(home, { recursive: true, force: true });

    // Restore data into a fresh directory
    try {
      await fs.access(backup);
      await fs.mkdir(home, { recursive: true, mode: DIR_MODE });
      await fs.rename(backup, dataDir);
    } catch {
      // backup didn't exist (data/ was never there)
    }
  } else {
    await fs.rm(home, { recursive: true, force: true });
  }
}

/**
 * List all provisioned instance IDs.
 * Only directories whose names are valid UUIDs are returned.
 */
export async function listInstances(): Promise<string[]> {
  const base = getBaseDir();
  let entries: string[];
  try {
    entries = await fs.readdir(base);
  } catch {
    return []; // base dir doesn't exist yet
  }

  const ids: string[] = [];
  for (const entry of entries) {
    if (UUID_RE.test(entry)) {
      const stat = await fs.stat(join(base, entry));
      if (stat.isDirectory()) {
        ids.push(entry);
      }
    }
  }
  return ids.sort();
}

/**
 * Read the config.json for an instance.
 */
export async function getConfig(instanceId: string): Promise<InstanceConfig> {
  const home = getHomePath(instanceId);
  const raw = await fs.readFile(join(home, "config.json"), "utf-8");
  return JSON.parse(raw) as InstanceConfig;
}

/**
 * Write (replace) the config.json for an instance.
 */
export async function setConfig(instanceId: string, config: InstanceConfig): Promise<void> {
  const home = getHomePath(instanceId);
  await fs.writeFile(join(home, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: FILE_MODE });
}
