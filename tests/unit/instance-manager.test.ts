/**
 * InstanceManager Tests (WOP-198)
 *
 * All dockerode calls are mocked — no real Docker daemon required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// We mock the docker-client module so InstanceManager never touches a real daemon.
const mockInspect = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockRemove = vi.fn();
const mockLogs = vi.fn();
const mockCreateContainer = vi.fn();
const mockListContainers = vi.fn();
const mockNetworkInspect = vi.fn();
const mockCreateNetwork = vi.fn();
const mockImageInspect = vi.fn();
const mockPull = vi.fn();
const mockFollowProgress = vi.fn();

const fakeContainer = {
  id: "abc123def456",
  inspect: mockInspect,
  start: mockStart,
  stop: mockStop,
  remove: mockRemove,
  logs: mockLogs,
};

const fakeDocker = {
  getContainer: vi.fn(() => fakeContainer),
  createContainer: mockCreateContainer,
  listContainers: mockListContainers,
  getNetwork: vi.fn(() => ({ inspect: mockNetworkInspect })),
  createNetwork: mockCreateNetwork,
  getImage: vi.fn(() => ({ inspect: mockImageInspect })),
  pull: mockPull,
  modem: { followProgress: mockFollowProgress },
};

vi.mock("../../src/platform/docker-client.js", () => ({
  getDocker: () => fakeDocker,
  ensureNetwork: vi.fn(async () => {}),
  ensureImage: vi.fn(async () => {}),
  dockerCall: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}));

// ---------------------------------------------------------------------------
// Import under test (must come after mocks)
// ---------------------------------------------------------------------------
const { InstanceManager } = await import("../../src/platform/instance-manager.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultConfig() {
  return {
    id: "test-1",
    image: "wopr:latest",
    env: { ANTHROPIC_API_KEY: "sk-ant-test" },
    hostPort: 8080,
    healthCheck: true,
  };
}

function makeInspectData(overrides: Record<string, unknown> = {}) {
  return {
    Id: "abc123def456",
    State: {
      Status: "running",
      StartedAt: new Date(Date.now() - 60_000).toISOString(),
      Health: { Status: "healthy" },
      ...((overrides.State as Record<string, unknown>) ?? {}),
    },
    Config: {
      Image: "wopr:latest",
      ...((overrides.Config as Record<string, unknown>) ?? {}),
    },
    NetworkSettings: {
      Ports: {
        "7437/tcp": [{ HostPort: "8080" }],
      },
      ...((overrides.NetworkSettings as Record<string, unknown>) ?? {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InstanceManager", () => {
  let mgr: InstanceType<typeof InstanceManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new InstanceManager();
    mockCreateContainer.mockResolvedValue(fakeContainer);
    mockStart.mockResolvedValue(undefined);
    mockStop.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    mockInspect.mockResolvedValue(makeInspectData());
    mockLogs.mockResolvedValue(Buffer.from("log line 1\nlog line 2\n"));
    mockListContainers.mockResolvedValue([]);
  });

  // ---------- create ----------
  describe("create", () => {
    it("creates a container with correct name and returns id", async () => {
      const id = await mgr.create(defaultConfig());
      expect(id).toBe("abc123def456");
      expect(mockCreateContainer).toHaveBeenCalledOnce();

      const call = mockCreateContainer.mock.calls[0][0];
      expect(call.name).toBe("wopr-test-1");
      expect(call.Image).toBe("wopr:latest");
      expect(call.Labels["wopr.managed"]).toBe("true");
      expect(call.Labels["wopr.instance"]).toBe("test-1");
    });

    it("passes environment variables including WOPR_HOME", async () => {
      await mgr.create(defaultConfig());
      const call = mockCreateContainer.mock.calls[0][0];
      expect(call.Env).toContain("ANTHROPIC_API_KEY=sk-ant-test");
      expect(call.Env).toContain("WOPR_HOME=/data/wopr");
    });

    it("configures port mapping for daemon port", async () => {
      await mgr.create(defaultConfig());
      const call = mockCreateContainer.mock.calls[0][0];
      expect(call.ExposedPorts).toHaveProperty("7437/tcp");
      expect(call.HostConfig.PortBindings["7437/tcp"]).toEqual([
        { HostPort: "8080" },
      ]);
    });

    it("auto-assigns port when hostPort is omitted", async () => {
      const cfg = { ...defaultConfig(), hostPort: undefined };
      await mgr.create(cfg);
      const call = mockCreateContainer.mock.calls[0][0];
      expect(call.HostConfig.PortBindings["7437/tcp"]).toEqual([
        { HostPort: "" },
      ]);
    });

    it("sets resource limits when provided", async () => {
      const cfg = { ...defaultConfig(), resources: { cpus: 2, memory: "1g" } };
      await mgr.create(cfg);
      const call = mockCreateContainer.mock.calls[0][0];
      expect(call.HostConfig.NanoCpus).toBe(2e9);
      expect(call.HostConfig.Memory).toBe(1024 ** 3);
    });

    it("includes HEALTHCHECK when healthCheck is true", async () => {
      await mgr.create(defaultConfig());
      const call = mockCreateContainer.mock.calls[0][0];
      expect(call.Healthcheck).toBeDefined();
      expect(call.Healthcheck.Test[0]).toBe("CMD-SHELL");
    });

    it("omits HEALTHCHECK when healthCheck is false", async () => {
      const cfg = { ...defaultConfig(), healthCheck: false };
      await mgr.create(cfg);
      const call = mockCreateContainer.mock.calls[0][0];
      expect(call.Healthcheck).toBeUndefined();
    });

    it("connects container to wopr-network", async () => {
      await mgr.create(defaultConfig());
      const call = mockCreateContainer.mock.calls[0][0];
      expect(call.HostConfig.NetworkMode).toBe("wopr-network");
    });
  });

  // ---------- start ----------
  describe("start", () => {
    it("calls container.start()", async () => {
      await mgr.start("test-1");
      expect(fakeDocker.getContainer).toHaveBeenCalledWith("wopr-test-1");
      expect(mockStart).toHaveBeenCalledOnce();
    });
  });

  // ---------- stop ----------
  describe("stop", () => {
    it("calls container.stop() with default timeout", async () => {
      await mgr.stop("test-1");
      expect(mockStop).toHaveBeenCalledWith({ t: 10 });
    });

    it("accepts custom timeout", async () => {
      await mgr.stop("test-1", 30);
      expect(mockStop).toHaveBeenCalledWith({ t: 30 });
    });
  });

  // ---------- restart ----------
  describe("restart", () => {
    it("stops then starts the container", async () => {
      await mgr.restart("test-1");
      expect(mockStop).toHaveBeenCalledOnce();
      expect(mockStart).toHaveBeenCalledOnce();
    });

    it("attempts start even if stop fails (rollback)", async () => {
      mockStop.mockRejectedValueOnce(new Error("already stopped"));
      await mgr.restart("test-1");
      expect(mockStart).toHaveBeenCalledOnce();
    });
  });

  // ---------- destroy ----------
  describe("destroy", () => {
    it("stops and removes the container", async () => {
      await mgr.destroy("test-1");
      expect(mockStop).toHaveBeenCalledWith({ t: 5 });
      expect(mockRemove).toHaveBeenCalledWith({ v: false });
    });

    it("removes volumes when requested", async () => {
      await mgr.destroy("test-1", { removeVolumes: true });
      expect(mockRemove).toHaveBeenCalledWith({ v: true });
    });

    it("still removes even if stop throws (container already stopped)", async () => {
      mockStop.mockRejectedValueOnce(new Error("not running"));
      await mgr.destroy("test-1");
      expect(mockRemove).toHaveBeenCalledOnce();
    });
  });

  // ---------- status ----------
  describe("status", () => {
    it("returns structured status from inspect data", async () => {
      const s = await mgr.status("test-1");
      expect(s.id).toBe("test-1");
      expect(s.containerName).toBe("wopr-test-1");
      expect(s.state).toBe("running");
      expect(s.health).toBe("healthy");
      expect(s.uptime).toBeGreaterThan(0);
      expect(s.image).toBe("wopr:latest");
      expect(s.ports).toEqual([
        { container: 7437, host: 8080, protocol: "tcp" },
      ]);
    });

    it("returns null uptime when not running", async () => {
      mockInspect.mockResolvedValueOnce(
        makeInspectData({ State: { Status: "exited", StartedAt: null, Health: { Status: "none" } } }),
      );
      const s = await mgr.status("test-1");
      expect(s.state).toBe("exited");
      expect(s.uptime).toBeNull();
    });
  });

  // ---------- list ----------
  describe("list", () => {
    it("returns empty array when no containers", async () => {
      const result = await mgr.list();
      expect(result).toEqual([]);
    });

    it("maps container list to InstanceListEntry", async () => {
      mockListContainers.mockResolvedValueOnce([
        {
          Names: ["/wopr-abc"],
          State: "running",
          Image: "wopr:latest",
          Labels: { "wopr.managed": "true", "wopr.instance": "abc" },
        },
        {
          Names: ["/wopr-def"],
          State: "exited",
          Image: "wopr:0.9",
          Labels: { "wopr.managed": "true", "wopr.instance": "def" },
        },
      ]);

      const result = await mgr.list();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "abc",
        containerName: "wopr-abc",
        state: "running",
        image: "wopr:latest",
      });
      expect(result[1]).toEqual({
        id: "def",
        containerName: "wopr-def",
        state: "exited",
        image: "wopr:0.9",
      });
    });

    it("filters only wopr.managed containers", async () => {
      await mgr.list();
      expect(mockListContainers).toHaveBeenCalledWith({
        all: true,
        filters: { label: ["wopr.managed=true"] },
      });
    });
  });

  // ---------- logs ----------
  describe("logs", () => {
    it("returns logs as string (buffer mode)", async () => {
      const output = await mgr.logs("test-1");
      expect(output).toBe("log line 1\nlog line 2\n");
    });

    it("passes tail and timestamps options", async () => {
      await mgr.logs("test-1", { tail: 50, timestamps: true });
      expect(mockLogs).toHaveBeenCalledWith(
        expect.objectContaining({ tail: 50, timestamps: true }),
      );
    });

    it("handles string return from dockerode", async () => {
      mockLogs.mockResolvedValueOnce("string logs");
      const output = await mgr.logs("test-1");
      expect(output).toBe("string logs");
    });
  });
});
