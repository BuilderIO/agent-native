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

import { clampSeek, VideoPlayer, type VideoPlayerHandle } from "./video-player";

vi.mock("@agent-native/core/client/analytics", () => ({
  // Re-exported by `@/lib/utils`, which video-player.tsx (and its children)
  // import `cn` from.
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  captureClientException: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  // Pulled in transitively by PlaybackCommentOverlay's avatar lookup.
  useAvatarUrl: () => null,
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
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
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ playbackPosition: null }),
      }),
    );
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
    vi.useRealTimers();
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

  function getPlayerControls(): HTMLDivElement {
    const scrubber = container.querySelector<HTMLElement>(
      "[data-player-scrubber]",
    );
    const controls = scrubber?.parentElement?.parentElement;
    if (!(controls instanceof HTMLDivElement)) {
      throw new Error("player controls did not render");
    }
    return controls;
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
    const playIcon = centerPlay?.querySelector("svg");

    // Mobile Safari can remain at HAVE_NOTHING until playback is initiated,
    // so loadeddata/canplay may not arrive before the user needs this control.
    expect(video.readyState).toBe(0);
    expect(container.textContent).not.toContain("Preparing clip");
    expect(centerPlay).not.toBeNull();
    expect(playIcon).not.toBeNull();
    expect(playIcon?.getAttribute("class")).not.toContain("ml-[6%]");

    act(() => {
      centerPlay?.click();
    });

    expect(video.paused).toBe(false);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("keeps paused progress visible and interactive after the idle timeout", () => {
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    const controls = getPlayerControls();
    expect(controls.className).toContain("z-10");
    expect(controls.className).toContain("opacity-100");
    expect(controls.className).not.toContain("pointer-events-none");
  });

  it("hides playback comments while the end CTA is visible", () => {
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
            persistPlaybackPosition={false}
            comments={[
              {
                id: "comment-end",
                content: "This should stay below the CTA.",
                videoTimestampMs: 9_900,
              },
            ]}
            cta={{
              id: "cta-1",
              label: "Visit site",
              url: "https://example.com",
              color: "#000000",
              placement: "end",
            }}
          />
        </TooltipProvider>,
      );
    });

    act(() => {
      handleRef.current?.seek(9_900);
    });

    expect(
      container.querySelector("[data-player-playback-comment]"),
    ).toBeNull();
    expect(
      container.querySelector<HTMLElement>("[data-player-end-cta]")?.style
        .zIndex,
    ).toBe("60");
    expect(container.textContent).toContain("Visit site");
  });

  it("keeps an active marker hover preview above the playback comment", () => {
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
            persistPlaybackPosition={false}
            comments={[
              {
                id: "comment-active",
                content: "This is active.",
                videoTimestampMs: 1_000,
              },
            ]}
          />
        </TooltipProvider>,
      );
    });

    act(() => {
      handleRef.current?.seek(1_000);
    });

    const marker = container.querySelector<HTMLButtonElement>(
      '[aria-label="1 comment"]',
    );
    act(() => {
      marker?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const hoverPreview = container.querySelector("[data-player-comment-hover]");
    const playbackComment = container.querySelector(
      "[data-player-playback-comment]",
    );
    expect(hoverPreview).not.toBeNull();
    expect(playbackComment).not.toBeNull();
    expect(hoverPreview?.className).toContain("z-50");
    expect(playbackComment?.className).toContain("z-40");
    expect(getPlayerControls().className).not.toContain("z-20");
  });

  it("keeps throughout CTAs above playback comments", () => {
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
            persistPlaybackPosition={false}
            comments={[
              {
                id: "comment-throughout",
                content: "This is active.",
                videoTimestampMs: 1_000,
              },
            ]}
            cta={{
              id: "cta-throughout",
              label: "Visit site",
              url: "https://example.com",
              color: "#000000",
              placement: "throughout",
            }}
          />
        </TooltipProvider>,
      );
    });

    act(() => {
      handleRef.current?.seek(1_000);
    });

    const cta = container.querySelector<HTMLAnchorElement>(
      'a[href="https://example.com"]',
    );
    expect(cta?.parentElement?.className).toContain("z-50");
    expect(
      container.querySelector("[data-player-playback-comment]"),
    ).not.toBeNull();
  });

  it("keeps the pause control visible on mobile after the idle timeout", () => {
    const video = getVideo();
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: false,
    });

    act(() => {
      video.dispatchEvent(new Event("play"));
      vi.advanceTimersByTime(2_000);
    });

    const controls = getPlayerControls();
    expect(controls.className).toContain("opacity-100");
    expect(controls.className).toContain("sm:pointer-events-none");
    expect(
      container.querySelector('button[aria-label="Pause"]'),
    ).not.toBeNull();
  });

  it("keeps owner playback on the same-origin media request path", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <VideoPlayer
            recordingId="recording-1"
            role="owner"
            videoUrl="/api/video/recording-1"
            durationMs={10_000}
          />
        </TooltipProvider>,
      );
    });

    const video = getVideo();
    expect(video.hasAttribute("crossorigin")).toBe(false);

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="videoPlayer.playClip"]',
        )
        ?.click();
    });

    expect(video.paused).toBe(false);
  });

  it("reloads stable media URLs when the stored media version changes", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <VideoPlayer
            recordingId="recording-1"
            videoUrl="/api/video/recording-1"
            videoFormat="webm"
            mediaVersion="raw"
            durationMs={10_000}
          />
        </TooltipProvider>,
      );
    });

    expect(getVideo().getAttribute("src")).toContain("media=raw");

    act(() => {
      root.render(
        <TooltipProvider>
          <VideoPlayer
            recordingId="recording-1"
            videoUrl="/api/video/recording-1"
            videoFormat="webm"
            mediaVersion="repaired"
            durationMs={10_000}
          />
        </TooltipProvider>,
      );
    });

    expect(getVideo().getAttribute("src")).toContain("media=repaired");
  });

  it("uses an updated timestamp as the media version when the replacement size is unchanged", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <VideoPlayer
            recordingId="recording-1"
            videoUrl="/api/video/recording-1"
            videoFormat="webm"
            mediaVersion="2026-08-13T12:00:00.000Z"
            durationMs={10_000}
          />
        </TooltipProvider>,
      );
    });

    expect(getVideo().getAttribute("src")).toContain(
      "media=2026-08-13T12%3A00%3A00.000Z",
    );
  });

  it("starts after an intro cut instead of rewinding into the excluded range", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <VideoPlayer
            recordingId="recording-1"
            videoUrl="https://cdn.example.com/clip.webm"
            durationMs={10_000}
            editsJson={JSON.stringify({
              version: 1,
              trims: [{ startMs: 0, endMs: 3_000, excluded: true }],
              blurs: [],
            })}
          />
        </TooltipProvider>,
      );
    });

    const video = getVideo();
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 10,
    });

    act(() => {
      video.dispatchEvent(new Event("loadeddata"));
    });
    expect(video.currentTime).toBe(3);

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="videoPlayer.playClip"]',
        )
        ?.click();
    });

    expect(video.currentTime).toBe(3);
    expect(video.paused).toBe(false);
  });

  it("shows the edited duration without exposing cut ranges", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <VideoPlayer
            recordingId="recording-1"
            videoUrl="https://cdn.example.com/clip.webm"
            durationMs={10_000}
            editsJson={JSON.stringify({
              version: 1,
              trims: [{ startMs: 2_000, endMs: 4_000, excluded: true }],
              blurs: [],
            })}
          />
        </TooltipProvider>,
      );
    });

    expect(container.querySelector('[title^="Cut:"]')).toBeNull();
    expect(container.textContent).toContain("0:00/0:08");
    expect(container.textContent).not.toContain("0:00/0:10");
    expect(container.textContent).not.toContain("10 sec");
  });

  it("reports native playback time directly on the original timeline", () => {
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
            editsJson={JSON.stringify({
              version: 1,
              trims: [{ startMs: 2_000, endMs: 4_000, excluded: true }],
              blurs: [],
            })}
          />
        </TooltipProvider>,
      );
    });

    const video = getVideo();
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 6,
    });

    expect(handleRef.current?.getCurrentOriginalMs()).toBe(6_000);
  });

  it("reads the latest Loom position from the imperative handle", () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <VideoPlayer
            ref={(instance) => {
              handleRef.current = instance;
            }}
            recordingId="recording-1"
            videoUrl="https://www.loom.com/share/loom-recording"
            embedProvider="loom"
            durationMs={10_000}
          />
        </TooltipProvider>,
      );
    });

    act(() => {
      handleRef.current?.seek(4_000);
    });

    expect(handleRef.current?.getCurrentOriginalMs()).toBe(4_000);
  });

  it("stops a hung play attempt and leaves playback retryable", () => {
    const video = getVideo();
    const playSpy = vi
      .spyOn(video, "play")
      .mockReturnValue(new Promise<void>(() => {}));
    const pauseSpy = vi.spyOn(video, "pause");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const centerPlay = container.querySelector<HTMLButtonElement>(
      'button[aria-label="videoPlayer.playClip"]',
    );

    act(() => {
      centerPlay?.click();
    });
    expect(container.textContent).toContain("Starting playback");

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(container.textContent).not.toContain("Starting playback");
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "Playback is taking too long to start. Try again.",
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[clips] playback issue: play-start-timeout",
      expect.objectContaining({ recordingId: "recording-1" }),
    );

    const retry = container.querySelector<HTMLButtonElement>(
      'button[aria-label="videoPlayer.playClip"]',
    );
    act(() => {
      retry?.click();
    });

    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Starting playback");
  });

  it("shows buffering instead of starting playback after playback has begun", async () => {
    const video = getVideo();
    const centerPlay = container.querySelector<HTMLButtonElement>(
      'button[aria-label="videoPlayer.playClip"]',
    );

    await act(async () => {
      centerPlay?.click();
      await Promise.resolve();
    });

    const playSpy = vi
      .spyOn(video, "play")
      .mockReturnValue(new Promise<void>(() => {}));

    act(() => {
      void handleRef.current?.play();
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Buffering");
    expect(container.textContent).not.toContain("Starting playback");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    const controls = getPlayerControls();
    expect(controls.className).toContain("opacity-100");
    expect(controls.className).not.toContain("pointer-events-none");
  });

  it.each(["AbortError", "NotAllowedError"])(
    "keeps %s play rejections as retryable non-errors",
    async (name) => {
      const video = getVideo();
      vi.spyOn(video, "play").mockRejectedValue(
        new DOMException("Expected playback rejection", name),
      );
      const centerPlay = container.querySelector<HTMLButtonElement>(
        'button[aria-label="videoPlayer.playClip"]',
      );

      await act(async () => {
        centerPlay?.click();
        await Promise.resolve();
      });
      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(container.textContent).not.toContain("Starting playback");
      expect(container.textContent).not.toContain("Could not start playback");
      expect(container.textContent).not.toContain(
        "Playback is taking too long to start",
      );
      expect(
        container.querySelector('button[aria-label="videoPlayer.playClip"]'),
      ).not.toBeNull();
    },
  );

  it("rewinds an ended autoplay player when replay is requested", () => {
    const video = getVideo();
    Object.defineProperty(video, "ended", {
      configurable: true,
      value: true,
    });
    video.currentTime = 10;

    act(() => {
      void handleRef.current?.play();
    });

    expect(video.currentTime).toBe(0);
    expect(video.paused).toBe(false);
  });

  it("replays from the start when the surface is clicked after the clip ended", () => {
    const surface = getPlayerSurface();
    const video = getVideo();

    act(() => {
      surface.click();
    });
    expect(video.paused).toBe(false);

    // Reaching end of stream can fire "ended" while the browser leaves paused
    // false (MSE end-of-stream / DB-duration mismatch). The play button must
    // still restart from the beginning rather than pausing a finished clip.
    video.currentTime = 10;
    Object.defineProperty(video, "ended", { configurable: true, value: true });
    act(() => {
      video.dispatchEvent(new Event("ended"));
    });

    act(() => {
      surface.click();
    });

    expect(video.currentTime).toBe(0);
    expect(video.paused).toBe(false);
  });

  it("toggles playback on touch taps and suppresses the synthetic follow-up click", () => {
    const surface = getPlayerSurface();
    const video = getVideo();

    act(() => {
      surface.click();
    });
    expect(video.paused).toBe(false);

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

    expect(video.paused).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(1);

    // Real browsers fire a synthetic "click" immediately after a touch tap.
    // The component must swallow exactly that one click rather than treating
    // it as a second, independent activation.
    act(() => {
      surface.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(video.paused).toBe(true);
    expect(onPlay).toHaveBeenCalledOnce();

    // A later, unrelated real click still toggles playback normally — proving
    // the suppression is a one-shot flag consumed by the synthetic click, not
    // a broken click handler.
    act(() => {
      surface.click();
    });

    expect(video.paused).toBe(false);
    expect(onPlay).toHaveBeenCalledTimes(2);
  });

  it("uses WebKit video fullscreen when the player container cannot enter fullscreen", () => {
    const surface = getPlayerSurface();
    const video = getVideo();
    const enterFullscreen = vi.fn();

    Object.defineProperty(surface, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(video, "webkitEnterFullscreen", {
      configurable: true,
      value: enterFullscreen,
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Fullscreen (F)"]')
        ?.click();
    });

    expect(enterFullscreen).toHaveBeenCalledTimes(1);
  });

  it("prefers WebKit video fullscreen when the document API is unavailable", () => {
    const surface = getPlayerSurface();
    const video = getVideo();
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const enterFullscreen = vi.fn();

    Object.defineProperty(surface, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(video, "webkitEnterFullscreen", {
      configurable: true,
      value: enterFullscreen,
    });
    const fullscreenEnabledDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "fullscreenEnabled",
    );
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: false,
    });

    try {
      act(() => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Fullscreen (F)"]',
          )
          ?.click();
      });

      expect(requestFullscreen).not.toHaveBeenCalled();
      expect(enterFullscreen).toHaveBeenCalledTimes(1);
    } finally {
      if (fullscreenEnabledDescriptor) {
        Object.defineProperty(
          document,
          "fullscreenEnabled",
          fullscreenEnabledDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "fullscreenEnabled");
      }
    }
  });

  it("retries video fullscreen when a mobile container request is a no-op", async () => {
    const surface = getPlayerSurface();
    const video = getVideo();
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const enterFullscreen = vi.fn();

    Object.defineProperty(surface, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(video, "webkitEnterFullscreen", {
      configurable: true,
      value: enterFullscreen,
    });
    const fullscreenEnabledDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "fullscreenEnabled",
    );
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: true,
    });

    try {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Fullscreen (F)"]',
          )
          ?.click();
        await Promise.resolve();
      });

      expect(requestFullscreen).toHaveBeenCalledTimes(1);
      expect(enterFullscreen).toHaveBeenCalledTimes(1);
    } finally {
      if (fullscreenEnabledDescriptor) {
        Object.defineProperty(
          document,
          "fullscreenEnabled",
          fullscreenEnabledDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "fullscreenEnabled");
      }
    }
  });

  it("uses a fixed viewport when fullscreen APIs are unavailable", () => {
    const surface = getPlayerSurface();
    const video = getVideo();

    Object.defineProperty(surface, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(video, "webkitEnterFullscreen", {
      configurable: true,
      value: undefined,
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Fullscreen (F)"]')
        ?.click();
    });

    expect(surface.className).toContain("fixed");
    expect(surface.className).toContain("h-dvh");
  });
});

describe("clampSeek", () => {
  const videoWith = (duration: number): HTMLVideoElement =>
    ({ duration, seekable: { length: 0 } }) as unknown as HTMLVideoElement;

  it("returns integer millisecond inputs unchanged", () => {
    const v = videoWith(600);
    // Clamping used to route through seconds (ms / 1000 -> Math.floor(sec *
    // 1000)), which loses 1ms for ~1% of integers. The timeupdate handler
    // treated that delta as a real seek target and pulled playback backwards,
    // flushing the decoder and replaying the last fraction of a second.
    for (let ms = 0; ms <= 600_000; ms++) {
      if (clampSeek(ms, v, 600_000) !== ms) {
        throw new Error(`clampSeek(${ms}) === ${clampSeek(ms, v, 600_000)}`);
      }
    }
    expect(clampSeek(1001, v, 600_000)).toBe(1001);
  });

  it("clamps past the end to the resolved duration", () => {
    const v = videoWith(600);
    expect(clampSeek(700_000, v, 600_000)).toBe(600_000);
  });

  it("falls back to video duration, then seekable, when duration is unresolved", () => {
    expect(clampSeek(700_000, videoWith(600), 0)).toBe(600_000);

    const seekableOnly = {
      duration: Number.POSITIVE_INFINITY,
      seekable: { length: 1, end: () => 30 },
    } as unknown as HTMLVideoElement;
    expect(clampSeek(90_000, seekableOnly, 0)).toBe(30_000);
  });

  it("floors a fractional bound rather than exceeding it", () => {
    expect(clampSeek(90_000, videoWith(30.0005), 0)).toBe(30_000);
  });

  it("never returns a negative time", () => {
    expect(clampSeek(-5, videoWith(600), 600_000)).toBe(0);
  });
});
