import { describe, expect, it } from "vitest";

import {
  type ExcludedRange,
  frameTimeMs,
  stepVideoFrame,
  VideoFrameClock,
} from "./video-frame-stepping";

type FrameCallback = (
  now: number,
  metadata: { mediaTime: number; presentedFrames: number },
) => void;

/**
 * A paused video that, like Chromium, shows the frame whose span contains the
 * seek time, start included, and reports it through requestVideoFrameCallback.
 */
class FakeVideo {
  paused = true;
  seeking = false;
  duration: number;
  private time = 0;
  private presented = 0;
  private seeks = 0;
  private callbacks = new Map<number, FrameCallback>();
  private nextHandle = 1;
  private listeners = new Map<string, Set<() => void>>();

  constructor(
    readonly frames: number[],
    readonly frameCallbacks = true,
  ) {
    this.duration = frames[frames.length - 1] + 0.1;
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(seconds: number) {
    this.time = seconds;
    this.seeking = true;
    const seek = ++this.seeks;
    this.emit("seeking");
    // Chromium presents the sought frame before it reports the seek done.
    setTimeout(() => {
      if (seek !== this.seeks) return;
      this.present();
      setTimeout(() => {
        if (seek !== this.seeks) return;
        this.seeking = false;
        this.emit("seeked");
      }, 0);
    }, 0);
  }

  private emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  get requestVideoFrameCallback() {
    if (!this.frameCallbacks) return undefined;
    return (callback: FrameCallback) => {
      const handle = this.nextHandle++;
      this.callbacks.set(handle, callback);
      return handle;
    };
  }

  cancelVideoFrameCallback(handle: number) {
    this.callbacks.delete(handle);
  }

  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  shownFrame(): number {
    let index = 0;
    for (let i = 0; i < this.frames.length; i++) {
      if (this.frames[i] <= this.time + 1e-9) index = i;
    }
    return index;
  }

  private present() {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    this.presented++;
    const mediaTime = this.frames[this.shownFrame()];
    for (const callback of callbacks) {
      callback(performance.now(), {
        mediaTime,
        presentedFrames: this.presented,
      });
    }
  }
}

function setup(frames: number[], excludedRanges: ExcludedRange[] = []) {
  const fake = new FakeVideo(frames);
  const video = fake as unknown as HTMLVideoElement;
  const clock = VideoFrameClock.attach(video);
  // Mirrors the player's seek: whole milliseconds, clamped, skipping cuts.
  const seekMs = (ms: number) => {
    let target = Math.floor(Math.max(0, Math.min(fake.duration * 1000, ms)));
    const cut = excludedRanges.find(
      (range) => target >= range.startMs && target < range.endMs,
    );
    if (cut) target = cut.endMs;
    fake.currentTime = target / 1000;
  };
  const step = (direction: 1 | -1) =>
    stepVideoFrame({ video, clock, seekMs, excludedRanges }, direction);
  const goToFrame = async (index: number) => {
    seekMs(frameTimeMs(frames[index]));
    await clock?.nextPresentedFrame();
  };
  return { fake, clock, step, goToFrame };
}

const frameStarts = (fps: number, count: number, round = false) =>
  Array.from({ length: count }, (_, i) =>
    round ? Math.round((i * 1000) / fps) / 1000 : i / fps,
  );

describe("frameTimeMs", () => {
  it("rounds a frame start up to a millisecond inside that frame", () => {
    expect(frameTimeMs(1 / 30)).toBe(34);
    expect(frameTimeMs(0.042)).toBe(42);
    expect(frameTimeMs(1)).toBe(1000);
    expect(frameTimeMs(0)).toBe(0);
  });
});

describe("stepVideoFrame", () => {
  it.each([
    ["24 fps WebM", frameStarts(24, 48, true)],
    ["30 fps MP4", frameStarts(30, 60)],
  ])(
    "steps one frame at a time and back to the start on %s",
    async (_, frames) => {
      const { fake, step, goToFrame } = setup(frames);
      await goToFrame(5);

      const forward: number[] = [];
      for (let i = 0; i < 10; i++) {
        await step(1);
        forward.push(fake.shownFrame());
      }
      const back: number[] = [];
      for (let i = 0; i < 10; i++) {
        await step(-1);
        back.push(fake.shownFrame());
      }

      expect(forward).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      expect(back).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    },
  );

  it("learns a short frame length from a step back", async () => {
    const { fake, step, goToFrame } = setup(frameStarts(60, 120));
    await goToFrame(10);

    await step(-1);
    const shown: number[] = [fake.shownFrame()];
    for (let i = 0; i < 3; i++) {
      await step(1);
      shown.push(fake.shownFrame());
    }

    expect(shown).toEqual([9, 10, 11, 12]);
  });

  it("stops at the first frame after a held frame", async () => {
    // A screen recording holds a still screen from 1 s to 3 s.
    const frames = [
      ...frameStarts(24, 25, true),
      3,
      3 + 1 / 24,
      3 + 2 / 24,
      3 + 3 / 24,
    ];
    const { fake, step, goToFrame } = setup(frames);
    await goToFrame(24);

    await step(1);
    expect(fake.shownFrame()).toBe(25);
    await step(1);
    expect(fake.shownFrame()).toBe(26);
    await step(-1);
    await step(-1);
    expect(fake.shownFrame()).toBe(24);
  });

  it("steps back over a cut to the frame before it", async () => {
    const frames = frameStarts(24, 48, true);
    const { fake, step, goToFrame } = setup(frames, [
      { startMs: 500, endMs: 1500 },
    ]);
    await goToFrame(36);

    await step(-1);

    expect(frames[fake.shownFrame()]).toBeLessThan(0.5);
    expect(fake.shownFrame()).toBe(11);
  });

  it("stays on the last frame", async () => {
    const frames = frameStarts(24, 10, true);
    const { fake, step, goToFrame } = setup(frames);
    await goToFrame(9);

    await step(1);

    expect(fake.shownFrame()).toBe(9);
  });

  it("falls back to a 1/30 s step without frame callbacks", async () => {
    const fake = new FakeVideo(frameStarts(30, 60), false);
    const video = fake as unknown as HTMLVideoElement;
    expect(VideoFrameClock.attach(video)).toBeNull();
    fake.currentTime = 1;
    const seeks: number[] = [];

    await stepVideoFrame(
      {
        video,
        clock: null,
        seekMs: (ms) => seeks.push(ms),
        excludedRanges: [],
      },
      1,
    );

    expect(seeks).toHaveLength(1);
    expect(seeks[0]).toBeCloseTo(1000 + 1000 / 30);
  });
});
