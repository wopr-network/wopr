import { createRequire } from "node:module";
import type { OpusConfig, VoiceParticipant } from "./types.js";

const require = createRequire(import.meta.url);

/** Default Opus config: 48kHz stereo, 20ms frames */
const DEFAULT_OPUS_CONFIG: Required<OpusConfig> = {
  sampleRate: 48000,
  channels: 2,
  frameDurationMs: 20,
};

export interface BroadcasterOptions {
  participants: VoiceParticipant[];
  opusConfig?: OpusConfig;
}

export interface Broadcaster {
  /** Send PCM audio to all participants, encoding to Opus where needed */
  broadcast(pcmAudio: Buffer): void;
  /** Add a participant at runtime */
  addParticipant(participant: VoiceParticipant): void;
  /** Remove a participant by ID */
  removeParticipant(id: string): void;
  /** Clean up encoder resources */
  destroy(): void;
}

interface OpusEncoderInstance {
  encode: (pcm: Buffer, frameSize: number) => Buffer;
  delete: () => void;
}

function loadOpusEncoder(config: Required<OpusConfig>): {
  encode: (pcm: Buffer) => Buffer;
  destroy: () => void;
} {
  let OpusEncoderClass: new (sampleRate: number, channels: number) => OpusEncoderInstance;

  try {
    const mod = require("@discordjs/opus") as {
      OpusEncoder: new (sampleRate: number, channels: number) => OpusEncoderInstance;
    };
    OpusEncoderClass = mod.OpusEncoder;
  } catch {
    throw new Error(
      "Failed to load @discordjs/opus. Install it with: npm install @discordjs/opus\n" +
        "A C++ compiler and libopus headers are required for native compilation.",
    );
  }

  const encoder = new OpusEncoderClass(config.sampleRate, config.channels);
  const frameSize = (config.sampleRate / 1000) * config.frameDurationMs;

  return {
    encode: (pcm: Buffer) => encoder.encode(pcm, frameSize),
    destroy: () => {
      try {
        encoder.delete();
      } catch {
        // Already deleted or GC'd — ignore
      }
    },
  };
}

export function createBroadcaster(options: BroadcasterOptions): Broadcaster {
  const config: Required<OpusConfig> = {
    ...DEFAULT_OPUS_CONFIG,
    ...options.opusConfig,
  };
  const participants = new Map<string, VoiceParticipant>();
  let destroyed = false;
  let opusEncoder: ReturnType<typeof loadOpusEncoder> | null = null;

  for (const p of options.participants) {
    participants.set(p.id, p);
  }

  function ensureOpusEncoder(): ReturnType<typeof loadOpusEncoder> {
    if (!opusEncoder) {
      opusEncoder = loadOpusEncoder(config);
    }
    return opusEncoder;
  }

  function broadcast(pcmAudio: Buffer): void {
    if (destroyed || participants.size === 0) return;

    let opusAudio: Buffer | undefined;
    let needsOpus = false;

    for (const p of participants.values()) {
      if (p.encoding === "opus") {
        needsOpus = true;
        break;
      }
    }

    if (needsOpus) {
      const enc = ensureOpusEncoder();
      opusAudio = enc.encode(pcmAudio);
    }

    for (const p of participants.values()) {
      try {
        if (p.encoding === "opus" && opusAudio !== undefined) {
          p.send(opusAudio);
        } else {
          // PCM passthrough — zero-copy, same Buffer reference
          p.send(pcmAudio);
        }
      } catch {
        // Individual participant send failure should not break broadcast to others
      }
    }
  }

  function addParticipant(participant: VoiceParticipant): void {
    participants.set(participant.id, participant);
  }

  function removeParticipant(id: string): void {
    participants.delete(id);
  }

  function destroy(): void {
    destroyed = true;
    participants.clear();
    if (opusEncoder) {
      opusEncoder.destroy();
      opusEncoder = null;
    }
  }

  return { broadcast, addParticipant, removeParticipant, destroy };
}
