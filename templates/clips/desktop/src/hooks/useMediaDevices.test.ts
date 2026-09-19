import { describe, expect, it, vi } from "vitest";

const mediaMocks = vi.hoisted(() => ({
  getAudioStreamWithFallback: vi.fn(),
}));

vi.mock("../lib/media-capture-constraints", () => ({
  getAudioStreamWithFallback: mediaMocks.getAudioStreamWithFallback,
}));

import { refreshMicrophoneAccess } from "./useMediaDevices";

describe("desktop microphone device discovery", () => {
  it("uses the recorder fallback chain and releases its discovery stream", async () => {
    const stopFirstTrack = vi.fn();
    const stopSecondTrack = vi.fn();
    mediaMocks.getAudioStreamWithFallback.mockResolvedValueOnce({
      getAudioTracks: () => [
        {
          getSettings: () => ({ deviceId: "studio-display" }),
          label: "Studio Display Microphone",
        },
      ],
      getTracks: () => [{ stop: stopFirstTrack }, { stop: stopSecondTrack }],
    });

    await expect(
      refreshMicrophoneAccess("stale-earpods", "EarPods Microphone"),
    ).resolves.toEqual({
      deviceId: "studio-display",
      label: "Studio Display Microphone",
    });

    expect(mediaMocks.getAudioStreamWithFallback).toHaveBeenCalledWith(
      "stale-earpods",
      "EarPods Microphone",
      false,
    );
    expect(stopFirstTrack).toHaveBeenCalledOnce();
    expect(stopSecondTrack).toHaveBeenCalledOnce();
  });
});
