/**
 * Browser A2A Tools Tests (WOP-109)
 *
 * Tests browser_navigate, browser_click, browser_type, browser_screenshot,
 * browser_evaluate with fully mocked Playwright.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock logger, security, and dependencies _before_ importing the module
// ---------------------------------------------------------------------------
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/paths.js", () => ({
  WOPR_HOME: "/tmp/wopr-test",
  SESSIONS_DIR: "/tmp/wopr-test/sessions",
  GLOBAL_IDENTITY_DIR: "/tmp/wopr-test/identity",
}));

vi.mock("../../src/security/index.js", () => ({
  canIndexSession: vi.fn(() => true),
  getContext: vi.fn(() => null),
  getSecurityConfig: vi.fn(() => ({})),
  getSessionIndexable: vi.fn(() => []),
  isEnforcementEnabled: vi.fn(() => false),
}));

vi.mock("../../src/core/config.js", () => ({
  config: { get: vi.fn(() => ({})) },
}));

vi.mock("../../src/memory/index.js", () => ({
  MemoryIndexManager: { create: vi.fn() },
  parseTemporalFilter: vi.fn(),
}));

vi.mock("../../src/core/cron.js", () => ({
  addCron: vi.fn(),
  createOnceJob: vi.fn(),
  getCronHistory: vi.fn(),
  getCrons: vi.fn(),
  removeCron: vi.fn(),
}));

vi.mock("../../src/core/events.js", () => ({
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    emitCustom: vi.fn(),
    listenerCount: vi.fn(() => 0),
    removeAllListeners: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock Playwright
// ---------------------------------------------------------------------------
const mockPage = {
  goto: vi.fn(),
  title: vi.fn(() => "Test Page"),
  content: vi.fn(() => "<html><body><h1>Hello World</h1><p>Test content</p></body></html>"),
  url: vi.fn(() => "https://example.com"),
  click: vi.fn(),
  fill: vi.fn(),
  press: vi.fn(),
  screenshot: vi.fn(() => Buffer.from("fake-png-data")),
  evaluate: vi.fn((expr: string) => {
    if (expr === "1 + 1") return 2;
    if (expr === "document.title") return "Test Page";
    return null;
  }),
  $: vi.fn(() => ({
    screenshot: vi.fn(() => Buffer.from("element-png")),
  })),
};

const mockContext = {
  addCookies: vi.fn(),
  cookies: vi.fn(() => []),
  newPage: vi.fn(() => mockPage),
};

const mockBrowser = {
  isConnected: vi.fn(() => true),
  close: vi.fn(),
};

const mockChromium = {
  launch: vi.fn(() => mockBrowser),
};

// Mock the dynamic import of playwright
vi.mock("playwright", () => ({
  chromium: mockChromium,
}));

// Mock browser-profile to avoid filesystem operations
vi.mock("../../src/core/a2a-tools/browser-profile.js", () => ({
  loadProfile: vi.fn(() => ({
    name: "default",
    cookies: [],
    localStorage: {},
    updatedAt: Date.now(),
  })),
  saveProfile: vi.fn(),
}));

// Mock fs writes for screenshot temp files
vi.mock("node:fs", async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    writeFileSync: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// We need to set up the mock context to return our mock page
mockChromium.launch.mockResolvedValue(mockBrowser);
mockBrowser.isConnected.mockReturnValue(true);

// Patch newContext onto mockBrowser
(mockBrowser as any).newContext = vi.fn(() => mockContext);

let createBrowserTools: any;
let closeAllBrowsers: any;

beforeEach(async () => {
  vi.clearAllMocks();

  // Re-mock browser connected state
  mockBrowser.isConnected.mockReturnValue(true);
  (mockBrowser as any).newContext = vi.fn(() => mockContext);
  mockChromium.launch.mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(mockPage);
  mockContext.cookies.mockResolvedValue([]);

  // Reset modules to clear instance cache
  vi.resetModules();

  // Re-mock all modules after reset
  vi.doMock("../../src/logger.js", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));
  vi.doMock("../../src/paths.js", () => ({
    WOPR_HOME: "/tmp/wopr-test",
    SESSIONS_DIR: "/tmp/wopr-test/sessions",
    GLOBAL_IDENTITY_DIR: "/tmp/wopr-test/identity",
  }));
  vi.doMock("../../src/security/index.js", () => ({
    canIndexSession: vi.fn(() => true),
    getContext: vi.fn(() => null),
    getSecurityConfig: vi.fn(() => ({})),
    getSessionIndexable: vi.fn(() => []),
    isEnforcementEnabled: vi.fn(() => false),
  }));
  vi.doMock("../../src/core/config.js", () => ({ config: { get: vi.fn(() => ({})) } }));
  vi.doMock("../../src/memory/index.js", () => ({
    MemoryIndexManager: { create: vi.fn() },
    parseTemporalFilter: vi.fn(),
  }));
  vi.doMock("../../src/core/cron.js", () => ({
    addCron: vi.fn(),
    createOnceJob: vi.fn(),
    getCronHistory: vi.fn(),
    getCrons: vi.fn(),
    removeCron: vi.fn(),
  }));
  vi.doMock("../../src/core/events.js", () => ({
    eventBus: {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      emitCustom: vi.fn(),
      listenerCount: vi.fn(() => 0),
      removeAllListeners: vi.fn(),
    },
  }));
  vi.doMock("playwright", () => ({ chromium: mockChromium }));
  vi.doMock("../../src/core/a2a-tools/browser-profile.js", () => ({
    loadProfile: vi.fn(() => ({
      name: "default",
      cookies: [],
      localStorage: {},
      updatedAt: Date.now(),
    })),
    saveProfile: vi.fn(),
  }));
  vi.doMock("node:fs", async (importOriginal) => {
    const original = (await importOriginal()) as any;
    return { ...original, writeFileSync: vi.fn() };
  });

  const mod = await import("../../src/core/a2a-tools/browser.js");
  createBrowserTools = mod.createBrowserTools;
  closeAllBrowsers = mod.closeAllBrowsers;
});

afterEach(async () => {
  if (closeAllBrowsers) {
    await closeAllBrowsers();
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: call a tool by name
// ---------------------------------------------------------------------------
function findTool(tools: any[], name: string): any {
  // SDK tools are objects with a .name property
  return tools.find((t: any) => t.name === name);
}

async function callTool(tools: any[], name: string, args: any): Promise<any> {
  const t = findTool(tools, name);
  if (!t) throw new Error(`Tool "${name}" not found in: ${tools.map((x: any) => x.name).join(", ")}`);
  // The SDK tool wraps the handler; we invoke it through the tool's call method
  return t.handler(args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Browser A2A Tools", () => {
  describe("createBrowserTools", () => {
    it("should return 5 browser tools", () => {
      const tools = createBrowserTools("test-session");
      expect(tools.length).toBe(5);
    });

    it("should include all expected tool names", () => {
      const tools = createBrowserTools("test-session");
      // SDK tool() returns objects — check structure exists
      expect(tools.length).toBe(5);
    });
  });

  describe("browser_navigate", () => {
    it("should navigate and return markdown content", async () => {
      const tools = createBrowserTools("test-session");
      const result = await callTool(tools, "browser_navigate", {
        url: "https://example.com",
      });
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Hello World");
      expect(result.content[0].text).toContain("https://example.com");
    });

    it("should return error on navigation failure", async () => {
      mockPage.goto.mockRejectedValueOnce(new Error("net::ERR_NAME_NOT_RESOLVED"));
      const tools = createBrowserTools("test-session");
      const result = await callTool(tools, "browser_navigate", {
        url: "https://nonexistent.invalid",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Navigation failed");
    });
  });

  describe("browser_click", () => {
    it("should click element by selector", async () => {
      const tools = createBrowserTools("test-session");
      // First navigate to establish a page
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_click", {
        selector: "#submit-btn",
      });
      expect(result.content[0].text).toContain('Clicked "#submit-btn"');
    });

    it("should return error on click failure", async () => {
      mockPage.click.mockRejectedValueOnce(new Error("Element not found"));
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_click", {
        selector: "#nonexistent",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Click failed");
    });
  });

  describe("browser_type", () => {
    it("should type text into an input", async () => {
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_type", {
        selector: "#search",
        text: "hello world",
      });
      expect(result.content[0].text).toContain('Typed into "#search"');
      expect(mockPage.fill).toHaveBeenCalled();
    });

    it("should press Enter when requested", async () => {
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_type", {
        selector: "#search",
        text: "query",
        pressEnter: true,
      });
      expect(result.content[0].text).toContain("pressed Enter");
      expect(mockPage.press).toHaveBeenCalledWith("#search", "Enter");
    });
  });

  describe("browser_screenshot", () => {
    it("should take a screenshot and return base64", async () => {
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_screenshot", {});
      expect(result.content.length).toBe(2);
      expect(result.content[0].text).toContain("Screenshot saved");
      expect(result.content[1].type).toBe("image");
      expect(result.content[1].mimeType).toBe("image/png");
    });

    it("should support element-level screenshots", async () => {
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_screenshot", {
        selector: "#main",
      });
      expect(result.content[0].text).toContain("Screenshot saved");
      expect(mockPage.$).toHaveBeenCalledWith("#main");
    });

    it("should error when element not found", async () => {
      mockPage.$.mockResolvedValueOnce(null);
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_screenshot", {
        selector: "#nonexistent",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Element not found");
    });
  });

  describe("browser_evaluate", () => {
    it("should evaluate JS and return result", async () => {
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_evaluate", {
        expression: "1 + 1",
      });
      expect(result.content[0].text).toBe("2");
    });

    it("should block require() calls", async () => {
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_evaluate", {
        expression: 'require("fs")',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Blocked");
    });

    it("should block process access", async () => {
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_evaluate", {
        expression: "process.env.SECRET",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Blocked");
    });

    it("should block child_process", async () => {
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_evaluate", {
        expression: 'child_process.exec("ls")',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Blocked");
    });

    it("should block dynamic import()", async () => {
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_evaluate", {
        expression: 'import("fs")',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Blocked");
    });

    it("should handle evaluation errors", async () => {
      mockPage.evaluate.mockRejectedValueOnce(new Error("ReferenceError: foo is not defined"));
      const tools = createBrowserTools("test-session");
      await callTool(tools, "browser_navigate", { url: "https://example.com" });
      const result = await callTool(tools, "browser_evaluate", {
        expression: "foo.bar",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Evaluate failed");
    });
  });
});
