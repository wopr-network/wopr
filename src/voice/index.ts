/**
 * WOPR Voice Module
 *
 * Provides STT (Speech-to-Text) and TTS (Text-to-Speech) plugin infrastructure.
 *
 * Usage for voice plugin authors:
 * ```typescript
 * import { STTProvider, TTSProvider, VoicePluginMetadata } from "wopr/voice";
 *
 * class MySTTProvider implements STTProvider {
 *   readonly metadata: VoicePluginMetadata = {
 *     name: "my-stt",
 *     version: "1.0.0",
 *     type: "stt",
 *     description: "My custom STT provider",
 *     capabilities: ["batch", "streaming"],
 *     local: true,
 *   };
 *   // ... implement interface
 * }
 * ```
 *
 * Usage for channel plugins consuming voice:
 * ```typescript
 * const stt = ctx.getExtension('stt') as STTProvider | null;
 * const tts = ctx.getExtension('tts') as TTSProvider | null;
 *
 * if (stt && tts) {
 *   // Voice is available, enable voice features
 *   const text = await stt.transcribe(audioBuffer);
 *   const { audio } = await tts.synthesize(response);
 * }
 * ```
 */

// Registry
export {
  getVoiceRegistry,
  resetVoiceRegistry,
  WOPRVoiceRegistry,
} from "./registry.js";
// Types
export type {
  AudioConfig,
  AudioFormat,
  InstallMethod,
  STTOptions,
  STTProvider,
  STTSession,
  STTTranscriptChunk,
  TTSOptions,
  TTSProvider,
  TTSSynthesisResult,
  Voice,
  VoiceConsumerContext,
  VoicePluginContext,
  VoicePluginMetadata,
  VoicePluginRequirements,
  VoiceRegistry,
} from "./types.js";
