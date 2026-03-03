import type { OpusConfig, VoiceParticipant } from "./types.js";

/** Default Opus config: 48kHz stereo, 20ms frames */
const DEFAULT_OPUS_CONFIG: Required<OpusConfig> = {
  sampleRate: 48000,
  channels: 2,
  frameDurationMs: 20,
};

/** @internal For testing only: signature of the encoder factory */
export type OpusEncoderFactory = (config: Required<OpusConfig>) =>
  | Promise<{
      encode: (pcm: Buffer) => Buffer;
      destroy: () => void;
    }>
  | {
      encode: (pcm: Buffer) => Buffer;
      destroy: () => void;
    };

export interface BroadcasterOptions {
  participants: VoiceParticipant[];
  opusConfig?: OpusConfig;
  /** @internal For testing only: inject a custom encoder factory instead of loading @discordjs/opus */
  _encoderFactory?: OpusEncoderFactory;
}

export interface Broadcaster {
  /** Send PCM audio to all participants, encoding to Opus where needed */
  broadcast(pcmAudio: Buffer): void | Promise<void>;
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

async function loadOpusEncoder(config: Required<OpusConfig>): Promise<{
  encode: (pcm: Buffer) => Buffer;
  destroy: () => void;
}> {
  let OpusEncoderClass: new (sampleRate: number, channels: number) => OpusEncoderInstance;

  try {
    // @ts-expect-error — @discordjs/opus is an optional native dep with no bundled types
    const mod = (await import("@discordjs/opus")) as {
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
  const encoderFactory = options._encoderFactory ?? loadOpusEncoder;
  const participants = new Map<string, VoiceParticipant>();
  let destroyed = false;
  let opusEncoder: { encode: (pcm: Buffer) => Buffer; destroy: () => void } | null = null;

  for (const p of options.participants) {
    participants.set(p.id, p);
  }

  async function ensureOpusEncoder(): Promise<{ encode: (pcm: Buffer) => Buffer; destroy: () => void }> {
    if (!opusEncoder) {
      opusEncoder = await encoderFactory(config);
    }
    return opusEncoder;
  }

  async function broadcast(pcmAudio: Buffer): Promise<void> {
    if (destroyed || participants.size === 0) return;

    // Snapshot before iteration so send() callbacks that call addParticipant/removeParticipant
    // don't affect this broadcast frame's recipient list or needsOpus decision
    const snapshot = Array.from(participants.values());

    let opusAudio: Buffer | undefined;
    const needsOpus = snapshot.some((p) => p.encoding === "opus");

    if (needsOpus) {
      try {
        const enc = await ensureOpusEncoder();
        opusAudio = enc.encode(pcmAudio);
      } catch {
        // Opus encoder unavailable or encoding failed — PCM participants still receive audio,
        // Opus participants are silently skipped for this frame
      }
    }

    for (const p of snapshot) {
      try {
        if (p.encoding === "opus") {
          // Only send to Opus participants if encoding succeeded
          if (opusAudio !== undefined) {
            p.send(opusAudio);
          }
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
    if (destroyed) return;
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
