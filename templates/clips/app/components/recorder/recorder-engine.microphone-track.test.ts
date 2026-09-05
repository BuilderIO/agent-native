import { describe, expect, it } from "vitest";

import { RecorderEngine } from "./recorder-engine";

describe("RecorderEngine microphone track access", () => {
  it("exposes only a live microphone track for read-only recording chrome", () => {
    const track = { readyState: "live" } as MediaStreamTrack;
    const engine = new RecorderEngine({
      recordingId: "rec-1",
      mode: "screen",
    });
    const internals = engine as unknown as {
      micStream: MediaStream | null;
    };
    internals.micStream = {
      getAudioTracks: () => [track],
    } as unknown as MediaStream;

    expect(engine.getMicrophoneTrack()).toBe(track);

    Object.defineProperty(track, "readyState", { value: "ended" });
    expect(engine.getMicrophoneTrack()).toBeNull();
  });

  it("returns null when recording has no microphone track", () => {
    const engine = new RecorderEngine({
      recordingId: "rec-1",
      mode: "screen",
    });

    expect(engine.getMicrophoneTrack()).toBeNull();
  });
});
