import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetManager } from "../../src/daemon/fleet/fleet-manager.js";
import type { BotProfile } from "../../src/daemon/fleet/types.js";

/** Build a mock BotProfile for testing */
function makeProfile(overrides: Partial<BotProfile> = {}): BotProfile {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    name: "test-bot",
    image: "ghcr.io/wopr-network/wopr",
    releaseChannel: "stable",
    env: { DISCORD_TOKEN: "test-token" },
    restartPolicy: "unless-stopped",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Create a mock Docker instance with controllable behavior */
function createMockDocker() {
  const mockContainer = {
    id: "container-id-123",
    inspect: vi.fn().mockResolvedValue({
      Id: "container-id-123",
      State: {
        Status: "running",
        StartedAt: new Date(Date.now() - 60_000).toISOString(),
        Health: { Status: "healthy" },
      },
    }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    logs: vi.fn().mockResolvedValue(Buffer.alloc(0)),
  };

  const docker = {
    listContainers: vi.fn().mockResolvedValue([]),
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    getContainer: vi.fn().mockReturnValue(mockContainer),
    pull: vi.fn().mockResolvedValue("stream"),
    modem: {
      followProgress: vi.fn((_stream: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      }),
    },
  };

  return { docker, mockContainer };
}

describe("FleetManager", () => {
  describe("create", () => {
    it("pulls image and creates a container", async () => {
      const { docker, mockContainer } = createMockDocker();
      const fm = new FleetManager(docker as any);
      const profile = makeProfile();

      const containerId = await fm.create(profile);

      expect(docker.pull).toHaveBeenCalledWith("ghcr.io/wopr-network/wopr:stable");
      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: `wopr-bot-${profile.id}`,
          Image: "ghcr.io/wopr-network/wopr:stable",
          Env: ["DISCORD_TOKEN=test-token"],
        }),
      );
      expect(containerId).toBe(mockContainer.id);
    });

    it("returns existing container ID if one already exists", async () => {
      const { docker, mockContainer } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "existing-container-456" }]);
      docker.getContainer.mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ Id: "existing-container-456" }),
      });

      const fm = new FleetManager(docker as any);
      const profile = makeProfile();

      const containerId = await fm.create(profile);

      expect(containerId).toBe("existing-container-456");
      expect(docker.pull).not.toHaveBeenCalled();
      expect(docker.createContainer).not.toHaveBeenCalled();
    });

    it("sets restart policy from profile", async () => {
      const { docker } = createMockDocker();
      const fm = new FleetManager(docker as any);
      const profile = makeProfile({ restartPolicy: "always" });

      await fm.create(profile);

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            RestartPolicy: { Name: "always" },
          }),
        }),
      );
    });

    it("mounts named volume when specified", async () => {
      const { docker } = createMockDocker();
      const fm = new FleetManager(docker as any);
      const profile = makeProfile({ volume: "my-data-vol" });

      await fm.create(profile);

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Binds: ["my-data-vol:/data"],
          }),
        }),
      );
    });

    it("sets healthcheck when specified", async () => {
      const { docker } = createMockDocker();
      const fm = new FleetManager(docker as any);
      const profile = makeProfile({
        healthcheck: {
          test: ["CMD", "curl", "-f", "http://localhost:7437/health"],
          interval: 30000,
          timeout: 5000,
          retries: 3,
        },
      });

      await fm.create(profile);

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Healthcheck: expect.objectContaining({
            Test: ["CMD", "curl", "-f", "http://localhost:7437/health"],
            Retries: 3,
          }),
        }),
      );
    });

    it("sets fleet management labels", async () => {
      const { docker } = createMockDocker();
      const fm = new FleetManager(docker as any);
      const profile = makeProfile();

      await fm.create(profile);

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Labels: expect.objectContaining({
            "wopr.fleet.managed": "true",
            "wopr.fleet.profile-id": profile.id,
            "wopr.fleet.name": profile.name,
          }),
        }),
      );
    });
  });

  describe("start", () => {
    it("starts the container for a profile", async () => {
      const { docker, mockContainer } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "container-id-123" }]);

      const fm = new FleetManager(docker as any);
      await fm.start("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

      expect(mockContainer.start).toHaveBeenCalled();
    });

    it("throws when no container exists", async () => {
      const { docker } = createMockDocker();
      const fm = new FleetManager(docker as any);

      await expect(fm.start("nonexistent")).rejects.toThrow("No container found");
    });
  });

  describe("stop", () => {
    it("stops the container for a profile", async () => {
      const { docker, mockContainer } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "container-id-123" }]);

      const fm = new FleetManager(docker as any);
      await fm.stop("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

      expect(mockContainer.stop).toHaveBeenCalled();
    });

    it("throws when no container exists", async () => {
      const { docker } = createMockDocker();
      const fm = new FleetManager(docker as any);

      await expect(fm.stop("nonexistent")).rejects.toThrow("No container found");
    });
  });

  describe("restart", () => {
    it("restarts the container for a profile", async () => {
      const { docker, mockContainer } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "container-id-123" }]);

      const fm = new FleetManager(docker as any);
      await fm.restart("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

      expect(mockContainer.restart).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("stops and removes the container", async () => {
      const { docker, mockContainer } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "container-id-123" }]);

      const fm = new FleetManager(docker as any);
      await fm.remove("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

      expect(mockContainer.stop).toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalledWith({ v: false });
    });

    it("removes with volumes when requested", async () => {
      const { docker, mockContainer } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "container-id-123" }]);

      const fm = new FleetManager(docker as any);
      await fm.remove("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", true);

      expect(mockContainer.remove).toHaveBeenCalledWith({ v: true });
    });

    it("does not throw if container does not exist", async () => {
      const { docker } = createMockDocker();
      const fm = new FleetManager(docker as any);

      await expect(fm.remove("nonexistent")).resolves.toBeUndefined();
    });

    it("handles already-stopped container gracefully", async () => {
      const { docker, mockContainer } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "container-id-123" }]);
      mockContainer.stop.mockRejectedValue(new Error("container already stopped"));

      const fm = new FleetManager(docker as any);
      await expect(fm.remove("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).resolves.toBeUndefined();
      expect(mockContainer.remove).toHaveBeenCalled();
    });
  });

  describe("status", () => {
    it("returns running status with uptime", async () => {
      const { docker } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "container-id-123" }]);

      const fm = new FleetManager(docker as any);
      const profile = makeProfile();
      const status = await fm.status(profile);

      expect(status.containerId).toBe("container-id-123");
      expect(status.state).toBe("running");
      expect(status.health).toBe("healthy");
      expect(status.uptimeSeconds).toBeGreaterThan(0);
      expect(status.startedAt).toBeTruthy();
      expect(status.profile).toBe(profile);
    });

    it("returns unknown state when no container exists", async () => {
      const { docker } = createMockDocker();
      const fm = new FleetManager(docker as any);
      const profile = makeProfile();
      const status = await fm.status(profile);

      expect(status.containerId).toBeNull();
      expect(status.state).toBe("unknown");
      expect(status.health).toBe("unknown");
      expect(status.uptimeSeconds).toBe(0);
    });

    it("returns none health when container has no healthcheck", async () => {
      const { docker, mockContainer } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "container-id-123" }]);
      mockContainer.inspect.mockResolvedValue({
        Id: "container-id-123",
        State: {
          Status: "running",
          StartedAt: new Date().toISOString(),
        },
      });

      const fm = new FleetManager(docker as any);
      const status = await fm.status(makeProfile());

      expect(status.health).toBe("none");
    });
  });

  describe("logs", () => {
    it("retrieves container logs with tail", async () => {
      const { docker, mockContainer } = createMockDocker();
      docker.listContainers.mockResolvedValue([{ Id: "container-id-123" }]);

      // Build a Docker multiplexed stream frame
      const payload = Buffer.from("2026-01-01T00:00:00Z hello world\n");
      const header = Buffer.alloc(8);
      header.writeUInt8(1, 0); // stdout
      header.writeUInt32BE(payload.length, 4);
      mockContainer.logs.mockResolvedValue(Buffer.concat([header, payload]));

      const fm = new FleetManager(docker as any);
      const logs = await fm.logs("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", 50);

      expect(mockContainer.logs).toHaveBeenCalledWith({
        stdout: true,
        stderr: true,
        tail: 50,
        timestamps: true,
      });
      expect(logs).toContain("hello world");
    });

    it("throws when no container exists", async () => {
      const { docker } = createMockDocker();
      const fm = new FleetManager(docker as any);

      await expect(fm.logs("nonexistent")).rejects.toThrow("No container found");
    });
  });
});
