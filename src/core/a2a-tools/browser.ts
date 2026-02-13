/**
 * Browser A2A tools: browser_navigate, browser_click, browser_type,
 * browser_screenshot, browser_evaluate
 *
 * Uses Playwright (optional peer dependency, lazy-loaded) with CDP control.
 * Browser profiles persist cookies/sessions across invocations.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger, tool, withSecurityCheck, z } from "./_base.js";
import { loadProfile, saveProfile } from "./browser-profile.js";

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

/** Default navigation/action timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum serialized size (in characters) for evaluate return values. */
const MAX_EVALUATE_RESULT_LENGTH = 10_000;

/** Maximum page content length before truncation. */
const MAX_PAGE_CONTENT_LENGTH = 15_000;

// ---------------------------------------------------------------------------
// SSRF protection: URL validation
// ---------------------------------------------------------------------------

/**
 * Check whether a URL is safe for browser navigation.
 * Blocks non-HTTP(S) schemes and private/internal IP addresses.
 */
export function isUrlSafe(rawUrl: string): { safe: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  // Only allow http and https schemes
  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return { safe: false, reason: `Blocked URL scheme: ${scheme}` };
  }

  // Extract hostname (strip brackets from IPv6)
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // Check for private/internal IP ranges
  if (isPrivateHost(hostname)) {
    return { safe: false, reason: `Blocked private/internal address: ${hostname}` };
  }

  return { safe: true };
}

function isPrivateHost(hostname: string): boolean {
  // Localhost names
  if (hostname === "localhost" || hostname === "localhost.") {
    return true;
  }

  // Try parsing as IPv4
  const ipv4 = parseIPv4(hostname);
  if (ipv4) {
    return isPrivateIPv4(ipv4);
  }

  // Try parsing as IPv6
  const ipv6 = parseIPv6(hostname);
  if (ipv6) {
    return isPrivateIPv6(ipv6);
  }

  return false;
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255 || !Number.isInteger(n))) return null;
  return nums;
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0
  if (octets.every((o) => o === 0)) return true;
  return false;
}

function parseIPv6(host: string): string | null {
  // Quick check: must contain a colon to be IPv6
  if (!host.includes(":")) return null;
  // Normalize and return the lowercase form for checking
  try {
    // Use a dummy URL to let the URL parser normalize IPv6
    const u = new URL(`http://[${host}]`);
    return u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

function isPrivateIPv6(normalized: string): boolean {
  // ::1 (loopback)
  if (normalized === "::1") return true;
  // :: (unspecified)
  if (normalized === "::") return true;
  // fe80::/10 (link-local)
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe80")) return true;
  // fd00::/8 (unique local)
  if (normalized.startsWith("fd")) return true;
  // fc00::/7 (unique local)
  if (normalized.startsWith("fc")) return true;

  // IPv4-mapped IPv6: ::ffff:x.x.x.x (dotted-decimal form)
  const v4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) {
    const ipv4 = parseIPv4(v4MappedMatch[1]);
    if (ipv4 && isPrivateIPv4(ipv4)) return true;
  }

  // IPv4-mapped IPv6 in hex form: ::ffff:XXYY:ZZWW (Node's URL parser normalizes to this)
  const v4HexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4HexMatch) {
    const hi = parseInt(v4HexMatch[1], 16);
    const lo = parseInt(v4HexMatch[2], 16);
    const octets = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
    if (isPrivateIPv4(octets)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Lazy Playwright loading (optional peer dependency)
// ---------------------------------------------------------------------------

// We use `any` for the Playwright module since it's an optional peer dep
// and won't have type declarations available at compile time.
let pw: any = null;

async function getPlaywright(): Promise<any> {
  if (pw) return pw;
  try {
    // Dynamic require to avoid TypeScript resolving the optional peer dep at compile time
    const moduleName = "playwright";
    pw = await import(/* webpackIgnore: true */ moduleName);
    return pw;
  } catch {
    throw new Error("Playwright is not installed. Install it with: npm install playwright");
  }
}

// ---------------------------------------------------------------------------
// Browser instance cache (keyed by profile name)
// ---------------------------------------------------------------------------

interface BrowserInstance {
  browser: any; // playwright Browser
  context: any; // playwright BrowserContext
  page: any; // playwright Page
  profileName: string;
}

const instances = new Map<string, BrowserInstance>();

// Guard: register process-exit cleanup only once to kill orphaned Chrome processes.
// Use a symbol on process to survive module re-evaluation (e.g., in tests).
const CLEANUP_SYMBOL = Symbol.for("wopr-browser-cleanup");
function ensureProcessCleanup(): void {
  if ((process as any)[CLEANUP_SYMBOL]) return;
  (process as any)[CLEANUP_SYMBOL] = true;
  const cleanup = () => {
    for (const [, instance] of instances) {
      try {
        const proc = instance.browser.process?.();
        if (proc && !proc.killed) {
          proc.kill("SIGKILL");
        }
      } catch {
        // Best-effort — ignore errors during exit
      }
      try {
        instance.browser.close();
      } catch {
        // Best-effort
      }
    }
    instances.clear();
  };
  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function getOrCreateInstance(profileName: string): Promise<BrowserInstance> {
  const existing = instances.get(profileName);
  if (existing) {
    try {
      // Verify the browser is still connected
      if (existing.browser.isConnected()) {
        return existing;
      }
    } catch {
      // Browser disconnected, clean up
      instances.delete(profileName);
    }
  }

  ensureProcessCleanup();

  const playwright = await getPlaywright();
  const profile = loadProfile(profileName);

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Restore cookies from profile
  if (profile.cookies.length > 0) {
    await context.addCookies(profile.cookies);
  }

  const page = await context.newPage();

  const instance: BrowserInstance = { browser, context, page, profileName };
  instances.set(profileName, instance);
  return instance;
}

async function persistProfile(instance: BrowserInstance): Promise<void> {
  try {
    const cookies = await instance.context.cookies();
    const profile = loadProfile(instance.profileName);
    profile.cookies = cookies;
    saveProfile(profile);
  } catch (err) {
    logger.warn(`[browser] Failed to persist profile "${instance.profileName}": ${err}`);
  }
}

// ---------------------------------------------------------------------------
// HTML-to-Markdown conversion (lightweight, no heavy deps)
// ---------------------------------------------------------------------------

function htmlToMarkdown(html: string): string {
  // Strip scripts and styles
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Convert common elements
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n");
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "##### $1\n\n");
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "###### $1\n\n");

  // Links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Images
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, "![$1]($2)");
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Bold and italic
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");

  // Paragraphs and line breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");
  text = text.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "$1\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

export async function closeAllBrowsers(): Promise<void> {
  for (const [name, instance] of instances) {
    try {
      await persistProfile(instance);
    } catch (err) {
      logger.warn(`[browser] Error persisting profile "${name}": ${err}`);
    }
    try {
      await instance.browser.close();
    } catch (err) {
      logger.warn(`[browser] Error closing browser for profile "${name}": ${err}`);
      // Force-kill the process if close() failed
      try {
        const proc = instance.browser.process?.();
        if (proc && !proc.killed) {
          proc.kill("SIGKILL");
        }
      } catch {
        // Best-effort
      }
    }
  }
  instances.clear();
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createBrowserTools(sessionName: string): any[] {
  const tools: any[] = [];

  // -------------------------------------------------------------------------
  // browser_navigate
  // -------------------------------------------------------------------------
  tools.push(
    tool(
      "browser_navigate",
      "Navigate to a URL and return the page content as markdown. Creates a browser instance if needed. Use the profile parameter to persist cookies/sessions across calls.",
      {
        url: z.string().describe("URL to navigate to"),
        profile: z.string().optional().describe("Browser profile name for session persistence (default: 'default')"),
        waitFor: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .optional()
          .describe("Wait condition (default: 'domcontentloaded')"),
        timeout: z.number().optional().describe(`Navigation timeout in ms (default: ${DEFAULT_TIMEOUT_MS})`),
      },
      async (args: any) => {
        return withSecurityCheck("browser_navigate", sessionName, async () => {
          const {
            url,
            profile: profileName = "default",
            waitFor = "domcontentloaded",
            timeout = DEFAULT_TIMEOUT_MS,
          } = args;

          // SSRF protection: validate URL before navigating
          const urlCheck = isUrlSafe(url);
          if (!urlCheck.safe) {
            return {
              content: [{ type: "text", text: `Navigation blocked: ${urlCheck.reason}` }],
              isError: true,
            };
          }

          try {
            const instance = await getOrCreateInstance(profileName);
            await instance.page.goto(url, { waitUntil: waitFor, timeout });

            // Re-validate final URL after redirects to prevent SSRF bypass
            const pageUrl = instance.page.url();
            const finalCheck = isUrlSafe(pageUrl);
            if (!finalCheck.safe) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Navigation blocked after redirect: ${finalCheck.reason} (redirected to ${pageUrl})`,
                  },
                ],
                isError: true,
              };
            }

            const title = await instance.page.title();
            const html = await instance.page.content();
            const markdown = htmlToMarkdown(html);
            await persistProfile(instance);

            const truncated =
              markdown.length > MAX_PAGE_CONTENT_LENGTH
                ? `${markdown.substring(0, MAX_PAGE_CONTENT_LENGTH)}\n\n... (truncated)`
                : markdown;

            return {
              content: [
                {
                  type: "text",
                  text: `# ${title}\n\nURL: ${pageUrl}\n\n---\n\n${truncated}`,
                },
              ],
            };
          } catch (err: any) {
            return { content: [{ type: "text", text: `Navigation failed: ${err.message}` }], isError: true };
          }
        });
      },
    ),
  );

  // -------------------------------------------------------------------------
  // browser_click
  // -------------------------------------------------------------------------
  tools.push(
    tool(
      "browser_click",
      "Click an element on the current page by CSS selector.",
      {
        selector: z.string().describe("CSS selector of the element to click"),
        profile: z.string().optional().describe("Browser profile name (default: 'default')"),
        timeout: z.number().optional().describe("Timeout in ms to wait for element (default: 5000)"),
      },
      async (args: any) => {
        return withSecurityCheck("browser_click", sessionName, async () => {
          const { selector, profile: profileName = "default", timeout = 5000 } = args;
          try {
            const instance = await getOrCreateInstance(profileName);
            await instance.page.click(selector, { timeout });
            await persistProfile(instance);
            const pageUrl = instance.page.url();
            return {
              content: [{ type: "text", text: `Clicked "${selector}" on ${pageUrl}` }],
            };
          } catch (err: any) {
            return { content: [{ type: "text", text: `Click failed: ${err.message}` }], isError: true };
          }
        });
      },
    ),
  );

  // -------------------------------------------------------------------------
  // browser_type
  // -------------------------------------------------------------------------
  tools.push(
    tool(
      "browser_type",
      "Type text into an input field identified by CSS selector.",
      {
        selector: z.string().describe("CSS selector of the input element"),
        text: z.string().describe("Text to type"),
        profile: z.string().optional().describe("Browser profile name (default: 'default')"),
        clear: z.boolean().optional().describe("Clear the field before typing (default: true)"),
        pressEnter: z.boolean().optional().describe("Press Enter after typing (default: false)"),
        timeout: z.number().optional().describe("Timeout in ms to wait for element (default: 5000)"),
      },
      async (args: any) => {
        return withSecurityCheck("browser_type", sessionName, async () => {
          const {
            selector,
            text,
            profile: profileName = "default",
            clear = true,
            pressEnter = false,
            timeout = 5000,
          } = args;
          try {
            const instance = await getOrCreateInstance(profileName);
            if (clear) {
              await instance.page.fill(selector, "", { timeout });
            }
            await instance.page.fill(selector, text, { timeout });
            if (pressEnter) {
              await instance.page.press(selector, "Enter");
            }
            await persistProfile(instance);
            return {
              content: [{ type: "text", text: `Typed into "${selector}"${pressEnter ? " and pressed Enter" : ""}` }],
            };
          } catch (err: any) {
            return { content: [{ type: "text", text: `Type failed: ${err.message}` }], isError: true };
          }
        });
      },
    ),
  );

  // -------------------------------------------------------------------------
  // browser_screenshot
  // -------------------------------------------------------------------------
  tools.push(
    tool(
      "browser_screenshot",
      "Take a screenshot of the current page. Returns base64-encoded PNG data and saves to a temp file.",
      {
        profile: z.string().optional().describe("Browser profile name (default: 'default')"),
        fullPage: z.boolean().optional().describe("Capture full scrollable page (default: false)"),
        selector: z.string().optional().describe("CSS selector to screenshot a specific element"),
      },
      async (args: any) => {
        return withSecurityCheck("browser_screenshot", sessionName, async () => {
          const { profile: profileName = "default", fullPage = false, selector } = args;
          try {
            const instance = await getOrCreateInstance(profileName);
            let buffer: Buffer;
            if (selector) {
              const element = await instance.page.$(selector);
              if (!element) {
                return { content: [{ type: "text", text: `Element not found: ${selector}` }], isError: true };
              }
              buffer = await element.screenshot({ type: "png" });
            } else {
              buffer = await instance.page.screenshot({ type: "png", fullPage });
            }

            const base64 = buffer.toString("base64");
            const tempPath = join(tmpdir(), `wopr-screenshot-${Date.now()}.png`);
            writeFileSync(tempPath, buffer);

            return {
              content: [
                { type: "text", text: `Screenshot saved to ${tempPath}` },
                { type: "image", data: base64, mimeType: "image/png" },
              ],
            };
          } catch (err: any) {
            return { content: [{ type: "text", text: `Screenshot failed: ${err.message}` }], isError: true };
          }
        });
      },
    ),
  );

  // -------------------------------------------------------------------------
  // browser_evaluate
  // -------------------------------------------------------------------------
  tools.push(
    tool(
      "browser_evaluate",
      "Execute JavaScript in the browser page context. The expression is evaluated in a sandboxed scope with no access to the host file system or Node.js APIs. Returns the serialized result.",
      {
        expression: z.string().describe("JavaScript expression to evaluate in the browser page"),
        profile: z.string().optional().describe("Browser profile name (default: 'default')"),
      },
      async (args: any) => {
        return withSecurityCheck("browser_evaluate", sessionName, async () => {
          const { expression, profile: profileName = "default" } = args;

          // Block obvious escape attempts.
          // Normalize: strip all whitespace and lowercase to defeat bypass tricks
          // like "f\netch(...)" or "FETCH(...)".
          const blocked = [
            "require(",
            "process.",
            "child_process",
            "__dirname",
            "__filename",
            "import(",
            "eval(",
            "function(",
            "fetch(",
            "xmlhttprequest",
          ];
          const normalized = expression.replace(/\s+/g, "").toLowerCase();
          for (const pattern of blocked) {
            if (normalized.includes(pattern.toLowerCase())) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Blocked: expression contains disallowed pattern "${pattern}". Browser evaluate runs in the browser context only.`,
                  },
                ],
                isError: true,
              };
            }
          }

          try {
            const instance = await getOrCreateInstance(profileName);
            const result = await instance.page.evaluate(expression);
            const serialized = JSON.stringify(result, null, 2) ?? "undefined";
            const truncated =
              serialized.length > MAX_EVALUATE_RESULT_LENGTH
                ? `${serialized.substring(0, MAX_EVALUATE_RESULT_LENGTH)}\n... (truncated, ${serialized.length} chars total)`
                : serialized;
            return {
              content: [{ type: "text", text: truncated }],
            };
          } catch (err: any) {
            return { content: [{ type: "text", text: `Evaluate failed: ${err.message}` }], isError: true };
          }
        });
      },
    ),
  );

  return tools;
}
