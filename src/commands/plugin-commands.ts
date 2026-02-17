/**
 * Try to handle a command via installed plugins.
 */

export async function tryPluginCommand(command: string, args: string[]): Promise<boolean> {
  if (!command) return false;

  const { getInstalledPlugins, loadPlugin, getLoadedPlugin } = await import("../plugins.js");
  const installed = (await getInstalledPlugins()).filter((p) => p.enabled);

  // First, load ALL enabled plugins to ensure providers/extensions are registered
  // This is necessary because provider plugins (TTS, STT) register during init
  const injectors = {
    inject: async () => "",
    getSessions: () => [],
  };

  for (const pluginInfo of installed) {
    try {
      await loadPlugin(pluginInfo, injectors, { skipRequirementsCheck: true, skipInit: true });
    } catch {
      // Plugin failed to load, continue with others
    }
  }

  // Now find and execute the command
  for (const pluginInfo of installed) {
    const loaded = getLoadedPlugin(pluginInfo.name);
    if (!loaded) continue;

    if (loaded.plugin.commands) {
      const cmd = loaded.plugin.commands.find((c) => c.name === command);
      if (cmd) {
        await cmd.handler(loaded.context, args);
        return true;
      }
    }
  }

  return false;
}
