// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PlayerPlaybackState,
  VideoPlayerHandle,
} from "@/components/player/video-player";

import { usePlayerShortcuts } from "./use-player-shortcuts";

function Harness({
  playerRef,
}: {
  playerRef: React.RefObject<VideoPlayerHandle | null>;
}) {
  usePlayerShortcuts({ playerRef });
  return null;
}

describe("usePlayerShortcuts", () => {
  let root: Root;
  let playback: PlayerPlaybackState | null;
  let player: Pick<
    VideoPlayerHandle,
    "readPlayback" | "play" | "pause" | "seek" | "stepFrame" | "setSpeed"
  >;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    playback = {
      paused: true,
      currentMs: 10_000,
      durationMs: 19_000,
      volume: 1,
      speed: 1,
    };
    player = {
      readPlayback: () => playback,
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      stepFrame: vi.fn(),
      setSpeed: vi.fn(),
    };
    root = createRoot(document.createElement("div"));
    act(() => {
      root.render(
        <Harness playerRef={{ current: player as VideoPlayerHandle }} />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  const press = (key: string, repeat = false) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key, repeat }));

  it("steps frames on comma and period without changing speed", () => {
    press(",");
    press(".");
    press(".", true);

    expect(player.stepFrame).toHaveBeenNthCalledWith(1, -1, false);
    expect(player.stepFrame).toHaveBeenNthCalledWith(2, 1, false);
    expect(player.stepFrame).toHaveBeenNthCalledWith(3, 1, true);
    expect(player.setSpeed).not.toHaveBeenCalled();
  });

  it("changes speed on angle brackets", () => {
    press(">");
    press("<");

    expect(player.setSpeed).toHaveBeenNthCalledWith(1, 1.2);
    expect(player.setSpeed).toHaveBeenNthCalledWith(2, 0.8);
    expect(player.stepFrame).not.toHaveBeenCalled();
  });

  it("drives a player that has no video element", () => {
    press("k");
    expect(player.play).toHaveBeenCalledTimes(1);

    playback = { ...playback!, paused: false };
    press("k");
    press("l");

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.seek).toHaveBeenCalledWith(16_000);
  });

  it("ignores keys while no media is mounted", () => {
    playback = null;
    press("k");
    press(">");

    expect(player.play).not.toHaveBeenCalled();
    expect(player.setSpeed).not.toHaveBeenCalled();
  });
});
