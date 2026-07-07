import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDesktopDisplayMediaOptions,
  getAudioStreamWithFallback,
  getCameraStreamWithFallback,
  isMediaConstraintFailure,
} from "./media-capture-constraints";

const originalNavigator = globalThis.navigator;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
});

function mockGetUserMedia(
  getUserMedia: ReturnType<typeof vi.fn>,
  enumerateDevices?: ReturnType<typeof vi.fn>,
): ReturnType<typeof vi.fn> {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia,
        enumerateDevices,
      },
    },
  });
  return getUserMedia;
}

describe("desktop media capture constraints", () => {
  it("does not pass displaySurface into getDisplayMedia constraints", () => {
    const options = buildDesktopDisplayMediaOptions({
      audio: true,
      frameRate: 24,
      maxWidth: 1920,
      maxHeight: 1080,
    });

    expect(options.audio).toBe(true);
    expect(options.video).toMatchObject({
      frameRate: { ideal: 24, max: 24 },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    });
    expect(options.video).not.toHaveProperty("displaySurface");
  });

  it("classifies invalid media constraints as constraint failures", () => {
    expect(
      isMediaConstraintFailure(
        new DOMException("Invalid constraint", "OverconstrainedError"),
      ),
    ).toBe(true);
    expect(isMediaConstraintFailure(new Error("Permission denied"))).toBe(
      false,
    );
  });

  it("retries a stale exact mic id with a saved-label mic rematch", async () => {
    const fallbackStream = { id: "fallback-audio" } as unknown as MediaStream;
    const getUserMedia = mockGetUserMedia(
      vi
        .fn()
        .mockRejectedValueOnce(
          new DOMException("Invalid constraint", "OverconstrainedError"),
        )
        .mockResolvedValueOnce(fallbackStream),
      vi.fn(async () => [
        {
          kind: "audioinput",
          deviceId: "new-mic-id",
          label: "MacBook Pro Microphone",
        },
      ]),
    );

    await expect(
      getAudioStreamWithFallback("stale-mic", "MacBook Pro Microphone"),
    ).resolves.toBe(fallbackStream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({
      audio: { deviceId: { exact: "stale-mic" } },
      video: false,
    });
    expect(getUserMedia.mock.calls[1]?.[0]).toMatchObject({
      audio: { deviceId: { exact: "new-mic-id" } },
      video: false,
    });
  });

  it("retries a stale exact camera id with the default camera", async () => {
    const fallbackStream = { id: "fallback-camera" } as unknown as MediaStream;
    const getUserMedia = mockGetUserMedia(
      vi
        .fn()
        .mockRejectedValueOnce(
          new DOMException("Device not found", "NotFoundError"),
        )
        .mockResolvedValueOnce(fallbackStream),
    );

    await expect(getCameraStreamWithFallback("stale-camera")).resolves.toBe(
      fallbackStream,
    );
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({
      video: { deviceId: { exact: "stale-camera" } },
      audio: false,
    });
    expect(getUserMedia.mock.calls[1]?.[0]).toEqual({
      video: true,
      audio: false,
    });
  });
});
