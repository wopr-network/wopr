import { describe, expect, it, vi } from "vitest";

// Mock logger
vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock child_process.spawn to avoid real Docker execution
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock the plugin extension system
vi.mock("../../src/plugins/extensions.js", () => ({
  getPluginExtension: vi.fn(() => undefined),
}));

// Mock the security context module
vi.mock("../../src/security/context.js", () => ({
  getContext: vi.fn(() => null),
}));

// We need access to the eventBus to simulate session:destroy
const { eventBus } = await import("../../src/core/events.js");

// Import the module under test — this registers the session:destroy listener
await import("../../src/security/sandbox.js");

describe("connectionTimestamps cleanup on session:destroy", () => {
  it("should register a session:destroy listener on the event bus", () => {
    // The sandbox module must register at least one session:destroy listener
    const count = eventBus.listenerCount("session:destroy");
    expect(count).toBeGreaterThan(0);
  });

  it("should not throw when session:destroy fires for unknown session", async () => {
    // Emitting for a session with no bridge and no timestamps entry must be a no-op
    await expect(
      eventBus.emit(
        "session:destroy",
        {
          session: "nonexistent-session-xyz",
          history: [],
          reason: "test",
        },
        "core",
      ),
    ).resolves.not.toThrow();
  });

  it("should not throw when session:destroy fires multiple times for the same session", async () => {
    const payload = {
      session: "repeated-session",
      history: [],
      reason: "test",
    };
    await eventBus.emit("session:destroy", payload, "core");
    await expect(
      eventBus.emit("session:destroy", payload, "core"),
    ).resolves.not.toThrow();
  });
});
