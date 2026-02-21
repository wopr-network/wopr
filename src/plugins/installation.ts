/**
 * Plugin installation, removal, enable/disable, and persistence.
 *
 * Manages the on-disk plugins.json registry and the actual plugin
 * file-system operations (clone, symlink, npm install).
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger } from "../logger.js";
import type { InstalledPlugin } from "../types.js";
import { ensurePluginSchema, getPluginRepo } from "./plugin-storage.js";
import { PLUGINS_DIR, WOPR_HOME } from "./state.js";

export interface InstallResult {
  name: string;
  version: string;
  path: string;
  enabled: boolean;
}

// Validate input for safe shell interpolation
const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;
const SAFE_PKG = /^[@a-zA-Z0-9._/-]+$/;

function assertSafeName(value: string, label: string): void {
  if (!SAFE_NAME.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

/**
 * Validate that a resolved local plugin path is safe to symlink.
 *
 * Guards against path traversal (CWE-22) by requiring:
 * 1. The path must exist and be a directory (not a file or symlink to a file).
 * 2. The path must resolve (after following symlinks) to a location that is
 *    NOT inside WOPR_HOME — this prevents circular symlinks and access to
 *    config/secrets stored under ~/.wopr/.
 *
 * Note: There is an inherent TOCTOU race between these checks and the
 * subsequent symlinkSync call. For a local CLI tool this is acceptable —
 * the user running the CLI already has direct filesystem access.
 */
function assertSafePluginSource(resolved: string): void {
  // 1. Must exist
  if (!existsSync(resolved)) {
    throw new Error(`Local plugin path does not exist: ${resolved}`);
  }

  // 2. Must be a directory (not a regular file, socket, etc.)
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new Error(`Local plugin path is not a directory: ${resolved}`);
  }

  // If it's a symlink, resolve it and check the target is a directory
  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    throw new Error(`Cannot resolve local plugin path (broken symlink?): ${resolved}`);
  }

  const realStat = lstatSync(realPath);
  if (!realStat.isDirectory()) {
    throw new Error(`Local plugin path does not resolve to a directory: ${resolved} -> ${realPath}`);
  }

  // 3. Must not be inside WOPR_HOME (prevents symlinking config, secrets, DB)
  const normalizedReal = realPath.endsWith("/") ? realPath : `${realPath}/`;
  const normalizedWoprHome = WOPR_HOME.endsWith("/") ? WOPR_HOME : `${WOPR_HOME}/`;
  if (normalizedReal.startsWith(normalizedWoprHome) || realPath === WOPR_HOME) {
    throw new Error(`Local plugin path must not be inside WOPR_HOME (${WOPR_HOME}): ${resolved}`);
  }
}

export async function installPlugin(source: string): Promise<InstalledPlugin> {
  mkdirSync(PLUGINS_DIR, { recursive: true });

  // Determine source type
  if (source.startsWith("github:")) {
    // GitHub repo
    const repo = source.replace("github:", "");
    const parts = repo.split("/");
    if (parts.length !== 2) throw new Error("GitHub source must be github:owner/repo");
    assertSafeName(parts[0], "GitHub owner");
    assertSafeName(parts[1], "GitHub repo");
    const pluginDir = join(PLUGINS_DIR, parts[1]);

    // Clone or pull
    if (existsSync(pluginDir)) {
      execFileSync("git", ["pull"], { cwd: pluginDir, stdio: "inherit" });
    } else {
      execFileSync("git", ["clone", `https://github.com/${parts[0]}/${parts[1]}`, pluginDir], {
        stdio: "inherit",
      });
    }

    // Install dependencies if package.json exists
    const pkgPath = join(pluginDir, "package.json");
    if (existsSync(pkgPath)) {
      logger.info(`[plugins] Installing dependencies for ${repo}...`);
      execFileSync("npm", ["install"], { cwd: pluginDir, stdio: "inherit" });

      // Build TypeScript plugins if tsconfig.json exists
      if (existsSync(join(pluginDir, "tsconfig.json"))) {
        logger.info(`[plugins] Building TypeScript plugin...`);
        execFileSync("npm", ["run", "build"], { cwd: pluginDir, stdio: "inherit" });
      }
    }

    // Read package.json for metadata
    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf-8")) : {};

    const installed: InstalledPlugin = {
      name: pkg.name || repo.split("/")[1] || repo,
      version: pkg.version || "0.0.0",
      description: pkg.description,
      source: "github",
      path: pluginDir,
      enabled: false,
      installedAt: Date.now(),
    };

    await addInstalledPlugin(installed);
    return installed;
  } else if (source.startsWith("./") || source.startsWith("/") || source.startsWith("~/")) {
    // Local path
    const resolved = resolve(source.replace("~", process.env.HOME || "~"));
    assertSafePluginSource(resolved);
    const dirName = resolved.split("/").pop() || "plugin";
    if (!SAFE_NAME.test(dirName)) {
      throw new Error(`Invalid local plugin directory name: ${dirName}`);
    }
    const pluginDir = join(PLUGINS_DIR, dirName);

    // Symlink (no shell -- avoids injection via path)
    if (!existsSync(pluginDir)) {
      symlinkSync(resolved, pluginDir);
    }

    // Install dependencies if package.json exists
    const pkgPath = join(pluginDir, "package.json");
    if (existsSync(pkgPath)) {
      logger.info(`[plugins] Installing dependencies for local plugin...`);
      execFileSync("npm", ["install"], { cwd: pluginDir, stdio: "inherit" });

      // Build TypeScript plugins if tsconfig.json exists
      if (existsSync(join(pluginDir, "tsconfig.json"))) {
        logger.info(`[plugins] Building TypeScript plugin...`);
        execFileSync("npm", ["run", "build"], { cwd: pluginDir, stdio: "inherit" });
      }
    }

    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf-8")) : {};

    const installed: InstalledPlugin = {
      name: pkg.name || resolved.split("/").pop() || "plugin",
      version: pkg.version || "0.0.0",
      description: pkg.description,
      source: "local",
      path: pluginDir,
      enabled: false,
      installedAt: Date.now(),
    };

    await addInstalledPlugin(installed);
    return installed;
  } else {
    // npm package - normalize to @wopr-network/plugin-<name> format
    const shortName = source
      .replace(/^@wopr-network\//, "")
      .replace(/^plugin-/, "")
      .replace(/^wopr-plugin-/, "")
      .replace(/^wopr-/, "");
    const npmPackage = `@wopr-network/plugin-${shortName}`;
    if (!SAFE_PKG.test(npmPackage)) throw new Error(`Invalid npm package name: ${npmPackage}`);
    const pluginDir = join(PLUGINS_DIR, shortName);
    mkdirSync(pluginDir, { recursive: true });

    // Use npm to install
    execFileSync("npm", ["install", npmPackage], { cwd: pluginDir, stdio: "inherit" });

    // Read installed package metadata (scoped packages are nested: node_modules/@scope/name)
    const pkgPath = join(pluginDir, "node_modules", "@wopr-network", `plugin-${shortName}`, "package.json");
    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf-8")) : {};

    const installed: InstalledPlugin = {
      name: shortName,
      version: pkg.version || "0.0.0",
      description: pkg.description,
      source: "npm",
      path: join(pluginDir, "node_modules", "@wopr-network", `plugin-${shortName}`),
      enabled: false,
      installedAt: Date.now(),
    };

    await addInstalledPlugin(installed);
    return installed;
  }
}

export async function removePlugin(name: string): Promise<boolean> {
  return uninstallPlugin(name);
}

export async function uninstallPlugin(name: string): Promise<boolean> {
  await ensurePluginSchema();
  const repo = getPluginRepo();
  const plugin = await repo.findById(name);
  if (!plugin) return false;

  // Remove files (only if under PLUGINS_DIR to prevent path traversal).
  // Bundled plugins live in the read-only image layer — only remove the
  // symlink in PLUGINS_DIR, not the source files.
  const normalizedPath = resolve(plugin.path);
  const normalizedBase = resolve(PLUGINS_DIR);
  if (existsSync(normalizedPath) && normalizedPath.startsWith(`${normalizedBase}/`)) {
    rmSync(normalizedPath, { recursive: true, force: true });
  }

  // Remove from database
  await repo.delete(name);

  return true;
}

export async function enablePlugin(name: string): Promise<boolean> {
  await ensurePluginSchema();
  const repo = getPluginRepo();
  const plugin = await repo.findById(name);
  if (!plugin) return false;
  await repo.update(name, { enabled: true });
  return true;
}

export async function disablePlugin(name: string): Promise<boolean> {
  await ensurePluginSchema();
  const repo = getPluginRepo();
  const plugin = await repo.findById(name);
  if (!plugin) return false;
  await repo.update(name, { enabled: false });
  return true;
}

export async function listPlugins(): Promise<InstalledPlugin[]> {
  return getInstalledPlugins();
}

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  await ensurePluginSchema();
  return getPluginRepo().findMany();
}

export async function addInstalledPlugin(plugin: InstalledPlugin): Promise<void> {
  await ensurePluginSchema();
  const repo = getPluginRepo();
  const existing = await repo.findById(plugin.name);
  if (existing) {
    await repo.update(plugin.name, plugin as never);
  } else {
    await repo.insert(plugin as never);
  }
}
