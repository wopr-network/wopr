/**
 * Step 7d: GitHub Integration
 *
 * Sets up GitHub webhook routing for PR automation.
 */

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { confirm, note, pc, select, spinner, text } from "../prompts.js";
import type { OnboardContext, OnboardStep } from "../types.js";

function exec(cmd: string): { stdout: string; success: boolean } {
  try {
    const stdout = execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim();
    return { stdout, success: true };
  } catch (err: any) {
    return { stdout: err.stderr || err.message || "", success: false };
  }
}

function checkGhAuth(): boolean {
  const result = exec("gh auth status");
  return result.success;
}

function getGhOrgs(): string[] {
  const result = exec("gh api user/orgs --jq '.[].login'");
  if (!result.success) return [];
  return result.stdout.split("\n").filter(Boolean);
}

export const githubStep: OnboardStep = async (ctx: OnboardContext) => {
  // Check if external access is configured
  const external = (ctx.nextConfig as any).external;
  if (!external?.webhookUrl) {
    await note(
      [
        "Skipping GitHub integration.",
        "",
        "GitHub webhooks require external access (Tailscale Funnel).",
        "Set up external access first, then re-run this wizard.",
      ].join("\n"),
      "GitHub",
    );
    return {};
  }

  // Ask if user wants GitHub integration
  const wantGithub = await confirm({
    message: "Set up GitHub webhook integration?",
    initialValue: true,
  });

  if (!wantGithub) {
    await note(
      ["Skipping GitHub integration.", "", "You can set this up later:", pc.cyan("  wopr github setup <org>")].join(
        "\n",
      ),
      "GitHub",
    );
    return {};
  }

  // Check gh CLI
  const s = await spinner();
  s.start("Checking GitHub CLI...");

  const ghInstalled = exec("which gh").success;
  if (!ghInstalled) {
    s.stop("GitHub CLI not installed");
    await note(
      [
        "GitHub CLI (gh) is required for webhook setup.",
        "",
        "Install it:",
        pc.cyan("  brew install gh       # macOS"),
        pc.cyan("  apt install gh        # Debian/Ubuntu"),
        pc.cyan("  winget install gh     # Windows"),
        "",
        "Then authenticate:",
        pc.cyan("  gh auth login"),
        "",
        "And re-run this wizard.",
      ].join("\n"),
      "GitHub CLI Required",
    );
    return {};
  }

  const ghAuthed = checkGhAuth();
  if (!ghAuthed) {
    s.stop("GitHub CLI not authenticated");
    await note(
      [
        "GitHub CLI needs to be authenticated.",
        "",
        "Run:",
        pc.cyan("  gh auth login"),
        "",
        "Then re-run this wizard.",
      ].join("\n"),
      "GitHub Auth Required",
    );
    return {};
  }

  s.stop("GitHub CLI authenticated");

  // Get orgs
  s.start("Fetching your GitHub organizations...");
  const orgs = getGhOrgs();
  s.stop(`Found ${orgs.length} organization(s)`);

  if (orgs.length === 0) {
    const manualOrg = await text({
      message: "Enter organization name to configure:",
      placeholder: "wopr-network",
    });

    if (!manualOrg) {
      await note("No organization configured.", "GitHub");
      return {};
    }

    orgs.push(manualOrg);
  }

  // Select org to configure
  let selectedOrg: string;
  if (orgs.length === 1) {
    const useOrg = await confirm({
      message: `Configure webhooks for ${orgs[0]}?`,
      initialValue: true,
    });
    if (!useOrg) return {};
    selectedOrg = orgs[0];
  } else {
    selectedOrg = await select({
      message: "Select organization to configure:",
      options: orgs.map((o) => ({ value: o, label: o })),
    });
  }

  // Configure PR review session
  const prSession = await text({
    message: "Session to route PR events to:",
    initialValue: "discord:misfits:#pay-no-attention-to-the-man-behind-the-curtain",
    placeholder: "discord:server:#channel",
  });

  // Create webhook
  s.start(`Setting up webhook for ${selectedOrg}...`);

  const webhookUrl = `${external.webhookUrl}/github`;
  const webhookSecret = randomBytes(32).toString("hex");

  const createCmd = `gh api orgs/${selectedOrg}/hooks -X POST \
    -f name=web \
    -f active=true \
    -f 'config[url]=${webhookUrl}' \
    -f 'config[content_type]=json' \
    -f 'config[secret]=${webhookSecret}' \
    -f 'events[]=pull_request' \
    -f 'events[]=pull_request_review' \
    --jq '.id'`;

  const createResult = exec(createCmd);

  if (!createResult.success) {
    s.stop("Webhook creation failed");

    // Check if it already exists
    const listResult = exec(`gh api orgs/${selectedOrg}/hooks --jq '.[].config.url'`);
    if (listResult.success && listResult.stdout.includes(webhookUrl)) {
      await note(
        [
          `Webhook already exists for ${selectedOrg}!`,
          "",
          `URL: ${webhookUrl}`,
          "",
          "PRs will be routed to the configured session.",
        ].join("\n"),
        "GitHub Webhook",
      );
    } else {
      await note(
        [
          "Failed to create webhook.",
          "",
          `Error: ${createResult.stdout}`,
          "",
          "You may need admin access to the organization.",
          "Try manually:",
          pc.cyan(`  wopr github setup ${selectedOrg}`),
        ].join("\n"),
        "Webhook Error",
      );
    }
    return {};
  }

  const webhookId = createResult.stdout;
  s.stop(`Webhook created! ID: ${webhookId}`);

  await note(
    [
      `GitHub webhook configured for ${selectedOrg}!`,
      "",
      `Webhook URL: ${pc.green(webhookUrl)}`,
      `PR Session: ${pc.cyan(prSession)}`,
      "",
      "When PRs are opened or reviewed, events will be",
      `routed to ${prSession} for automated handling.`,
      "",
      pc.dim("The webhook secret is stored in config for signature verification."),
      pc.dim("Update webhook config: wopr configure --plugin github"),
    ].join("\n"),
    "GitHub Integration Ready",
  );

  // Note: webhookSecret and prReviewSession are returned to OnboardConfig
  // and saved to wopr.config.json. The wopr-plugin-github webhook handler
  // reads these values from config for signature verification and routing.
  return {
    github: {
      orgs: [selectedOrg],
      webhookSecret,
      prReviewSession: prSession,
    },
  } as any;
};
