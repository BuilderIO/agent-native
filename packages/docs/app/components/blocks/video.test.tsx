// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VideoBlock } from "./video";
import type { VideoData } from "./video.config";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function baseData(overrides: Partial<VideoData> = {}): VideoData {
  return {
    src: "/videos/demo.mp4",
    alt: "Demo video",
    autoplay: true,
    ...overrides,
  };
}

function stubMatchMedia(matches: boolean) {
  let onChange: ((event: MediaQueryListEvent) => void) | undefined;
  const query = {
    matches,
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        onChange = listener;
      },
    ),
    removeEventListener: vi.fn(),
  };

  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(query));

  return {
    setMatches(next: boolean) {
      query.matches = next;
      onChange?.({ matches: next } as MediaQueryListEvent);
    },
  };
}

describe("VideoBlock autoplay", () => {
  it("never emits autoplay in the pre-hydration SSR markup, even when requested", () => {
    // No `window`/`matchMedia` at all during SSR — the reduced-motion
    // preference cannot be known yet, so autoplay must not appear in the
    // markup a browser parses before React's effect has a chance to run.
    // `renderToStaticMarkup` emits boolean attributes camelCased
    // (`autoPlay=""`), so match case-insensitively rather than assuming the
    // lowercase HTML spelling.
    const html = renderToStaticMarkup(
      <VideoBlock data={baseData()} ctx={{}} blockId="video" />,
    );
    expect(html).not.toMatch(/autoplay/i);
    expect(html).toMatch(/playsinline/i);
  });

  it("keeps autoplay off once resolved to prefers-reduced-motion", async () => {
    stubMatchMedia(true);
    const { container } = render(
      <VideoBlock data={baseData()} ctx={{}} blockId="video" />,
    );

    await waitFor(() => {
      const video = container.querySelector("video");
      expect(video?.hasAttribute("autoplay")).toBe(false);
      expect(video?.hasAttribute("playsinline")).toBe(true);
      // `muted` is a live media property React sets directly, not an
      // attribute — assert via the element property, not `hasAttribute`.
      expect((video as HTMLVideoElement | null)?.muted).toBe(false);
    });
  });

  it("turns autoplay on only after resolving that reduced motion is not requested", async () => {
    stubMatchMedia(false);
    const { container } = render(
      <VideoBlock data={baseData()} ctx={{}} blockId="video" />,
    );

    await waitFor(() => {
      const video = container.querySelector("video");
      expect(video?.hasAttribute("autoplay")).toBe(true);
      expect(video?.hasAttribute("playsinline")).toBe(true);
      expect((video as HTMLVideoElement | null)?.muted).toBe(true);
    });
  });

  it("pauses an autoplaying video if reduced motion is enabled at runtime", async () => {
    const media = stubMatchMedia(false);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const { container } = render(
      <VideoBlock data={baseData()} ctx={{}} blockId="video" />,
    );

    await waitFor(() => {
      expect(container.querySelector("video")?.hasAttribute("autoplay")).toBe(
        true,
      );
    });

    act(() => media.setMatches(true));

    await waitFor(() => {
      const video = container.querySelector("video");
      expect(pause).toHaveBeenCalledOnce();
      expect(video?.hasAttribute("autoplay")).toBe(false);
      expect(video?.hasAttribute("playsinline")).toBe(true);
      expect((video as HTMLVideoElement | null)?.muted).toBe(false);
    });
  });

  it("never autoplays when the caller did not request it, regardless of motion preference", async () => {
    stubMatchMedia(false);
    const { container } = render(
      <VideoBlock
        data={baseData({ autoplay: false })}
        ctx={{}}
        blockId="video"
      />,
    );

    await waitFor(() => {
      const video = container.querySelector("video");
      expect(video?.hasAttribute("autoplay")).toBe(false);
    });
  });
});
