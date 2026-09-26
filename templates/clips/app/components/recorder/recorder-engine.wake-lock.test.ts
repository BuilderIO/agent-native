import { afterEach, describe, expect, it, vi } from "vitest";

import { NO_MIC_DEVICE_ID, RecorderEngine } from "./recorder-engine";


class FakeTrack {
  readonly kind = "video";
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, cb: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: () => void) {
    this.listeners.get(type)?.delete(cb);
  }
  stop() {}
  getSettings() {
    return {};
  }
}

class FakeStream {
  constructor(private tracks: FakeTrack[]) {}
  getVideoTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return [];
  }
  getTracks() {
    return this.tracks;
  }
}

function makeEngine() {
  return new RecorderEngine({
    recordingId: "rec-1",
    mode: "screen",
    micDeviceId: NO_MIC_DEVICE_ID,
    uploadUrl: "/api/uploads/rec-1/chunk",
    abortUrl: "/api/uploads/rec-1/abort",
  });
}

describe("RecorderEngine screen wake lock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a screen wake lock while display capture is live, and releases it on teardown", async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release }));
    const getDisplayMedia = vi.fn(
      async () => new FakeStream([new FakeTrack()]),
    );

    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      isSecureContext: true,
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        close() {
          return Promise.resolve();
        }
      },
    );
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia, getUserMedia: vi.fn() },
      wakeLock: { request },
    });

    const engine = makeEngine();
    await engine.acquire();
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledWith("screen");
    expect(release).not.toHaveBeenCalled();

    await engine.cancel();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("never blocks capture when the Wake Lock API is unavailable", async () => {
    const getDisplayMedia = vi.fn(
      async () => new FakeStream([new FakeTrack()]),
    );

    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      isSecureContext: true,
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        close() {
          return Promise.resolve();
        }
      },
    );
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia, getUserMedia: vi.fn() },
      // no wakeLock property at all — older/other browsers
    });

    const engine = makeEngine();
    await expect(engine.acquire()).resolves.toBeTruthy();
  });

  it("releases a wake lock that resolves after teardown", async () => {
    let resolveRequest!: (sentinel: { release: () => Promise<void> }) => void;
    const requestPromise = new Promise<{ release: () => Promise<void> }>(
      (resolve) => {
        resolveRequest = resolve;
      },
    );
    const request = vi.fn(() => requestPromise);
    const release = vi.fn(async () => {});
    const getDisplayMedia = vi.fn(
      async () => new FakeStream([new FakeTrack()]),
    );

    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      isSecureContext: true,
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        close() {
          return Promise.resolve();
        }
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response()),
    );
    vi.stubGlobal("navigator", {
      mediaDevices: { getDisplayMedia, getUserMedia: vi.fn() },
      wakeLock: { request },
    });

    const engine = makeEngine();
    await engine.acquire();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("screen");

    await engine.cancel();
    expect(release).not.toHaveBeenCalled();

    resolveRequest({ release });
    await Promise.resolve();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
