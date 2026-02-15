/**
 * HTTP & Exec tools: http_fetch, exec_command
 */

import {
  execAsync,
  GLOBAL_IDENTITY_DIR,
  getContext,
  isEnforcementEnabled,
  join,
  logger,
  normalize,
  resolve,
  SESSIONS_DIR,
  sep,
  tool,
  withSecurityCheck,
  z,
} from "./_base.js";

export function createHttpExecTools(sessionName: string): unknown[] {
  const tools: unknown[] = [];

  tools.push(
    tool(
      "http_fetch",
      "Make an HTTP request to an external URL. Supports arbitrary headers including Authorization, API keys, etc.",
      {
        url: z.string().describe("URL to fetch"),
        method: z.string().optional().describe("HTTP method (default: GET)"),
        headers: z.record(z.string(), z.string()).optional().describe("Request headers as key-value pairs."),
        body: z.string().optional().describe("Request body (for POST, PUT, PATCH)"),
        timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
        includeHeaders: z.boolean().optional().describe("Include response headers in output (default: false)"),
      },
      async (args: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        timeout?: number;
        includeHeaders?: boolean;
      }) => {
        return withSecurityCheck("http_fetch", sessionName, async () => {
          const { url, method = "GET", headers = {}, body, timeout = 30000, includeHeaders = false } = args;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, {
              method: method.toUpperCase(),
              headers: headers as Record<string, string>,
              body: body || undefined,
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            let responseHeaders = "";
            if (includeHeaders) {
              const headerLines: string[] = [];
              response.headers.forEach((value, key) => {
                headerLines.push(`${key}: ${value}`);
              });
              responseHeaders = `${headerLines.join("\n")}\n\n`;
            }
            const contentType = response.headers.get("content-type") || "";
            let responseBody: string;
            if (contentType.includes("application/json")) {
              const json = await response.json();
              responseBody = JSON.stringify(json, null, 2);
            } else {
              responseBody = await response.text();
            }
            if (responseBody.length > 10000) responseBody = `${responseBody.substring(0, 10000)}\n... (truncated)`;
            return {
              content: [
                {
                  type: "text",
                  text: `HTTP ${response.status} ${response.statusText}\n${responseHeaders}\n${responseBody}`,
                },
              ],
            };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `HTTP request failed: ${message}` }], isError: true };
          }
        });
      },
    ),
  );

  tools.push(
    tool(
      "exec_command",
      "Execute a shell command. If session is sandboxed, runs in Docker container with full shell access. Otherwise, only safe commands allowed (ls, cat, grep, etc.).",
      {
        command: z.string().describe("Command to execute"),
        cwd: z.string().optional().describe("Working directory (must be within session directory)"),
        timeout: z.number().optional().describe("Timeout in ms (default: 10000, max: 60000)"),
      },
      async (args: { command: string; cwd?: string; timeout?: number }) => {
        return withSecurityCheck("exec_command", sessionName, async () => {
          const { command, cwd, timeout = 10000 } = args;
          const effectiveTimeout = Math.min(timeout, 60000);

          const { execInSandbox, isSessionSandboxed } = await import("../../security/index.js");
          const sandboxed = await isSessionSandboxed(sessionName);

          if (sandboxed) {
            const result = await execInSandbox(sessionName, command, {
              workDir: cwd,
              timeout: effectiveTimeout / 1000,
            });
            if (!result) return { content: [{ type: "text", text: "Failed to execute in sandbox" }], isError: true };
            let output = result.stdout;
            if (result.stderr) output += `\n[stderr]\n${result.stderr}`;
            if (output.length > 10000) output = `${output.substring(0, 10000)}\n... (truncated)`;
            if (result.exitCode !== 0)
              return { content: [{ type: "text", text: output || `Exit code: ${result.exitCode}` }], isError: true };
            return { content: [{ type: "text", text: output || "(no output)" }] };
          }

          const allowedCommands = [
            "ls",
            "cat",
            "grep",
            "find",
            "echo",
            "date",
            "pwd",
            "whoami",
            "head",
            "tail",
            "wc",
            "sort",
            "uniq",
            "diff",
            "which",
            "file",
            "stat",
            "du",
            "df",
            "uptime",
            "hostname",
            "uname",
          ];
          const firstWord = command.trim().split(/\s+/)[0];
          if (!allowedCommands.includes(firstWord))
            return {
              content: [
                {
                  type: "text",
                  text: `Command '${firstWord}' not allowed on host. Allowed: ${allowedCommands.join(", ")}. Enable sandboxing for full shell access.`,
                },
              ],
              isError: true,
            };
          if (
            command.includes(";") ||
            command.includes("&&") ||
            command.includes("||") ||
            command.includes("|") ||
            command.includes("`") ||
            command.includes("$(")
          )
            return {
              content: [
                { type: "text", text: "Shell operators not allowed on host. Enable sandboxing for full shell access." },
              ],
              isError: true,
            };

          const sessionDir = join(SESSIONS_DIR, sessionName);
          let workDir = cwd ? join(cwd) : sessionDir;
          workDir = resolve(normalize(workDir));
          const allowedBases = [SESSIONS_DIR, GLOBAL_IDENTITY_DIR];
          const isAllowed = allowedBases.some((base) => {
            const normalizedBase = resolve(normalize(base));
            return workDir.startsWith(normalizedBase + sep) || workDir === normalizedBase;
          });
          if (!isAllowed)
            return {
              content: [
                {
                  type: "text",
                  text: `Access denied: Working directory '${cwd}' is outside allowed paths. Must be within session directory or global identity.`,
                },
              ],
              isError: true,
            };

          if (workDir.startsWith(resolve(normalize(SESSIONS_DIR)))) {
            const relPath = workDir.slice(resolve(normalize(SESSIONS_DIR)).length + 1);
            const targetSession = relPath.split("/")[0];
            if (targetSession && targetSession !== sessionName) {
              const ctx = getContext(sessionName);
              if (ctx && !ctx.hasCapability("cross.read")) {
                if (isEnforcementEnabled())
                  return {
                    content: [
                      {
                        type: "text",
                        text: `Access denied: Accessing other sessions' directories requires 'cross.read' capability`,
                      },
                    ],
                    isError: true,
                  };
                else
                  logger.warn(
                    `[a2a-mcp] exec_command: ${sessionName} accessing ${targetSession}'s directory without cross.read capability`,
                  );
              }
            }
          }

          try {
            const { stdout, stderr } = await execAsync(command, {
              cwd: workDir,
              timeout: effectiveTimeout,
              maxBuffer: 1024 * 1024,
            });
            let output = stdout;
            if (stderr) output += `\n[stderr]\n${stderr}`;
            if (output.length > 10000) output = `${output.substring(0, 10000)}\n... (truncated)`;
            return { content: [{ type: "text", text: output || "(no output)" }] };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Command failed: ${message}` }], isError: true };
          }
        });
      },
    ),
  );

  return tools;
}
