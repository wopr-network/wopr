/**
 * Plugin installation, removal, enable/disable, and persistence.
 *
 * Manages the on-disk plugins.json registry and the actual plugin
 * file-system operations (clone, symlink, npm install).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger } from "../logger.js";
import type { InstalledPlugin } from "../types.js";
import { ensurePluginSchema, getPluginRepo } from "./plugin-storage.js";
import { PLUGINS_DIR } from "./state.js";

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
      execFileSync("git", ["clone", `https://github.com/${parts[0]}/${parts[1]}`, pluginDir], { stdio: "inherit" });
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
    const pluginDir = join(PLUGINS_DIR, resolved.split("/").pop() || "plugin");

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
    // npm package - normalize to wopr-plugin-<name> format (accept wopr-<name> too)
    const shortName = source.replace(/^wopr-plugin-/, "").replace(/^wopr-/, "");
    const npmPackage =
      source.startsWith("wopr-") && !source.startsWith("wopr-plugin-") ? source : `wopr-plugin-${shortName}`;
    if (!SAFE_PKG.test(npmPackage)) throw new Error(`Invalid npm package name: ${npmPackage}`);
    const pluginDir = join(PLUGINS_DIR, shortName);
    mkdirSync(pluginDir, { recursive: true });

    // Use npm to install
    execFileSync("npm", ["install", npmPackage], { cwd: pluginDir, stdio: "inherit" });

    // Read installed package metadata
    const pkgPath = join(pluginDir, "node_modules", npmPackage, "package.json");
    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, "utf-8")) : {};

    const installed: InstalledPlugin = {
      name: shortName,
      version: pkg.version || "0.0.0",
      description: pkg.description,
      source: "npm",
      path: join(pluginDir, "node_modules", npmPackage),
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
