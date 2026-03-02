import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDependencyConfigs } from "./apply-dependency-configs.js";

const registry = [
  { id: "discord-channel", install: ["@wopr-network/plugin-discord"] },
  { id: "elevenlabs-tts", install: ["@wopr-network/plugin-tts"] },
  { id: "deepgram-stt", install: ["@wopr-network/plugin-stt"] },
];

const makeConfig = (pluginId: string, configJson: string) => ({
  id: "cfg-1",
  botId: "bot-1",
  pluginId,
  configJson,
  encryptedFieldsJson: null,
  setupSessionId: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});

describe("applyDependencyConfigs", () => {
  const mockFetchDependencies = vi.fn<() => Promise<string[]>>();
  const mockDispatchConfig = vi.fn<() => Promise<{ dispatched: boolean; dispatchError?: string }>>();
  const mockFindAllForBot = vi.fn<() => Promise<ReturnType<typeof makeConfig>[]>>();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies stored configs for each dependency that has one", async () => {
    mockFetchDependencies.mockResolvedValue(["@wopr-network/plugin-discord", "@wopr-network/plugin-tts"]);
    mockFindAllForBot.mockResolvedValue([makeConfig("discord-channel", '{"token":"abc"}')]);
    mockDispatchConfig.mockResolvedValue({ dispatched: true });

    const results = await applyDependencyConfigs({
      botId: "bot-1",
      superpowerPluginName: "meeting-transcriber",
      pluginRegistry: registry,
      fetchDependencies: mockFetchDependencies,
      dispatchConfig: mockDispatchConfig,
      findAllForBot: mockFindAllForBot,
    });

    expect(mockDispatchConfig).toHaveBeenCalledTimes(1);
    expect(mockDispatchConfig).toHaveBeenCalledWith("bot-1", "discord-channel", { token: "abc" });
    expect(results).toEqual([
      { pluginId: "discord-channel", dispatched: true },
      { pluginId: "elevenlabs-tts", skipped: true, reason: "no_stored_config" },
    ]);
  });

  it("returns empty array when no dependencies", async () => {
    mockFetchDependencies.mockResolvedValue([]);

    const results = await applyDependencyConfigs({
      botId: "bot-1",
      superpowerPluginName: "simple-plugin",
      pluginRegistry: registry,
      fetchDependencies: mockFetchDependencies,
      dispatchConfig: mockDispatchConfig,
      findAllForBot: mockFindAllForBot,
    });

    expect(results).toEqual([]);
    expect(mockFindAllForBot).not.toHaveBeenCalled();
  });

  it("skips dependencies not found in registry", async () => {
    mockFetchDependencies.mockResolvedValue(["@wopr-network/plugin-unknown"]);
    mockFindAllForBot.mockResolvedValue([]);

    const results = await applyDependencyConfigs({
      botId: "bot-1",
      superpowerPluginName: "plugin",
      pluginRegistry: registry,
      fetchDependencies: mockFetchDependencies,
      dispatchConfig: mockDispatchConfig,
      findAllForBot: mockFindAllForBot,
    });

    expect(results).toEqual([
      { pluginId: undefined, skipped: true, reason: "not_in_registry", npmPackage: "@wopr-network/plugin-unknown" },
    ]);
    expect(mockDispatchConfig).not.toHaveBeenCalled();
  });

  it("handles dispatch failure for one dep without stopping others", async () => {
    mockFetchDependencies.mockResolvedValue(["@wopr-network/plugin-discord", "@wopr-network/plugin-tts"]);
    mockFindAllForBot.mockResolvedValue([
      makeConfig("discord-channel", '{"token":"abc"}'),
      { ...makeConfig("elevenlabs-tts", '{"key":"xyz"}'), id: "cfg-2" },
    ]);
    mockDispatchConfig
      .mockResolvedValueOnce({ dispatched: false, dispatchError: "timeout" })
      .mockResolvedValueOnce({ dispatched: true });

    const results = await applyDependencyConfigs({
      botId: "bot-1",
      superpowerPluginName: "plugin",
      pluginRegistry: registry,
      fetchDependencies: mockFetchDependencies,
      dispatchConfig: mockDispatchConfig,
      findAllForBot: mockFindAllForBot,
    });

    expect(mockDispatchConfig).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { pluginId: "discord-channel", dispatched: false, dispatchError: "timeout" },
      { pluginId: "elevenlabs-tts", dispatched: true },
    ]);
  });
});
