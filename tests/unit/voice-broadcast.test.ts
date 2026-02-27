import { describe, it, expect } from "vitest";
import type {
  AudioEncoding,
  VoiceParticipant,
} from "../../src/media/voice-channels/types.js";
import { createBroadcaster } from "../../src/media/voice-channels/broadcast.js";

describe("voice-channels types", () => {
  it("AudioEncoding accepts pcm and opus", () => {
    const pcm: AudioEncoding = "pcm";
    const opus: AudioEncoding = "opus";
    expect(pcm).toBe("pcm");
    expect(opus).toBe("opus");
  });

  it("VoiceParticipant has required fields", () => {
    const received: Buffer[] = [];
    const participant: VoiceParticipant = {
      id: "user-1",
      encoding: "pcm",
      send: (audio) => received.push(audio),
    };
    participant.send(Buffer.from([1, 2, 3]));
    expect(participant.id).toBe("user-1");
    expect(participant.encoding).toBe("pcm");
    expect(received).toHaveLength(1);
  });
});

describe("createBroadcaster", () => {
  it("sends PCM audio directly to PCM participants", () => {
    const received: Buffer[] = [];
    const participant: VoiceParticipant = {
      id: "pcm-user",
      encoding: "pcm",
      send: (audio) => received.push(audio),
    };

    const broadcaster = createBroadcaster({ participants: [participant] });
    const pcmData = Buffer.alloc(3840); // 20ms of 48kHz stereo 16-bit PCM
    broadcaster.broadcast(pcmData);

    expect(received).toHaveLength(1);
    // PCM passthrough — same buffer reference (zero-copy)
    expect(received[0]).toBe(pcmData);
  });

  it("encodes audio to Opus for Opus participants", () => {
    const received: Buffer[] = [];
    const participant: VoiceParticipant = {
      id: "opus-user",
      encoding: "opus",
      send: (audio) => received.push(audio),
    };

    const broadcaster = createBroadcaster({ participants: [participant] });
    // 20ms of 48kHz stereo 16-bit PCM = 48000 * 2 channels * 2 bytes * 0.02s = 3840 bytes
    const pcmData = Buffer.alloc(3840);
    broadcaster.broadcast(pcmData);

    expect(received).toHaveLength(1);
    // Opus output is smaller than PCM input
    expect(received[0].length).toBeLessThan(pcmData.length);
    // Opus output is a Buffer
    expect(Buffer.isBuffer(received[0])).toBe(true);
  });

  it("broadcasts to mixed PCM and Opus participants simultaneously", () => {
    const pcmReceived: Buffer[] = [];
    const opusReceived: Buffer[] = [];

    const pcmUser: VoiceParticipant = {
      id: "pcm-user",
      encoding: "pcm",
      send: (audio) => pcmReceived.push(audio),
    };
    const opusUser: VoiceParticipant = {
      id: "opus-user",
      encoding: "opus",
      send: (audio) => opusReceived.push(audio),
    };

    const broadcaster = createBroadcaster({ participants: [pcmUser, opusUser] });
    const pcmData = Buffer.alloc(3840);
    broadcaster.broadcast(pcmData);

    expect(pcmReceived).toHaveLength(1);
    expect(opusReceived).toHaveLength(1);
    // PCM gets raw buffer, Opus gets encoded (smaller)
    expect(pcmReceived[0]).toBe(pcmData);
    expect(opusReceived[0].length).toBeLessThan(pcmData.length);
  });

  it("handles empty participant list as a no-op", () => {
    const broadcaster = createBroadcaster({ participants: [] });
    // Should not throw
    expect(() => broadcaster.broadcast(Buffer.alloc(3840))).not.toThrow();
  });

  it("does not throw when a participant send() throws", () => {
    const badParticipant: VoiceParticipant = {
      id: "bad-user",
      encoding: "pcm",
      send: () => {
        throw new Error("connection lost");
      },
    };
    const goodReceived: Buffer[] = [];
    const goodParticipant: VoiceParticipant = {
      id: "good-user",
      encoding: "pcm",
      send: (audio) => goodReceived.push(audio),
    };

    const broadcaster = createBroadcaster({
      participants: [badParticipant, goodParticipant],
    });
    const pcmData = Buffer.alloc(3840);

    // Should not throw — bad participant is skipped, good one still receives
    expect(() => broadcaster.broadcast(pcmData)).not.toThrow();
    expect(goodReceived).toHaveLength(1);
  });

  it("addParticipant adds a new participant at runtime", () => {
    const received: Buffer[] = [];
    const broadcaster = createBroadcaster({ participants: [] });

    broadcaster.addParticipant({
      id: "late-joiner",
      encoding: "pcm",
      send: (audio) => received.push(audio),
    });

    broadcaster.broadcast(Buffer.alloc(3840));
    expect(received).toHaveLength(1);
  });

  it("removeParticipant removes a participant by id", () => {
    const received: Buffer[] = [];
    const participant: VoiceParticipant = {
      id: "leaving-user",
      encoding: "pcm",
      send: (audio) => received.push(audio),
    };

    const broadcaster = createBroadcaster({ participants: [participant] });
    broadcaster.removeParticipant("leaving-user");
    broadcaster.broadcast(Buffer.alloc(3840));

    expect(received).toHaveLength(0);
  });

  it("destroy cleans up the Opus encoder", () => {
    const broadcaster = createBroadcaster({ participants: [] });
    // Should not throw
    expect(() => broadcaster.destroy()).not.toThrow();
    // After destroy, broadcast should be a no-op (no throw)
    expect(() => broadcaster.broadcast(Buffer.alloc(3840))).not.toThrow();
  });

  it("destroy is idempotent — calling it twice does not throw", () => {
    const broadcaster = createBroadcaster({ participants: [] });
    expect(() => {
      broadcaster.destroy();
      broadcaster.destroy();
    }).not.toThrow();
  });

  it("addParticipant after destroy is a no-op — participant never receives audio", () => {
    const received: Buffer[] = [];
    const broadcaster = createBroadcaster({ participants: [] });
    broadcaster.destroy();

    broadcaster.addParticipant({
      id: "late-joiner",
      encoding: "pcm",
      send: (audio) => received.push(audio),
    });

    // broadcast is a no-op on destroyed broadcaster
    broadcaster.broadcast(Buffer.alloc(3840));
    expect(received).toHaveLength(0);
  });

  it("removeParticipant with a non-existent id is a no-op", () => {
    const received: Buffer[] = [];
    const participant: VoiceParticipant = {
      id: "user-1",
      encoding: "pcm",
      send: (audio) => received.push(audio),
    };

    const broadcaster = createBroadcaster({ participants: [participant] });
    // Remove a non-existent participant — should not throw or affect existing ones
    expect(() => broadcaster.removeParticipant("does-not-exist")).not.toThrow();
    broadcaster.broadcast(Buffer.alloc(3840));
    expect(received).toHaveLength(1);
  });

  it("participant added during send() callback does not affect current broadcast frame", () => {
    const received: Buffer[] = [];
    // participant1's send callback adds a new participant mid-broadcast
    const broadcaster = createBroadcaster({ participants: [] });

    const participant1: VoiceParticipant = {
      id: "p1",
      encoding: "pcm",
      send: (audio) => {
        received.push(audio);
        // This late-joiner is added during iteration — should not be visited this frame
        broadcaster.addParticipant({
          id: "late",
          encoding: "pcm",
          send: (a) => received.push(a),
        });
      },
    };

    broadcaster.addParticipant(participant1);
    broadcaster.broadcast(Buffer.alloc(3840));

    // Only p1 should have received audio this frame; late-joiner is next frame onwards
    expect(received).toHaveLength(1);
  });

  it("PCM participants still receive audio when Opus encoder is unavailable", () => {
    const pcmReceived: Buffer[] = [];
    const opusReceived: Buffer[] = [];

    const pcmUser: VoiceParticipant = {
      id: "pcm-user",
      encoding: "pcm",
      send: (audio) => pcmReceived.push(audio),
    };
    const opusUser: VoiceParticipant = {
      id: "opus-user",
      encoding: "opus",
      send: (audio) => opusReceived.push(audio),
    };

    // Inject a factory that simulates @discordjs/opus being unavailable
    const throwingFactory = () => {
      throw new Error(
        "Failed to load @discordjs/opus. Install it with: npm install @discordjs/opus",
      );
    };

    const broadcaster = createBroadcaster({
      participants: [pcmUser, opusUser],
      _encoderFactory: throwingFactory,
    });
    const pcmData = Buffer.alloc(3840);

    expect(() => broadcaster.broadcast(pcmData)).not.toThrow();
    // PCM participant receives audio even when Opus encoder is unavailable
    expect(pcmReceived).toHaveLength(1);
    expect(pcmReceived[0]).toBe(pcmData);
    // Opus participant receives nothing (encoder unavailable)
    expect(opusReceived).toHaveLength(0);
  });
});
