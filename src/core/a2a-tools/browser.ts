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
      await instance.browser.close();
    } catch (err) {
      logger.warn(`[browser] Error closing browser for profile "${name}": ${err}`);
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
        timeout: z.number().optional().describe("Navigation timeout in ms (default: 30000)"),
      },
      async (args: any) => {
        return withSecurityCheck("browser_navigate", sessionName, async () => {
          const { url, profile: profileName = "default", waitFor = "domcontentloaded", timeout = 30000 } = args;
          try {
            const instance = await getOrCreateInstance(profileName);
            await instance.page.goto(url, { waitUntil: waitFor, timeout });
            const title = await instance.page.title();
            const html = await instance.page.content();
            const markdown = htmlToMarkdown(html);
            const pageUrl = instance.page.url();
            await persistProfile(instance);

            const truncated = markdown.length > 15000 ? `${markdown.substring(0, 15000)}\n\n... (truncated)` : markdown;

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

          // Block obvious escape attempts
          const blocked = ["require(", "process.", "child_process", "__dirname", "__filename", "import("];
          const lower = expression.toLowerCase();
          for (const pattern of blocked) {
            if (lower.includes(pattern.toLowerCase())) {
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
              serialized.length > 10000 ? `${serialized.substring(0, 10000)}\n... (truncated)` : serialized;
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
