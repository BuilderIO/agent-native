import { describe, expect, it, vi } from "vitest";

import {
  grantRefreshDelay,
  mediaPlace,
  MIN_GRANT_REFRESH_DELAY_MS,
  swapMediaSource,
  youtubeEmbedSrc,
} from "./clip-media";

class FakeMedia extends EventTarget {
  currentTime = 0;
  paused = true;
  volume = 1;
  muted = false;
  playbackRate = 1;
  src = "";
  play = vi.fn(async () => {
    this.paused = false;
  });

  // Loading a source resets playback the way a browser does.
  load = vi.fn(() => {
    this.currentTime = 0;
    this.paused = true;
    this.playbackRate = 1;
  });
}

describe("grantRefreshDelay", () => {
  const now = Date.parse("2026-10-23T12:00:00.000Z");

  it("asks again 30 seconds before the grant runs out", () => {
    expect(grantRefreshDelay("2026-10-23T12:05:00.000Z", now)).toBe(270_000);
  });

  it("waits a little even when the grant is almost gone or unreadable", () => {
    expect(grantRefreshDelay("2026-10-23T12:00:10.000Z", now)).toBe(
      MIN_GRANT_REFRESH_DELAY_MS,
    );
    expect(grantRefreshDelay("soon", now)).toBe(MIN_GRANT_REFRESH_DELAY_MS);
  });
});

describe("swapMediaSource", () => {
  it("keeps the time, play state, volume and rate across the new source", () => {
    const media = new FakeMedia();
    Object.assign(media, {
      src: "https://clips.example.test/v?cg=1",
      currentTime: 42.5,
      paused: false,
      volume: 0.4,
      muted: true,
      playbackRate: 1.5,
    });

    swapMediaSource(
      media as unknown as HTMLMediaElement,
      "https://clips.example.test/v?cg=2",
    );
    expect(media.src).toBe("https://clips.example.test/v?cg=2");
    expect(media.load).toHaveBeenCalledTimes(1);

    media.dispatchEvent(new Event("loadedmetadata"));
    expect(media).toMatchObject({
      currentTime: 42.5,
      volume: 0.4,
      muted: true,
      playbackRate: 1.5,
    });
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it("leaves a paused Clip paused", () => {
    const media = new FakeMedia();
    Object.assign(media, { currentTime: 7, paused: true });

    swapMediaSource(
      media as unknown as HTMLMediaElement,
      "https://clips.example.test/v?cg=2",
    );
    media.dispatchEvent(new Event("loadedmetadata"));
    expect(media.currentTime).toBe(7);
    expect(media.play).not.toHaveBeenCalled();
  });

  it("restores only once", () => {
    const media = new FakeMedia();
    Object.assign(media, { currentTime: 7, paused: false });

    swapMediaSource(
      media as unknown as HTMLMediaElement,
      "https://clips.example.test/v?cg=2",
    );
    media.dispatchEvent(new Event("loadedmetadata"));
    media.currentTime = 20;
    media.dispatchEvent(new Event("loadedmetadata"));
    expect(media.currentTime).toBe(20);
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it("carries the reader's place through a source that failed before it loaded", () => {
    const media = new FakeMedia();
    Object.assign(media, {
      currentTime: 42.5,
      paused: false,
      volume: 0.4,
      playbackRate: 1.5,
    });

    swapMediaSource(
      media as unknown as HTMLMediaElement,
      "https://clips.example.test/v?cg=2",
    );
    swapMediaSource(
      media as unknown as HTMLMediaElement,
      "https://clips.example.test/v?cg=3",
    );
    media.dispatchEvent(new Event("loadedmetadata"));
    expect(media).toMatchObject({
      src: "https://clips.example.test/v?cg=3",
      currentTime: 42.5,
      volume: 0.4,
      playbackRate: 1.5,
    });
    expect(media.play).toHaveBeenCalledTimes(1);

    media.currentTime = 50;
    media.dispatchEvent(new Event("loadedmetadata"));
    expect(media.currentTime).toBe(50);
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it("starts from the reader's current place once the last source has loaded", () => {
    const media = new FakeMedia();
    Object.assign(media, { currentTime: 7, paused: false });

    swapMediaSource(
      media as unknown as HTMLMediaElement,
      "https://clips.example.test/v?cg=2",
    );
    media.dispatchEvent(new Event("loadedmetadata"));
    Object.assign(media, { currentTime: 30, paused: true });
    swapMediaSource(
      media as unknown as HTMLMediaElement,
      "https://clips.example.test/v?cg=3",
    );
    media.dispatchEvent(new Event("loadedmetadata"));
    expect(media.currentTime).toBe(30);
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it("puts a new element where an earlier one left off", () => {
    const earlier = new FakeMedia();
    Object.assign(earlier, { currentTime: 64, paused: false, volume: 0.3 });
    swapMediaSource(
      earlier as unknown as HTMLMediaElement,
      "https://clips.example.test/v?cg=2",
    );
    const place = mediaPlace(earlier as unknown as HTMLMediaElement);

    const next = new FakeMedia();
    swapMediaSource(
      next as unknown as HTMLMediaElement,
      "https://clips.example.test/v?cg=3",
      place,
    );
    next.dispatchEvent(new Event("loadedmetadata"));
    expect(next).toMatchObject({
      src: "https://clips.example.test/v?cg=3",
      currentTime: 64,
      volume: 0.3,
    });
    expect(next.play).toHaveBeenCalledTimes(1);
  });
});

describe("mediaPlace", () => {
  it("reads where the reader is once the source has loaded", () => {
    const media = new FakeMedia();
    Object.assign(media, { currentTime: 12, paused: true, playbackRate: 2 });
    expect(mediaPlace(media as unknown as HTMLMediaElement)).toEqual({
      currentTime: 12,
      paused: true,
      volume: 1,
      muted: false,
      playbackRate: 2,
    });
  });
});

describe("youtubeEmbedSrc", () => {
  it("plays a bare YouTube embed URL without cookies", () => {
    expect(youtubeEmbedSrc("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    );
  });

  it.each([
    null,
    "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.example/embed/dQw4w9WgXcQ",
    "javascript:alert(1)//https://www.youtube.com/embed/dQw4w9WgXcQ",
  ])("refuses %s", (url) => {
    expect(youtubeEmbedSrc(url)).toBeNull();
  });
});
