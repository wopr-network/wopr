/**
 * Step 7b: Voice setup (STT/TTS plugins)
 */

import { discoverVoicePlugins, installPlugin } from "../../../plugins.js";
import { confirm, multiselect, note, pc, spinner } from "../prompts.js";
import type { OnboardContext, OnboardStep } from "../types.js";

export const voiceStep: OnboardStep = async (ctx: OnboardContext) => {
  if (ctx.opts.skipPlugins) {
    return {};
  }

  const isQuickstart = ctx.opts.flow === "quickstart";

  // Ask if user wants voice features
  const wantVoice = await confirm({
    message: "Set up voice features (speech-to-text, text-to-speech)?",
    initialValue: false,
  });

  if (!wantVoice) {
    return {};
  }

  // Discover available voice plugins dynamically
  const s = await spinner();
  s.start("Discovering voice plugins...");

  let voicePlugins: Awaited<ReturnType<typeof discoverVoicePlugins>>;
  try {
    voicePlugins = await discoverVoicePlugins();
    s.stop("Found voice plugins");
  } catch (_err: unknown) {
    s.stop("Plugin discovery failed");
    await note(
      [
        "Could not discover voice plugins.",
        "",
        "You can install manually:",
        pc.cyan("  wopr plugin install github:wopr-network/wopr-plugin-voice-whisper-local"),
        pc.cyan("  wopr plugin install github:wopr-network/wopr-plugin-voice-openai-tts"),
      ].join("\n"),
      "Voice Plugins",
    );
    return {};
  }

  // Show what's available
  await note(
    [
      "Voice plugins enable speech transcription and synthesis.",
      "",
      "Available STT (Speech-to-Text):",
      ...voicePlugins.stt.map((p) => `  ${p.installed ? "✓" : "•"} ${p.name}: ${p.description || ""}`),
      "",
      "Available TTS (Text-to-Speech):",
      ...voicePlugins.tts.map((p) => `  ${p.installed ? "✓" : "•"} ${p.name}: ${p.description || ""}`),
      "",
      "Voice Channels:",
      ...voicePlugins.channels.map((p) => `  ${p.installed ? "✓" : "•"} ${p.name}: ${p.description || ""}`),
      "",
      pc.dim("✓ = already installed"),
    ].join("\n"),
    "Voice Plugins",
  );

  // Select STT
  let selectedSTT: string[] = [];
  if (voicePlugins.stt.length > 0) {
    if (isQuickstart) {
      // In QuickStart, recommend local whisper
      const localSTT = voicePlugins.stt.find((p) => p.name.includes("whisper"));
      if (localSTT && !localSTT.installed) {
        const wantLocal = await confirm({
          message: `Install ${localSTT.name} (local, no API key needed)?`,
          initialValue: true,
        });
        if (wantLocal) selectedSTT.push(localSTT.name);
      }
    } else {
      selectedSTT = await multiselect({
        message: "Select STT providers to install",
        options: voicePlugins.stt.map((p) => ({
          value: p.name,
          label: `${p.name}${p.installed ? " (installed)" : ""}`,
          hint: p.description,
        })),
        required: false,
      });
    }
  }

  // Select TTS
  let selectedTTS: string[] = [];
  if (voicePlugins.tts.length > 0) {
    if (isQuickstart) {
      // In QuickStart, recommend local piper
      const localTTS = voicePlugins.tts.find((p) => p.name.includes("piper"));
      if (localTTS && !localTTS.installed) {
        const wantLocal = await confirm({
          message: `Install ${localTTS.name} (local via Docker, no API key)?`,
          initialValue: true,
        });
        if (wantLocal) selectedTTS.push(localTTS.name);
      }
    } else {
      selectedTTS = await multiselect({
        message: "Select TTS providers to install",
        options: voicePlugins.tts.map((p) => ({
          value: p.name,
          label: `${p.name}${p.installed ? " (installed)" : ""}`,
          hint: p.description,
        })),
        required: false,
      });
    }
  }

  // Select voice channels (like Discord voice)
  const selectedChannels: string[] = [];
  if (voicePlugins.channels.length > 0) {
    // Check if Discord is being set up
    const hasDiscord = ctx.nextConfig.channels?.includes("discord");
    if (hasDiscord) {
      const discordVoice = voicePlugins.channels.find((p) => p.name.includes("discord"));
      if (discordVoice && !discordVoice.installed) {
        const wantDiscordVoice = await confirm({
          message: "Enable Discord voice channel support?",
          initialValue: true,
        });
        if (wantDiscordVoice) selectedChannels.push(discordVoice.name);
      }
    }
  }

  // Always install voice-cli if installing any voice plugins
  const allSelected = [...selectedSTT, ...selectedTTS, ...selectedChannels];
  const voiceCLI = voicePlugins.cli.find((p) => p.name.includes("voice-cli"));
  if (allSelected.length > 0 && voiceCLI && !voiceCLI.installed) {
    allSelected.push(voiceCLI.name);
  }

  if (allSelected.length === 0) {
    await note("No voice plugins selected.", "Voice");
    return {};
  }

  // Install selected plugins
  const installed: string[] = [];
  const errors: string[] = [];

  for (const pluginName of allSelected) {
    const plugin = [...voicePlugins.stt, ...voicePlugins.tts, ...voicePlugins.channels, ...voicePlugins.cli].find(
      (p) => p.name === pluginName,
    );

    if (!plugin || plugin.installed) {
      installed.push(pluginName);
      continue;
    }

    s.start(`Installing ${pluginName}...`);
    try {
      // Install from GitHub if we have a URL, otherwise use npm package name
      const source = plugin.url || pluginName;
      await installPlugin(source);
      installed.push(pluginName);
      s.stop(`${pluginName} installed`);
    } catch (err: unknown) {
      s.stop(`${pluginName} failed`);
      errors.push(`${pluginName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    await note(
      [
        "Some voice plugins failed to install:",
        ...errors.map((e) => `  • ${e}`),
        "",
        "You can retry with:",
        pc.cyan("  wopr plugin install <plugin-name>"),
      ].join("\n"),
      "Voice Issues",
    );
  }

  // Show next steps
  if (installed.some((p) => p.includes("whisper"))) {
    await note(
      [
        "Local Whisper STT installed!",
        "",
        "Requirements:",
        "  • whisper.cpp or faster-whisper binary",
        "  • Model file (tiny, base, small, medium, large)",
        "",
        "Test with:",
        pc.cyan("  wopr voice transcribe audio.wav"),
      ].join("\n"),
      "Whisper STT",
    );
  }

  if (installed.some((p) => p.includes("piper"))) {
    await note(
      [
        "Local Piper TTS installed!",
        "",
        "Requirements:",
        "  • Docker (for rhasspy/piper image)",
        "",
        "The plugin will auto-pull the Docker image on first use.",
        "",
        "Test with:",
        pc.cyan('  wopr voice synthesize default "Hello world"'),
      ].join("\n"),
      "Piper TTS",
    );
  }

  if (installed.some((p) => p.includes("openai-tts"))) {
    await note(
      [
        "OpenAI TTS installed!",
        "",
        "Requirements:",
        "  • OPENAI_API_KEY environment variable",
        "",
        "Test with:",
        pc.cyan('  wopr voice synthesize coral "Hello world"'),
      ].join("\n"),
      "OpenAI TTS",
    );
  }

  if (installed.some((p) => p.includes("discord-voice"))) {
    await note(
      [
        "Discord Voice installed!",
        "",
        "Your Discord bot can now:",
        "  • Join voice channels",
        "  • Listen to users (STT)",
        "  • Speak responses (TTS)",
        "",
        "Enable with: !voice join",
      ].join("\n"),
      "Discord Voice",
    );
  }

  return { voicePlugins: installed };
};
