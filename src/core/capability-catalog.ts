/**
 * Capability Catalog — maps user-facing capabilities to the plugins
 * that provide them and their WOPR-hosted default configuration.
 *
 * This is the "menu" users see. Each entry knows:
 * - Which plugins to install (by GitHub source or npm name)
 * - What config to inject for WOPR-hosted mode (api.wopr.bot + platform token)
 * - Human-readable display metadata (icon, label, description)
 */

export interface CapabilityCatalogEntry {
  /** User-facing capability ID (e.g., "voice", "image-gen", "embeddings") */
  id: string;
  /** Human-readable label (e.g., "Voice") */
  label: string;
  /** Short description shown in UI */
  description: string;
  /** Icon emoji for UI display */
  icon: string;
  /** Plugins to install for this capability (in order) */
  plugins: CapabilityPluginRef[];
  /** Confirmation message shown after activation */
  activatedMessage: string;
}

export interface CapabilityPluginRef {
  /** Plugin install source (e.g., "github:wopr-network/wopr-plugin-voice-chatterbox") */
  source: string;
  /** Short name for the plugin (used as key in plugins.data config) */
  name: string;
  /** Default config to inject for WOPR-hosted mode */
  hostedConfig: Record<string, unknown>;
}

/**
 * Get the default WOPR-hosted config shared by all capability plugins.
 * Uses the bot's platform token from env/config.
 */
function hostedDefaults(): { baseUrl: string } {
  return {
    baseUrl: "https://api.wopr.bot",
  };
}

export const CAPABILITY_CATALOG: CapabilityCatalogEntry[] = [
  {
    id: "voice",
    label: "Voice",
    description: "Text-to-speech and speech-to-text for your bot",
    icon: "🎙️",
    plugins: [
      {
        source: "github:wopr-network/wopr-plugin-voice-chatterbox",
        name: "wopr-plugin-voice-chatterbox",
        hostedConfig: { ...hostedDefaults(), capability: "tts" },
      },
      {
        source: "github:wopr-network/wopr-plugin-voice-whisper",
        name: "wopr-plugin-voice-whisper",
        hostedConfig: { ...hostedDefaults(), capability: "stt" },
      },
    ],
    activatedMessage: "Voice activated! 🎙️",
  },
  {
    id: "image-gen",
    label: "Image Generation",
    description: "Generate images from text prompts",
    icon: "🎨",
    plugins: [
      {
        source: "github:wopr-network/wopr-plugin-image-sdxl",
        name: "wopr-plugin-image-sdxl",
        hostedConfig: { ...hostedDefaults(), capability: "image-gen" },
      },
    ],
    activatedMessage: "Image generation activated! 🎨",
  },
  {
    id: "embeddings",
    label: "Embeddings",
    description: "Vector embeddings for semantic search and memory",
    icon: "🧠",
    plugins: [
      {
        source: "github:wopr-network/wopr-plugin-embeddings",
        name: "wopr-plugin-embeddings",
        hostedConfig: { ...hostedDefaults(), capability: "embeddings" },
      },
    ],
    activatedMessage: "Embeddings activated! 🧠",
  },
  {
    id: "video-gen",
    label: "Video Generation",
    description: "Generate videos from text prompts",
    icon: "🎬",
    plugins: [
      {
        source: "github:wopr-network/wopr-plugin-video",
        name: "wopr-plugin-video",
        hostedConfig: { ...hostedDefaults(), capability: "video-gen" },
      },
    ],
    activatedMessage: "Video generation activated! 🎬",
  },
];

/**
 * Look up a capability by ID.
 */
export function getCapabilityCatalogEntry(id: string): CapabilityCatalogEntry | undefined {
  return CAPABILITY_CATALOG.find((c) => c.id === id);
}

/**
 * List all available capabilities.
 */
export function listCapabilityCatalog(): CapabilityCatalogEntry[] {
  return CAPABILITY_CATALOG;
}
