/**
 * `wopr doctor` — Validate environment and diagnose common issues.
 */
import { access, constants, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../core/config.js";
import { logger } from "../logger.js";
import { CONFIG_FILE, WOPR_HOME } from "../paths.js";
import { getInstalledPlugins } from "../plugins/installation.js";

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  fix?: string;
}

/**
 * Run all doctor checks and return results.
 * Exported for testing — doctorCommand() calls this and formats output.
 */
export async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Node.js version
  const nodeVersion = process.versions.node;
  const [major] = nodeVersion.split(".").map(Number);
  results.push({
    name: "Node.js version",
    pass: major >= 24,
    detail: `v${nodeVersion}`,
    fix: major < 24 ? "Install Node.js >= 24.0.0 (https://nodejs.org)" : undefined,
  });

  // 2. Config file exists and is valid
  let configLoaded = false;
  try {
    await config.load();
    configLoaded = true;
    results.push({ name: "Config file", pass: true, detail: CONFIG_FILE });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      name: "Config file",
      pass: false,
      detail: msg,
      fix: `Run "wopr init" to create a valid config, or check ${CONFIG_FILE}`,
    });
  }

  // 3. Environment variables — provider API keys present in the shell environment
  const hasAnthropicEnv = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAIEnv = !!process.env.OPENAI_API_KEY;
  const hasWoprApiKey = !!process.env.WOPR_API_KEY;
  const hasWoprOauth = !!process.env.WOPR_CLAUDE_OAUTH_TOKEN;
  const hasAnyEnv = hasAnthropicEnv || hasOpenAIEnv || hasWoprApiKey || hasWoprOauth;
  results.push({
    name: "Environment variables",
    pass: hasAnyEnv,
    detail: hasAnyEnv
      ? `${[hasAnthropicEnv && "ANTHROPIC_API_KEY", hasOpenAIEnv && "OPENAI_API_KEY", hasWoprApiKey && "WOPR_API_KEY", hasWoprOauth && "WOPR_CLAUDE_OAUTH_TOKEN"].filter(Boolean).join(", ")} set`
      : "No provider API key environment variables found",
    fix: hasAnyEnv
      ? undefined
      : 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, WOPR_API_KEY, or WOPR_CLAUDE_OAUTH_TOKEN, or run "wopr auth login" for OAuth',
  });

  // 4. Provider credentials — API keys configured in the config file
  const hasAnthropicConfig = !!(configLoaded && config.get().anthropic?.apiKey);
  const hasAnyConfig = hasAnthropicConfig;
  results.push({
    name: "Provider credentials",
    pass: hasAnyConfig,
    detail: hasAnyConfig ? "At least one provider key configured" : "No credentials in config",
    fix: hasAnyConfig ? undefined : 'Run "wopr providers add <id> <key>" or "wopr auth login"',
  });

  // 5. Plugin manifests
  try {
    const plugins = await getInstalledPlugins();
    if (plugins.length === 0) {
      results.push({ name: "Plugin manifests", pass: true, detail: "No plugins installed" });
    } else {
      const invalid: string[] = [];
      for (const p of plugins) {
        const pkgPath = join(p.path, "package.json");
        const woprManifestPath = join(p.path, "wopr-plugin.json");
        let valid = false;
        for (const manifestPath of [pkgPath, woprManifestPath]) {
          try {
            const raw = await readFile(manifestPath, "utf-8");
            JSON.parse(raw);
            valid = true;
            break;
          } catch {
            // try next
          }
        }
        if (!valid) {
          invalid.push(p.name);
        }
      }
      if (invalid.length > 0) {
        results.push({
          name: "Plugin manifests",
          pass: false,
          detail: `Invalid: ${invalid.join(", ")}`,
          fix: 'Reinstall broken plugins with "wopr plugin remove <name> && wopr plugin install <name>"',
        });
      } else {
        results.push({
          name: "Plugin manifests",
          pass: true,
          detail: `${plugins.length} plugin(s) valid`,
        });
      }
    }
  } catch (err) {
    results.push({
      name: "Plugin manifests",
      pass: false,
      detail: err instanceof Error ? err.message : String(err),
      fix: "Check plugin storage integrity",
    });
  }

  // 6. Data directory writable
  try {
    await access(WOPR_HOME, constants.W_OK);
    results.push({ name: "Data directory", pass: true, detail: WOPR_HOME });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const isMissing = code === "ENOENT";
    results.push({
      name: "Data directory",
      pass: false,
      detail: isMissing ? `${WOPR_HOME} does not exist` : `${WOPR_HOME} is not writable`,
      fix: isMissing ? `Run "mkdir -p ${WOPR_HOME}"` : `Run "chmod 700 ${WOPR_HOME}"`,
    });
  }

  return results;
}

export async function doctorCommand(): Promise<void> {
  logger.info("Running environment checks...\n");

  const results = await runChecks();
  let anyFailed = false;

  for (const r of results) {
    const icon = r.pass ? "\u2705" : "\u274C";
    logger.info(`${icon}  ${r.name}: ${r.detail}`);
    if (!r.pass) {
      anyFailed = true;
      if (r.fix) {
        logger.info(`   Fix: ${r.fix}`);
      }
    }
  }

  logger.info("");
  if (anyFailed) {
    logger.info("Some checks failed. Fix the issues above and run 'wopr doctor' again.");
    process.exit(1);
  } else {
    logger.info("All checks passed.");
  }
}
