// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoPlayerHandle } from "@/components/player/video-player";

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
  let player: Pick<VideoPlayerHandle, "video" | "stepFrame" | "setSpeed">;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const video = document.createElement("video");
    video.playbackRate = 1;
    player = { video, stepFrame: vi.fn(), setSpeed: vi.fn() };
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
});
