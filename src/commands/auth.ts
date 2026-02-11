/**
 * `wopr auth` commands - authentication management.
 */
import { execFileSync } from "node:child_process";
import {
  buildAuthUrl,
  clearAuth,
  exchangeCode,
  generatePKCE,
  loadAuth,
  loadAuthFromEnv,
  loadClaudeCodeCredentials,
  saveApiKey,
  saveOAuthTokens,
} from "../auth.js";
import { logger } from "../logger.js";
import { help } from "./help.js";

export async function authCommand(subcommand: string | undefined, args: string[]): Promise<void> {
  if (!subcommand || subcommand === "status") {
    const envAuth = loadAuthFromEnv();
    const claudeCodeAuth = loadClaudeCodeCredentials();
    const auth = loadAuth();

    if (envAuth) {
      if (envAuth.type === "oauth") {
        logger.info("Auth: OAuth (environment variable)");
        logger.info("Source: WOPR_CLAUDE_OAUTH_TOKEN");
      } else {
        logger.info("Auth: API Key (environment variable)");
        logger.info("Source: WOPR_API_KEY");
      }
      if (process.env.WOPR_CREDENTIAL_KEY) {
        logger.info("Encryption: auth.json encrypted at rest");
      }
    } else if (claudeCodeAuth) {
      logger.info("Auth: Claude Code OAuth (shared credentials)");
      logger.info("Source: ~/.claude/.credentials.json");
      if (claudeCodeAuth.expiresAt) {
        const exp = new Date(claudeCodeAuth.expiresAt);
        const now = Date.now();
        if (claudeCodeAuth.expiresAt > now) {
          logger.info(`Expires: ${exp.toLocaleString()}`);
        } else {
          logger.info(`Expired: ${exp.toLocaleString()} (will auto-refresh)`);
        }
      }
    } else if (!auth || (!auth.apiKey && !auth.accessToken)) {
      logger.info("Not authenticated");
      logger.info("\nLogin with Claude Max/Pro:");
      logger.info("  wopr auth login");
      logger.info("\nOr use an API key:");
      logger.info("  wopr auth api-key <your-key>");
    } else if (auth.type === "oauth") {
      logger.info("Auth: OAuth (Claude Max/Pro)");
      if (auth.email) logger.info(`Email: ${auth.email}`);
      if (auth.expiresAt) {
        logger.info(`Expires: ${new Date(auth.expiresAt).toLocaleString()}`);
      }
    } else if (auth.type === "api_key") {
      logger.info("Auth: API Key");
      if (auth.apiKey) {
        const masked = auth.apiKey.length > 4 ? `...${auth.apiKey.slice(-4)}` : "****";
        logger.info(`Key: ${masked}`);
      }
    }
  } else if (subcommand === "login") {
    const pkce = generatePKCE();
    const redirectUri = "http://localhost:9876/callback";
    const authUrl = buildAuthUrl(pkce, redirectUri);

    logger.info("Opening browser for authentication...\n");
    logger.info("If browser doesn't open, visit:");
    logger.info(authUrl);
    logger.info("\nWaiting for authentication...");

    const http = await import("node:http");
    const url = await import("node:url");

    const server = http.createServer(async (req, res) => {
      const parsed = url.parse(req.url || "", true);
      if (parsed.pathname === "/callback") {
        const code = parsed.query.code as string;
        const state = parsed.query.state as string;

        if (state !== pkce.state) {
          res.writeHead(400);
          res.end("Invalid state parameter");
          server.close();
          logger.error("Error: Invalid state parameter");
          process.exit(1);
        }

        try {
          const tokens = await exchangeCode(code, pkce.codeVerifier, redirectUri);
          saveOAuthTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h1>Success!</h1><p>You can close this window.</p></body></html>");
          server.close();

          logger.info("\nAuthenticated successfully!");
          logger.info("Your Claude Max/Pro subscription is now linked.");
          process.exit(0);
        } catch (err: any) {
          res.writeHead(500);
          res.end(`Error: ${err.message}`);
          server.close();
          logger.error("Error:", err.message);
          process.exit(1);
        }
      }
    });

    server.listen(9876, () => {
      const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      execFileSync(open, [authUrl], { stdio: "ignore" });
    });

    setTimeout(
      () => {
        logger.error("\nTimeout waiting for authentication");
        server.close();
        process.exit(1);
      },
      5 * 60 * 1000,
    );
  } else if (subcommand === "api-key") {
    if (!args[0]) {
      logger.error("Usage: wopr auth api-key <your-api-key>");
      process.exit(1);
    }
    saveApiKey(args[0]);
    logger.info("API key saved");
  } else if (subcommand === "logout") {
    clearAuth();
    logger.info("Logged out (WOPR credentials cleared; Claude Code OAuth credentials are managed separately)");
  } else {
    help();
  }
}
