/**
 * Onboard wizard helpers
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OnboardConfig, OnboardRuntime } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgVersion: string = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../package.json"), "utf-8"),
).version;

export const DEFAULT_WORKSPACE = path.join(os.homedir(), ".wopr", "workspace");
export const DEFAULT_PORT = 3000;

export function summarizeExistingConfig(cfg: OnboardConfig): string {
  const rows: string[] = [];

  if (cfg.workspace) {
    rows.push(`workspace: ${cfg.workspace}`);
  }
  if (cfg.provider?.primary) {
    rows.push(`provider: ${cfg.provider.primary}`);
  }
  if (cfg.gateway?.port) {
    rows.push(`gateway.port: ${cfg.gateway.port}`);
  }
  if (cfg.gateway?.auth?.token) {
    rows.push(`gateway.auth: token configured`);
  }
  if (cfg.channels?.length) {
    rows.push(`channels: ${cfg.channels.join(", ")}`);
  }

  return rows.length ? rows.join("\n") : "No configuration detected.";
}

export function randomToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 48; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function detectBinary(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "where" : "which";
    const proc = spawn(cmd, [name], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

export async function isSystemdAvailable(): Promise<boolean> {
  if (process.platform !== "linux") return false;
  return detectBinary("systemctl");
}

export async function isLaunchdAvailable(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  return detectBinary("launchctl");
}

export async function probeGateway(
  url: string,
  token?: string,
  timeoutMs = 2000,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${url}/health`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (err: any) {
    return { ok: false, error: err.message || "Connection failed" };
  }
}

export async function waitForGateway(
  url: string,
  token?: string,
  options: { deadlineMs?: number; pollMs?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const { deadlineMs = 15000, pollMs = 500 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < deadlineMs) {
    const result = await probeGateway(url, token, pollMs);
    if (result.ok) return result;
    await new Promise((resolve) => globalThis.setTimeout(resolve, pollMs));
  }

  return { ok: false, error: "Timeout waiting for gateway" };
}

export async function installSystemdService(
  port: number,
  token: string,
  runtime: OnboardRuntime,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const serviceName = "wopr-daemon.service";
    const homeDir = os.homedir();
    const serviceDir = path.join(homeDir, ".config", "systemd", "user");
    const servicePath = path.join(serviceDir, serviceName);

    // Ensure directory exists
    await fs.mkdir(serviceDir, { recursive: true });

    const serviceContent = `[Unit]
Description=WOPR Daemon
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${process.argv[1]} daemon run
Environment="WOPR_HOME=${process.env.WOPR_HOME || path.join(homeDir, ".wopr")}"
Environment="WOPR_GATEWAY_TOKEN=${token}"
Environment="WOPR_PORT=${port}"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

    await fs.writeFile(servicePath, serviceContent, "utf-8");
    runtime.log(`Service file created: ${servicePath}`);

    // Reload and enable
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`systemctl daemon-reload failed with code ${code}`));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("systemctl", ["--user", "enable", serviceName], { stdio: "inherit" });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`systemctl enable failed with code ${code}`));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("systemctl", ["--user", "start", serviceName], { stdio: "inherit" });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`systemctl start failed with code ${code}`));
      });
    });

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function installLaunchdService(
  port: number,
  token: string,
  runtime: OnboardRuntime,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const plistName = "ai.wopr.daemon.plist";
    const homeDir = os.homedir();
    const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
    const plistPath = path.join(launchAgentsDir, plistName);

    // Ensure directory exists
    await fs.mkdir(launchAgentsDir, { recursive: true });

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.wopr.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${process.argv[1]}</string>
        <string>daemon</string>
        <string>run</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>WOPR_HOME</key>
        <string>${process.env.WOPR_HOME || path.join(homeDir, ".wopr")}</string>
        <key>WOPR_GATEWAY_TOKEN</key>
        <string>${token}</string>
        <key>WOPR_PORT</key>
        <string>${port}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(homeDir, "Library", "Logs", "wopr-daemon.log")}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(homeDir, "Library", "Logs", "wopr-daemon.error.log")}</string>
</dict>
</plist>
`;

    await fs.writeFile(plistPath, plistContent, "utf-8");
    runtime.log(`LaunchAgent created: ${plistPath}`);

    // Load the service
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("launchctl", ["load", plistPath], { stdio: "inherit" });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`launchctl load failed with code ${code}`));
      });
    });

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let command: string;
    let args: string[];

    switch (process.platform) {
      case "darwin":
        command = "open";
        args = [url];
        break;
      case "win32":
        command = "cmd";
        args = ["/c", "start", url];
        break;
      default:
        command = "xdg-open";
        args = [url];
    }

    const proc = spawn(command, args, { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

export async function applyWizardMetadata(
  cfg: OnboardConfig,
  params: { command: string; mode?: string },
): Promise<OnboardConfig> {
  return {
    ...cfg,
    wizard: {
      lastRunAt: new Date().toISOString(),
      lastRunVersion: pkgVersion,
      lastRunCommand: params.command,
      lastRunMode: params.mode,
    },
  };
}
