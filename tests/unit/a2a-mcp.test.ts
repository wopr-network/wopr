import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: vi.fn().mockReturnValue({ type: "mcp-server" }),
  tool: vi.fn((...args: unknown[]) => ({ __tool: true, name: args[0] })),
}));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/core/config.js", () => ({
  config: {
    get: vi.fn().mockReturnValue({ agents: { a2a: { enabled: true } } }),
  },
}));

vi.mock("../../src/core/a2a-tools/index.js", () => ({
  cachedMcpServer: null,
  mcpServerDirty: true,
  pluginTools: new Map(),
  createSessionTools: vi.fn().mockReturnValue([]),
  createConfigTools: vi.fn().mockReturnValue([]),
  createIdentityTools: vi.fn().mockReturnValue([]),
  createEventTools: vi.fn().mockReturnValue([]),
  createSecurityTools: vi.fn().mockReturnValue([]),
  createCapabilityDiscoveryTools: vi.fn().mockReturnValue([]),
  setCachedServer: vi.fn(),
  setSessionFunctions: vi.fn(),
  registerA2ATool: vi.fn(),
  unregisterA2ATool: vi.fn(),
  withSecurityCheck: vi.fn(),
}));

import { listA2ATools, getA2AMcpServer, isA2AEnabled } from "../../src/core/a2a-mcp.js";
import { config } from "../../src/core/config.js";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
  createSessionTools,
  createConfigTools,
  createIdentityTools,
  createEventTools,
  createSecurityTools,
  createCapabilityDiscoveryTools,
  setCachedServer,
} from "../../src/core/a2a-tools/index.js";

describe("a2a-mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSdkMcpServer).mockReturnValue({ type: "mcp-server" } as any);
    vi.mocked(config.get).mockReturnValue({ agents: { a2a: { enabled: true } } } as any);
    vi.mocked(createSessionTools).mockReturnValue([]);
    vi.mocked(createConfigTools).mockReturnValue([]);
    vi.mocked(createIdentityTools).mockReturnValue([]);
    vi.mocked(createEventTools).mockReturnValue([]);
    vi.mocked(createSecurityTools).mockReturnValue([]);
    vi.mocked(createCapabilityDiscoveryTools).mockReturnValue([]);
  });

  describe("listA2ATools", () => {
    it("returns core tool names", () => {
      const tools = listA2ATools();
      expect(tools).toContain("sessions_list");
      expect(tools).toContain("sessions_send");
      expect(tools).toContain("config_get");
      expect(tools).toContain("security_whoami");
      expect(tools).toContain("capability_discover");
    });

    it("returns at least 24 core tools", () => {
      const tools = listA2ATools();
      expect(tools.length).toBeGreaterThanOrEqual(19);
    });

    it("includes session-related tools", () => {
      const tools = listA2ATools();
      expect(tools).toContain("sessions_history");
      expect(tools).toContain("sessions_spawn");
    });

    it("includes cron tools", () => {
      const tools = listA2ATools();
      expect(tools).toContain("cron_schedule");
      expect(tools).toContain("cron_once");
      expect(tools).toContain("cron_list");
      expect(tools).toContain("cron_cancel");
      expect(tools).toContain("cron_history");
    });

    it("includes identity, event, and security tools", () => {
      const tools = listA2ATools();
      expect(tools).toContain("identity_get");
      expect(tools).toContain("identity_update");
      expect(tools).toContain("security_check");
      expect(tools).toContain("event_emit");
      expect(tools).toContain("event_list");
    });
  });

  describe("getA2AMcpServer", () => {
    it("calls createSdkMcpServer with wopr-a2a name and version", () => {
      getA2AMcpServer("test-session");
      expect(createSdkMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({ name: "wopr-a2a", version: expect.any(String) }),
      );
    });

    it("calls all tool creator functions with session name", () => {
      getA2AMcpServer("my-session");
      expect(createSessionTools).toHaveBeenCalledWith("my-session");
      expect(createConfigTools).toHaveBeenCalledWith("my-session");
      expect(createIdentityTools).toHaveBeenCalledWith("my-session");
      expect(createEventTools).toHaveBeenCalledWith("my-session");
      expect(createSecurityTools).toHaveBeenCalledWith("my-session");
      expect(createCapabilityDiscoveryTools).toHaveBeenCalledWith("my-session");
    });

    it("caches the server via setCachedServer", () => {
      getA2AMcpServer("test");
      expect(setCachedServer).toHaveBeenCalled();
    });

    it("returns the result of createSdkMcpServer", () => {
      const fakeServer = { type: "mcp-server", id: "fake" };
      vi.mocked(createSdkMcpServer).mockReturnValue(fakeServer as any);
      const result = getA2AMcpServer("test-session");
      expect(result).toBe(fakeServer);
    });
  });

  describe("isA2AEnabled", () => {
    it("returns true when a2a.enabled is true", () => {
      vi.mocked(config.get).mockReturnValue({ agents: { a2a: { enabled: true } } } as any);
      expect(isA2AEnabled()).toBe(true);
    });

    it("returns false when a2a.enabled is explicitly false", () => {
      vi.mocked(config.get).mockReturnValue({ agents: { a2a: { enabled: false } } } as any);
      expect(isA2AEnabled()).toBe(false);
    });

    it("returns true when config throws (default enabled)", () => {
      vi.mocked(config.get).mockImplementation(() => {
        throw new Error("no config");
      });
      expect(isA2AEnabled()).toBe(true);
    });

    it("returns true when agents config is absent", () => {
      vi.mocked(config.get).mockReturnValue({} as any);
      expect(isA2AEnabled()).toBe(true);
    });
  });
});
