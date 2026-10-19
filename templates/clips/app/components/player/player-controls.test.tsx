// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { PlayerControls } from "./player-controls";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));

describe("docked player controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it.each([true, false])(
    "only suppresses marker previews when docked is %s",
    (docked) => {
      const noop = vi.fn();
      act(() =>
        root.render(
          <TooltipProvider>
            <PlayerControls
              docked={docked}
              isPlaying={false}
              durationMs={10_000}
              currentMs={0}
              volume={1}
              muted={false}
              speed={1}
              captionsOn={false}
              hasCaptions={false}
              isFullscreen={false}
              isPip={false}
              theaterMode={false}
              comments={[
                {
                  id: "comment-1",
                  authorEmail: "test@example.com",
                  content: "Check this moment",
                  videoTimestampMs: 1_000,
                },
              ]}
              onPlayPause={noop}
              onSeek={noop}
              onSeekRelative={noop}
              onVolumeChange={noop}
              onToggleMute={noop}
              onSpeedChange={noop}
              onToggleCaptions={noop}
              onTogglePip={noop}
              onToggleFullscreen={noop}
            />
          </TooltipProvider>,
        ),
      );
      const marker = container.querySelector<HTMLButtonElement>(
        '[aria-label="1 comment"]',
      )!;
      act(() =>
        marker.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
      );
      expect(!!container.querySelector("[data-player-comment-hover]")).toBe(
        !docked,
      );
      act(() => marker.click());
      expect(noop).toHaveBeenCalledWith(1_000);
    },
  );
});
