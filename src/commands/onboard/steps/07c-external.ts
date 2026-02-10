/**
 * Step 7c: External Access (Tailscale Funnel)
 *
 * Sets up external webhook access via Tailscale Funnel.
 */

import { execSync } from "node:child_process";
import { confirm, note, pc, spinner } from "../prompts.js";
import type { OnboardContext, OnboardStep } from "../types.js";

function exec(cmd: string): { stdout: string; success: boolean } {
  try {
    const stdout = execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
    return { stdout, success: true };
  } catch {
    return { stdout: "", success: false };
  }
}

function checkTailscale(): { installed: boolean; connected: boolean; hostname?: string } {
  // Check if installed
  const which = exec("which tailscale");
  if (!which.success) {
    return { installed: false, connected: false };
  }

  // Check if connected
  const status = exec("tailscale status --json");
  if (!status.success) {
    return { installed: true, connected: false };
  }

  try {
    const parsed = JSON.parse(status.stdout);
    if (parsed.BackendState !== "Running") {
      return { installed: true, connected: false };
    }
    const hostname = parsed.Self?.DNSName?.replace(/\.$/, "") || undefined;
    return { installed: true, connected: true, hostname };
  } catch {
    return { installed: true, connected: false };
  }
}

export const externalStep: OnboardStep = async (_ctx: OnboardContext) => {
  // Skip if user doesn't want external access
  const wantExternal = await confirm({
    message: "Set up external webhook access (for GitHub, etc)?",
    initialValue: false,
  });

  if (!wantExternal) {
    await note(
      ["Skipping external access setup.", "", "You can set this up later:", pc.cyan("  wopr funnel expose 7438")].join(
        "\n",
      ),
      "External Access",
    );
    return {};
  }

  // Check Tailscale status
  const s = await spinner();
  s.start("Checking Tailscale...");

  const ts = checkTailscale();

  if (!ts.installed) {
    s.stop("Tailscale not installed");
    await note(
      [
        "Tailscale is required for external webhook access.",
        "",
        "Install Tailscale:",
        pc.cyan("  curl -fsSL https://tailscale.com/install.sh | sh"),
        "",
        "Or visit: https://tailscale.com/download",
        "",
        "After installing, run:",
        pc.cyan("  tailscale up"),
        pc.cyan("  wopr onboard  # re-run this wizard"),
      ].join("\n"),
      "Tailscale Required",
    );
    return {};
  }

  if (!ts.connected) {
    s.stop("Tailscale not connected");
    await note(
      [
        "Tailscale is installed but not connected.",
        "",
        "Connect to your tailnet:",
        pc.cyan("  tailscale up"),
        "",
        "Then re-run this wizard:",
        pc.cyan("  wopr onboard"),
      ].join("\n"),
      "Tailscale Not Connected",
    );
    return {};
  }

  s.stop(`Tailscale connected: ${ts.hostname}`);

  // Enable funnel
  s.start("Enabling Tailscale Funnel...");

  // Check if funnel is enabled in ACL
  const funnelTest = exec("tailscale funnel status");
  if (!funnelTest.success || funnelTest.stdout.includes("not enabled")) {
    s.stop("Funnel not enabled");
    await note(
      [
        "Tailscale Funnel needs to be enabled in your tailnet.",
        "",
        "1. Go to https://login.tailscale.com/admin/acls",
        "2. Add this to your ACL policy:",
        pc.cyan(`  "nodeAttrs": [
    {
      "target": ["*"],
      "attr": ["funnel"]
    }
  ]`),
        "",
        "Then re-run this wizard.",
      ].join("\n"),
      "Enable Funnel",
    );
    return {};
  }

  // Start funnel for webhook port
  const webhookPort = 7438;
  const funnelResult = exec(`tailscale funnel ${webhookPort}`);
  if (!funnelResult.success) {
    s.stop("Failed to enable funnel");
    await note(
      [
        "Could not enable Tailscale Funnel.",
        "",
        `Error: ${funnelResult.stdout}`,
        "",
        "Check your Tailscale configuration and try again.",
      ].join("\n"),
      "Funnel Error",
    );
    return {};
  }

  s.stop("Funnel enabled!");

  const webhookUrl = `https://${ts.hostname}/hooks`;

  await note(
    [
      "External access configured!",
      "",
      `Webhook URL: ${pc.green(webhookUrl)}`,
      "",
      "This URL is now publicly accessible and can receive",
      "webhooks from GitHub, Stripe, or any external service.",
      "",
      pc.dim("The funnel plugin will auto-start with the daemon."),
    ].join("\n"),
    "External Access Ready",
  );

  return {
    external: {
      enabled: true,
      hostname: ts.hostname,
      webhookUrl,
    },
  } as any;
};
