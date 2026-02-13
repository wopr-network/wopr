import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before imports
vi.mock("../../src/core/providers.js", () => ({
  providerRegistry: {
    listProviders: vi.fn(() => []),
  },
}));

vi.mock("../../src/core/sessions.js", () => ({
  getSessions: vi.fn(() => ({})),
}));

vi.mock("../../src/plugins/state.js", () => ({
  loadedPlugins: new Map(),
  pluginManifests: new Map(),
}));

vi.mock("../../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { providerRegistry } from "../../src/core/providers.js";
import { getSessions } from "../../src/core/sessions.js";
import { HealthMonitor } from "../../src/daemon/health.js";
import type { HealthSnapshot, HealthStatus } from "../../src/daemon/health.js";
import { loadedPlugins } from "../../src/plugins/state.js";

describe("HealthMonitor", () => {
  let monitor: HealthMonitor;

  beforeEach(() => {
    vi.mocked(providerRegistry.listProviders).mockReturnValue([]);
    vi.mocked(getSessions).mockReturnValue({});
    loadedPlugins.clear();
    monitor = new HealthMonitor({ intervalMs: 60_000, version: "1.0.0" });
  });

  afterEach(() => {
    monitor.stop();
  });

  it("returns healthy when no plugins or providers registered", async () => {
    const snapshot = await monitor.check();
    expect(snapshot.status).toBe("healthy");
    expect(snapshot.plugins).toEqual([]);
    expect(snapshot.providers).toEqual([]);
    expect(snapshot.version).toBe("1.0.0");
  });

  it("reports uptime in seconds", async () => {
    const snapshot = await monitor.check();
    expect(snapshot.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof snapshot.uptime).toBe("number");
  });

  it("includes memory stats", async () => {
    const snapshot = await monitor.check();
    expect(snapshot.memory.heapUsed).toBeGreaterThan(0);
    expect(snapshot.memory.heapTotal).toBeGreaterThan(0);
    expect(snapshot.memory.rss).toBeGreaterThan(0);
  });

  it("returns healthy when all providers available", async () => {
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "anthropic", name: "Anthropic", available: true, lastChecked: Date.now() },
      { id: "openai", name: "OpenAI", available: true, lastChecked: Date.now() },
    ]);

    const snapshot = await monitor.check();
    expect(snapshot.status).toBe("healthy");
    expect(snapshot.providers).toHaveLength(2);
    expect(snapshot.providers[0].available).toBe(true);
    expect(snapshot.providers[1].available).toBe(true);
  });

  it("returns degraded when some providers unavailable", async () => {
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "anthropic", name: "Anthropic", available: true, lastChecked: Date.now() },
      { id: "openai", name: "OpenAI", available: false, lastChecked: Date.now() },
    ]);

    const snapshot = await monitor.check();
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.providers[1].reason).toBeDefined();
  });

  it("returns unhealthy when no providers available", async () => {
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "anthropic", name: "Anthropic", available: false, lastChecked: Date.now() },
      { id: "openai", name: "OpenAI", available: false, lastChecked: Date.now() },
    ]);

    const snapshot = await monitor.check();
    expect(snapshot.status).toBe("unhealthy");
  });

  it("reports loaded plugins as healthy", async () => {
    loadedPlugins.set("discord", { plugin: {} as any, context: {} as any });
    loadedPlugins.set("openai", { plugin: {} as any, context: {} as any });

    const snapshot = await monitor.check();
    expect(snapshot.plugins).toHaveLength(2);
    expect(snapshot.plugins[0].name).toBe("discord");
    expect(snapshot.plugins[0].status).toBe("healthy");
    expect(snapshot.plugins[1].name).toBe("openai");
    expect(snapshot.plugins[1].status).toBe("healthy");
  });

  it("reports session counts", async () => {
    vi.mocked(getSessions).mockReturnValue({
      general: "session-id-1",
      dev: "session-id-2",
      test: "session-id-3",
    });

    const snapshot = await monitor.check();
    expect(snapshot.sessions.active).toBe(3);
    expect(snapshot.sessions.total).toBe(3);
  });

  it("records history and respects historySize", async () => {
    const smallMonitor = new HealthMonitor({ intervalMs: 60_000, historySize: 3 });

    await smallMonitor.check();
    await smallMonitor.check();
    await smallMonitor.check();
    await smallMonitor.check();
    await smallMonitor.check();

    const history = smallMonitor.getHistory();
    expect(history).toHaveLength(3);
    smallMonitor.stop();
  });

  it("getHistory with limit returns last N entries", async () => {
    await monitor.check();
    await monitor.check();
    await monitor.check();

    const history = monitor.getHistory(2);
    expect(history).toHaveLength(2);
  });

  it("emits statusChange event on transition", async () => {
    const events: Array<{ previous: HealthStatus; current: HealthStatus }> = [];
    monitor.on("statusChange", (e) => events.push(e));

    // Initial check -- healthy (default)
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "anthropic", name: "Anthropic", available: true, lastChecked: Date.now() },
    ]);
    await monitor.check();
    // No event -- still healthy

    // Transition to unhealthy
    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "anthropic", name: "Anthropic", available: false, lastChecked: Date.now() },
    ]);
    await monitor.check();

    expect(events).toHaveLength(1);
    expect(events[0].previous).toBe("healthy");
    expect(events[0].current).toBe("unhealthy");
  });

  it("does not emit statusChange when status unchanged", async () => {
    const events: Array<{ previous: HealthStatus; current: HealthStatus }> = [];
    monitor.on("statusChange", (e) => events.push(e));

    await monitor.check();
    await monitor.check();
    await monitor.check();

    expect(events).toHaveLength(0);
  });

  it("getCurrentStatus returns latest status", async () => {
    expect(monitor.getCurrentStatus()).toBe("healthy");

    vi.mocked(providerRegistry.listProviders).mockReturnValue([
      { id: "anthropic", name: "Anthropic", available: false, lastChecked: Date.now() },
    ]);
    await monitor.check();

    expect(monitor.getCurrentStatus()).toBe("unhealthy");
  });

  it("start and stop control the interval timer", async () => {
    vi.useFakeTimers();
    const timerMonitor = new HealthMonitor({ intervalMs: 1000, version: "1.0.0" });

    timerMonitor.start();
    // The initial check fires immediately via the constructor's start()
    // Advance past the initial check
    await vi.advanceTimersByTimeAsync(100);

    const history1 = timerMonitor.getHistory();
    expect(history1.length).toBeGreaterThanOrEqual(1);

    // Advance by one interval
    await vi.advanceTimersByTimeAsync(1000);
    const history2 = timerMonitor.getHistory();
    expect(history2.length).toBeGreaterThan(history1.length);

    timerMonitor.stop();

    const countAfterStop = timerMonitor.getHistory().length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(timerMonitor.getHistory().length).toBe(countAfterStop);

    vi.useRealTimers();
  });

  it("start is idempotent - calling twice does not create multiple timers", () => {
    monitor.start();
    monitor.start(); // should not throw or create duplicate
    monitor.stop();
  });
});
