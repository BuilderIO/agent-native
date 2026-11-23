import { afterEach, describe, expect, it, vi } from "vitest";

import { RecorderEngine } from "./recorder-engine";

function micStream(deviceId: string, label: string): MediaStream {
  const track = {
    label,
    getSettings: () => ({ deviceId }),
    stop: vi.fn(),
  };
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function stubMicrophones() {
  const replacement = micStream("built-in", "MacBook Pro Microphone");
  const getUserMedia = vi.fn(async () => replacement);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      enumerateDevices: async () => [
        { kind: "audioinput", deviceId: "ipad", label: "iPad Mic" },
        {
          kind: "audioinput",
          deviceId: "built-in",
          label: "MacBook Pro Microphone",
        },
      ],
      getUserMedia,
    },
  });
  return { getUserMedia, replacement };
}

function micCorrection(engine: RecorderEngine) {
  const internals = engine as unknown as {
    replaceUnsafeMicCaptureIfPossible: (
      stream: MediaStream,
      requestedDeviceId: string | null,
    ) => Promise<MediaStream>;
  };
  return internals.replaceUnsafeMicCaptureIfPossible.bind(engine);
}

describe("RecorderEngine microphone track access", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("records from a phone-like mic the user picked", async () => {
    const { getUserMedia } = stubMicrophones();
    const engine = new RecorderEngine({
      recordingId: "rec-1",
      mode: "screen",
      micDeviceId: "ipad",
      micDeviceLabel: "iPad Mic",
    });
    const picked = micStream("ipad", "iPad Mic");

    await expect(micCorrection(engine)(picked, "ipad")).resolves.toBe(picked);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("moves the system default off a phone-like mic", async () => {
    const { getUserMedia, replacement } = stubMicrophones();
    const engine = new RecorderEngine({
      recordingId: "rec-1",
      mode: "screen",
    });
    const systemDefault = micStream("ipad", "iPad Mic");

    await expect(micCorrection(engine)(systemDefault, null)).resolves.toBe(
      replacement,
    );
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({ deviceId: { exact: "built-in" } }),
      }),
    );
  });
});
