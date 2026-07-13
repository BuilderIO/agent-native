// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { VideoPlayer, type VideoPlayerHandle } from "./video-player";

vi.mock("@agent-native/core/client", () => ({
  // Re-exported by `@/lib/utils`, which video-player.tsx (and its children)
  // import `cn` from.
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  appBasePath: () => "",
  agentNativePath: (path: string) => path,
  captureClientException: vi.fn(),
  useT: () => (key: string) => key,
}));

// happy-dom's <video>/<audio> stub always reports `canPlayType() === ""`
// (unimplemented), which would make the component's Safari-webm
// `unsupportedFormat` probe (see video-player.tsx) treat every source as
// undecodable and render the "unsupported format" placeholder instead of a
// real <video> element. Stub it to report support so the real element mounts
// — `play()`/`pause()` themselves are implemented natively by happy-dom
// (they flip `paused` and synchronously dispatch `play`/`playing`/`pause`),
// so no further HTMLMediaElement stubbing is needed.
let canPlayTypeSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  canPlayTypeSpy = vi
    .spyOn(HTMLMediaElement.prototype, "canPlayType")
    .mockReturnValue("probably");
});

afterAll(() => {
  canPlayTypeSpy.mockRestore();
});

describe("VideoPlayer playback", () => {
  let container: HTMLDivElement;
  let root: Root;
  let handleRef: { current: VideoPlayerHandle | null };
  let onPlay = vi.fn<() => void>();
  let onPause = vi.fn<() => void>();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    handleRef = { current: null };
    onPlay = vi.fn<() => void>();
    onPause = vi.fn<() => void>();

    act(() => {
      root.render(
        <TooltipProvider>
          <VideoPlayer
            ref={(instance) => {
              handleRef.current = instance;
            }}
            recordingId="recording-1"
            videoUrl="https://cdn.example.com/clip.webm"
            durationMs={10_000}
            onPlay={onPlay}
            onPause={onPause}
          />
        </TooltipProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function getPlayerSurface(): HTMLDivElement {
    const surface = container.firstElementChild;
    if (!(surface instanceof HTMLDivElement)) {
      throw new Error("player surface root <div> did not render");
    }
    return surface;
  }

  function getVideo(): HTMLVideoElement {
    const video = container.querySelector("video");
    if (!video) {
      throw new Error(
        "no <video> element rendered — unsupportedFormat fallback shown instead",
      );
    }
    return video;
  }

  it("toggles play/pause on the real video element when the surface is clicked", () => {
    const surface = getPlayerSurface();
    const video = getVideo();

    expect(video.paused).toBe(true);
    expect(handleRef.current?.video?.paused).toBe(true);

    act(() => {
      surface.click();
    });

    expect(video.paused).toBe(false);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
    expect(handleRef.current?.video?.paused).toBe(false);

    act(() => {
      surface.click();
    });

    expect(video.paused).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("keeps the center play control actionable before media readiness events fire", () => {
    const video = getVideo();
    const centerPlay = container.querySelector<HTMLButtonElement>(
      'button[aria-label="videoPlayer.playClip"]',
    );

    // Mobile Safari can remain at HAVE_NOTHING until playback is initiated,
    // so loadeddata/canplay may not arrive before the user needs this control.
    expect(video.readyState).toBe(0);
    expect(container.textContent).not.toContain("Preparing clip");
    expect(centerPlay).not.toBeNull();

    act(() => {
      centerPlay?.click();
    });

    expect(video.paused).toBe(false);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("suppresses the synthetic click that follows a touch tap instead of double-toggling playback", () => {
    const surface = getPlayerSurface();
    const video = getVideo();

    act(() => {
      surface.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "touch",
          button: 0,
          clientX: 40,
          clientY: 40,
        }),
      );
      surface.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "touch",
          button: 0,
          clientX: 40,
          clientY: 40,
        }),
      );
    });

    // A touch tap on the surface only reveals controls (matching native
    // mobile players) — it must not start playback on its own.
    expect(video.paused).toBe(true);
    expect(onPlay).not.toHaveBeenCalled();

    // Real browsers fire a synthetic "click" immediately after a touch tap.
    // The component must swallow exactly that one click rather than treating
    // it as a second, independent activation.
    act(() => {
      surface.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(video.paused).toBe(true);
    expect(onPlay).not.toHaveBeenCalled();

    // A later, unrelated real click still toggles playback normally — proving
    // the suppression is a one-shot flag consumed by the synthetic click, not
    // a broken click handler.
    act(() => {
      surface.click();
    });

    expect(video.paused).toBe(false);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
