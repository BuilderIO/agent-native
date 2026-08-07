// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlaybackPosition } from "./use-playback-position";

const mockGetPlaybackPosition = vi.hoisted(() => vi.fn());
const mockSavePlaybackPosition = vi.hoisted(() => vi.fn());

vi.mock("@/lib/playback-position", () => ({
  getPlaybackPosition: (...args: unknown[]) => mockGetPlaybackPosition(...args),
  savePlaybackPosition: (...args: unknown[]) =>
    mockSavePlaybackPosition(...args),
}));

function Harness({
  explicitStartMs,
  onRestore,
}: {
  explicitStartMs?: number;
  onRestore: (positionMs: number) => void;
}) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  usePlaybackPosition({
    recordingId: "recording-1",
    videoEl,
    durationMs: 10_000,
    explicitStartMs,
    onRestore,
  });
  return <video ref={setVideoEl} />;
}

describe("usePlaybackPosition", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restores: number[];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockGetPlaybackPosition.mockResolvedValue(null);
    mockSavePlaybackPosition.mockResolvedValue(undefined);
    restores = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function getVideo(): HTMLVideoElement {
    const video = container.querySelector("video");
    if (!video) throw new Error("no video rendered");
    return video;
  }

  it("restores a saved position after the media element is ready", async () => {
    mockGetPlaybackPosition.mockResolvedValue(4_500);

    act(() => {
      root.render(
        <Harness onRestore={(positionMs) => restores.push(positionMs)} />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });
    const video = getVideo();
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });

    expect(restores).toEqual([4_500]);
    expect(mockGetPlaybackPosition).toHaveBeenCalledWith(
      "recording-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("flushes the current position when playback pauses", () => {
    act(() => {
      root.render(
        <Harness onRestore={(positionMs) => restores.push(positionMs)} />,
      );
    });
    const video = getVideo();
    video.currentTime = 4.5;

    act(() => {
      video.dispatchEvent(new Event("play"));
      video.dispatchEvent(new Event("pause"));
    });

    expect(mockSavePlaybackPosition).toHaveBeenCalledWith(
      "recording-1",
      4_500,
      { keepalive: true },
    );
  });

  it("does not hydrate over an explicit timestamp start", async () => {
    mockGetPlaybackPosition.mockResolvedValue(4_500);

    act(() => {
      root.render(
        <Harness
          explicitStartMs={1_000}
          onRestore={(positionMs) => restores.push(positionMs)}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetPlaybackPosition).not.toHaveBeenCalled();
    expect(restores).toEqual([]);
  });
});
