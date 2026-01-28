import { Component, createSignal, onMount, For } from "solid-js";
import { api, type WoprConfig } from "../lib/api";

const Settings: Component = () => {
  const [config, setConfig] = createSignal<WoprConfig | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [message, setMessage] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const cfg = await api.getConfig();
      setConfig(cfg);
    } catch (err) {
      console.error("Failed to load config:", err);
      setMessage("Failed to load config");
    }
  });

  async function handleSave() {
    const cfg = config();
    if (!cfg) return;

    setSaving(true);
    setMessage(null);

    try {
      // Save each section
      await api.setConfigValue("daemon", cfg.daemon);
      await api.setConfigValue("anthropic", cfg.anthropic);
      await api.setConfigValue("oauth", cfg.oauth);
      if (cfg.discord) await api.setConfigValue("discord", cfg.discord);
      await api.setConfigValue("discovery", cfg.discovery);
      await api.setConfigValue("plugins", cfg.plugins);

      setMessage("Configuration saved!");
      setTimeout(() => setMessage(null), 3000);
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm("Reset all configuration to defaults?")) return;

    setSaving(true);
    try {
      await api.resetConfig();
      const cfg = await api.getConfig();
      setConfig(cfg);
      setMessage("Configuration reset to defaults");
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="max-w-4xl mx-auto p-6">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold text-wopr-accent">Settings</h1>
        <div class="flex gap-2">
          <button
            onClick={handleReset}
            disabled={saving() || !config()}
            class="px-4 py-2 bg-wopr-border text-wopr-text rounded hover:bg-wopr-muted disabled:opacity-50"
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving() || !config()}
            class="px-4 py-2 bg-wopr-accent text-wopr-bg rounded font-semibold hover:bg-wopr-accent/90 disabled:opacity-50"
          >
            {saving() ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {message() && (
        <div class={`mb-4 p-3 rounded ${message()?.startsWith("Error") ? "bg-red-500/20 text-red-500" : "bg-green-500/20 text-green-500"}`}>
          {message()}
        </div>
      )}

      {config() ? (
        <div class="space-y-6">
          {/* Daemon Settings */}
          <section class="bg-wopr-panel border border-wopr-border rounded-lg p-4">
            <h2 class="text-lg font-semibold text-wopr-accent mb-4">Daemon</h2>
            <div class="space-y-3">
              <div>
                <label class="block text-sm text-wopr-muted mb-1">Port</label>
                <input
                  type="number"
                  value={config()!.daemon.port}
                  onInput={(e) => setConfig({ ...config()!, daemon: { ...config()!.daemon, port: parseInt(e.currentTarget.value) || 7437 } })}
                  class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                />
              </div>
              <div>
                <label class="block text-sm text-wopr-muted mb-1">Host</label>
                <input
                  type="text"
                  value={config()!.daemon.host}
                  onInput={(e) => setConfig({ ...config()!, daemon: { ...config()!.daemon, host: e.currentTarget.value } })}
                  class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                />
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config()!.daemon.autoStart}
                  onChange={(e) => setConfig({ ...config()!, daemon: { ...config()!.daemon, autoStart: e.currentTarget.checked } })}
                  class="rounded border-wopr-border"
                />
                <label class="text-sm text-wopr-text">Auto-start daemon on boot</label>
              </div>
            </div>
          </section>

          {/* Anthropic */}
          <section class="bg-wopr-panel border border-wopr-border rounded-lg p-4">
            <h2 class="text-lg font-semibold text-wopr-accent mb-4">Anthropic</h2>
            <div>
              <label class="block text-sm text-wopr-muted mb-1">API Key</label>
              <input
                type="password"
                value={config()!.anthropic.apiKey || ""}
                onInput={(e) => setConfig({ ...config()!, anthropic: { ...config()!.anthropic, apiKey: e.currentTarget.value } })}
                placeholder="sk-ant-..."
                class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
              />
            </div>
          </section>

          {/* OAuth */}
          <section class="bg-wopr-panel border border-wopr-border rounded-lg p-4">
            <h2 class="text-lg font-semibold text-wopr-accent mb-4">OAuth (claude.ai login)</h2>
            <div class="space-y-3">
              <div>
                <label class="block text-sm text-wopr-muted mb-1">Client ID</label>
                <input
                  type="text"
                  value={config()!.oauth.clientId || ""}
                  onInput={(e) => setConfig({ ...config()!, oauth: { ...config()!.oauth, clientId: e.currentTarget.value } })}
                  class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                />
              </div>
              <div>
                <label class="block text-sm text-wopr-muted mb-1">Client Secret</label>
                <input
                  type="password"
                  value={config()!.oauth.clientSecret || ""}
                  onInput={(e) => setConfig({ ...config()!, oauth: { ...config()!.oauth, clientSecret: e.currentTarget.value } })}
                  class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                />
              </div>
              <div>
                <label class="block text-sm text-wopr-muted mb-1">Redirect URI</label>
                <input
                  type="text"
                  value={config()!.oauth.redirectUri || ""}
                  onInput={(e) => setConfig({ ...config()!, oauth: { ...config()!.oauth, redirectUri: e.currentTarget.value } })}
                  placeholder="http://localhost:3333/callback"
                  class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                />
              </div>
            </div>
          </section>

          {/* Discord */}
          <section class="bg-wopr-panel border border-wopr-border rounded-lg p-4">
            <h2 class="text-lg font-semibold text-wopr-accent mb-4">Discord Bot</h2>
            <div class="space-y-3">
              <div>
                <label class="block text-sm text-wopr-muted mb-1">Bot Token</label>
                <input
                  type="password"
                  value={config()!.discord?.token || ""}
                  onInput={(e) => setConfig({ ...config()!, discord: { ...config()!.discord, token: e.currentTarget.value } })}
                  class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                />
              </div>
              <div>
                <label class="block text-sm text-wopr-muted mb-1">Guild ID (optional)</label>
                <input
                  type="text"
                  value={config()!.discord?.guildId || ""}
                  onInput={(e) => setConfig({ ...config()!, discord: { ...config()!.discord, guildId: e.currentTarget.value } })}
                  class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                />
              </div>
            </div>
          </section>

          {/* Discovery */}
          <section class="bg-wopr-panel border border-wopr-border rounded-lg p-4">
            <h2 class="text-lg font-semibold text-wopr-accent mb-4">Discovery</h2>
            <div class="space-y-3">
              <div>
                <label class="block text-sm text-wopr-muted mb-1">Auto-join Topics (comma-separated)</label>
                <input
                  type="text"
                  value={config()!.discovery.topics.join(", ")}
                  onInput={(e) => setConfig({ ...config()!, discovery: { ...config()!.discovery, topics: e.currentTarget.value.split(",").map(t => t.trim()) } })}
                  placeholder="ai-agents, wopr-network"
                  class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                />
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config()!.discovery.autoJoin}
                  onChange={(e) => setConfig({ ...config()!, discovery: { ...config()!.discovery, autoJoin: e.currentTarget.checked } })}
                  class="rounded border-wopr-border"
                />
                <label class="text-sm text-wopr-text">Auto-join topics on startup</label>
              </div>
            </div>
          </section>

          {/* Plugins */}
          <section class="bg-wopr-panel border border-wopr-border rounded-lg p-4">
            <h2 class="text-lg font-semibold text-wopr-accent mb-4">Plugins</h2>
            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config()!.plugins.autoLoad}
                  onChange={(e) => setConfig({ ...config()!, plugins: { ...config()!.plugins, autoLoad: e.currentTarget.checked } })}
                  class="rounded border-wopr-border"
                />
                <label class="text-sm text-wopr-text">Auto-load plugins on startup</label>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div class="text-wopr-muted">Loading configuration...</div>
      )}
    </div>
  );
};

export default Settings;
