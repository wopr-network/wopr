import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetInstalledPlugins = vi.fn();
const mockLoadPlugin = vi.fn();
const mockGetLoadedPlugin = vi.fn();

vi.mock("../../src/plugins.js", () => ({
  getInstalledPlugins: mockGetInstalledPlugins,
  loadPlugin: mockLoadPlugin,
  getLoadedPlugin: mockGetLoadedPlugin,
}));

const { tryPluginCommand } = await import("../../src/commands/plugin-commands.js");

describe("tryPluginCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for empty command string", async () => {
    expect(await tryPluginCommand("", [])).toBe(false);
    expect(mockGetInstalledPlugins).not.toHaveBeenCalled();
  });

  it("returns false when no plugins installed", async () => {
    mockGetInstalledPlugins.mockResolvedValue([]);
    expect(await tryPluginCommand("test", [])).toBe(false);
  });

  it("skips disabled plugins", async () => {
    mockGetInstalledPlugins.mockResolvedValue([{ name: "p1", enabled: false }]);
    expect(await tryPluginCommand("test", [])).toBe(false);
    expect(mockLoadPlugin).not.toHaveBeenCalled();
  });

  it("loads all enabled plugins before searching commands", async () => {
    const plugins = [
      { name: "p1", enabled: true },
      { name: "p2", enabled: true },
    ];
    mockGetInstalledPlugins.mockResolvedValue(plugins);
    mockGetLoadedPlugin.mockReturnValue(undefined);

    await tryPluginCommand("test", []);

    expect(mockLoadPlugin).toHaveBeenCalledTimes(2);
    expect(mockLoadPlugin).toHaveBeenCalledWith(plugins[0], expect.any(Object), {
      skipRequirementsCheck: true,
      skipInit: true,
    });
  });

  it("continues loading when one plugin fails to load", async () => {
    const plugins = [
      { name: "p1", enabled: true },
      { name: "p2", enabled: true },
    ];
    mockGetInstalledPlugins.mockResolvedValue(plugins);
    mockLoadPlugin.mockRejectedValueOnce(new Error("fail")).mockResolvedValueOnce(undefined);
    mockGetLoadedPlugin.mockReturnValue(undefined);

    await tryPluginCommand("test", []);

    expect(mockLoadPlugin).toHaveBeenCalledTimes(2);
  });

  it("returns true and calls handler on matching command", async () => {
    const handler = vi.fn();
    const plugins = [{ name: "p1", enabled: true }];
    mockGetInstalledPlugins.mockResolvedValue(plugins);
    mockGetLoadedPlugin.mockReturnValue({
      plugin: { commands: [{ name: "greet", handler }] },
      context: { fake: true },
    });

    const result = await tryPluginCommand("greet", ["arg1"]);

    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledWith({ fake: true }, ["arg1"]);
  });

  it("returns false when plugin has no commands array", async () => {
    const plugins = [{ name: "p1", enabled: true }];
    mockGetInstalledPlugins.mockResolvedValue(plugins);
    mockGetLoadedPlugin.mockReturnValue({ plugin: {}, context: {} });

    expect(await tryPluginCommand("test", [])).toBe(false);
  });

  it("finds command in second plugin when first has none", async () => {
    const handler = vi.fn();
    const plugins = [
      { name: "p1", enabled: true },
      { name: "p2", enabled: true },
    ];
    mockGetInstalledPlugins.mockResolvedValue(plugins);
    mockGetLoadedPlugin
      .mockReturnValueOnce({ plugin: { commands: [] }, context: {} })
      .mockReturnValueOnce({
        plugin: { commands: [{ name: "hello", handler }] },
        context: { id: 2 },
      });

    const result = await tryPluginCommand("hello", []);

    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledWith({ id: 2 }, []);
  });
});
