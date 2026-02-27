/** Supported audio encodings for voice channel participants */
export type AudioEncoding = "pcm" | "opus";

/** A participant in a voice channel who receives audio */
export interface VoiceParticipant {
  /** Unique identifier for this participant */
  id: string;
  /** The encoding this participant expects to receive */
  encoding: AudioEncoding;
  /** Callback to deliver encoded audio to this participant */
  send: (audio: Buffer) => void;
}

/** Configuration for the Opus encoder */
export interface OpusConfig {
  /** Sample rate in Hz (default: 48000) */
  sampleRate?: number;
  /** Number of channels (default: 2 for stereo) */
  channels?: number;
  /** Frame duration in ms — must be 2.5, 5, 10, 20, 40, or 60 (default: 20) */
  frameDurationMs?: number;
}
