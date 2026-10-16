import { describe, expect, it, vi } from "vitest";

import {
  type ExcludedRange,
  frameTimeMs,
  stepVideoFrame,
  VideoFrameClock,
} from "./video-frame-stepping";

type FrameCallback = (
  now: number,
  metadata: {
    mediaTime: number;
    presentedFrames: number;
    presentationTime: number;
  },
) => void;

/**
 * A paused video that, like Chromium, shows the frame whose span contains the
 * seek time, start included, and reports it through requestVideoFrameCallback.
 */
class FakeVideo {
  paused = true;
  seeking = false;
  /** Seeks start but never finish, as on a stalled network. */
  stalled = false;
  /** Report a seek done before presenting its frame, as Firefox may. */
  seekedFirst = false;
  /**
   * Runs `seeking` handlers this long after the seek starts, with the sought
   * frame presented in between, as Chromium sometimes does.
   */
  seekingHandlerLagMs = 0;
  duration: number;
  private time = 0;
  private presented = 0;
  private seeks = 0;
  private callbacks = new Map<number, FrameCallback>();
  private nextHandle = 1;
  private listeners = new Map<string, Set<(event: Event) => void>>();

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
    const lag = this.seekingHandlerLagMs;
    const startedAt = performance.now() - lag;
    this.emit("seeking", startedAt);
    if (this.stalled) return;
    const shownAt = lag ? startedAt + lag / 2 : undefined;
    const finish = () => {
      this.seeking = false;
      this.emit("seeked");
    };
    // Chromium presents the sought frame before it reports the seek done.
    const [first, second] = this.seekedFirst
      ? [finish, () => this.present(shownAt)]
      : [() => this.present(shownAt), finish];
    setTimeout(() => {
      if (seek !== this.seeks) return;
      first();
      setTimeout(() => {
        if (seek !== this.seeks) return;
        second();
      }, 0);
    }, 0);
  }

  /** Plays on to `seconds` and presents the frame there, without a seek. */
  playTo(seconds: number) {
    this.time = seconds;
    this.present();
  }

  /** Delivers a late callback for a frame presented at `presentedAt`. */
  reportFrame(mediaTime: number, presentedAt: number) {
    this.deliver(mediaTime, presentedAt);
  }

  private emit(type: string, timeStamp = performance.now()) {
    const event = { type, timeStamp } as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
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

  private present(presentationTime = performance.now()) {
    this.deliver(this.frames[this.shownFrame()], presentationTime);
  }

  private deliver(mediaTime: number, presentationTime: number) {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    this.presented++;
    for (const callback of callbacks) {
      callback(performance.now(), {
        mediaTime,
        presentedFrames: this.presented,
        presentationTime,
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
  const step = (direction: 1 | -1, stepSeekMs = seekMs) =>
    stepVideoFrame(
      { video, clock, seekMs: stepSeekMs, excludedRanges },
      direction,
    );
  const goToFrame = async (index: number) => {
    seekMs(frameTimeMs(frames[index]));
    await clock?.nextPresentedFrame();
  };
  return { fake, clock, step, goToFrame, seekMs };
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

describe("VideoFrameClock.presentedFrameTimeMs", () => {
  it("uses the frame before one that starts just before a cut", () => {
    // At 24 fps frame 11 starts at 458.33 ms; a cut from 459 ms leaves no
    // whole millisecond that shows it.
    const frames = frameStarts(24, 48);
    const { fake, clock } = setup(frames);
    fake.playTo(frames[10]);
    fake.playTo(frames[11] + 0.0005);

    expect(clock?.presentedFrameTimeMs([{ startMs: 459, endMs: 1500 }])).toBe(
      frameTimeMs(frames[10]),
    );
  });

  it("keeps the first frame after a cut that ends mid-frame", async () => {
    // Frame 36 starts at 1500 ms, inside the cut, and shows from its end.
    const frames = frameStarts(24, 48, true);
    const { clock, seekMs } = setup(frames);
    seekMs(1510);
    await clock?.settledFrameStart();

    expect(clock?.presentedFrameTimeMs([{ startMs: 500, endMs: 1510 }])).toBe(
      1500,
    );
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

  it("finds the next frame on a 60 fps clip that hasn't played", async () => {
    const { fake, step, goToFrame } = setup(frameStarts(60, 120));
    await goToFrame(10);

    const shown: number[] = [];
    for (const direction of [1, 1, -1] as const) {
      await step(direction);
      shown.push(fake.shownFrame());
    }

    expect(shown).toEqual([11, 12, 11]);
  });

  it("doesn't pass the frame after a short one", async () => {
    // Frame 4 lasts half as long as the rest, as in a variable-rate WebM.
    const frames = [0, 1, 2, 3, 4, 4.5, 5.5, 6.5].map((n) => n / 30);
    const { fake, step, goToFrame } = setup(frames);
    await goToFrame(3);

    const shown: number[] = [];
    // Steps back measure the clip's 1/30 s frame length.
    for (const direction of [-1, -1, -1, 1, 1, 1, 1, 1] as const) {
      await step(direction);
      shown.push(fake.shownFrame());
    }

    expect(shown).toEqual([2, 1, 0, 1, 2, 3, 4, 5]);
  });

  it("learns a short frame length from step backs", async () => {
    const { fake, step, goToFrame } = setup(frameStarts(60, 120));
    await goToFrame(10);

    const shown: number[] = [];
    for (const direction of [-1, -1, -1, 1, 1, 1, 1] as const) {
      await step(direction);
      shown.push(fake.shownFrame());
    }

    expect(shown).toEqual([9, 8, 7, 8, 9, 10, 11]);
  });

  it("isn't misled by one step back across a held frame", async () => {
    // A still screen from 0.5 s to 1 s, then 24 fps.
    const frames = [
      ...frameStarts(24, 13, true),
      ...Array.from({ length: 24 }, (_, i) => 1 + i / 24),
    ];
    const { fake, step, goToFrame } = setup(frames);
    await goToFrame(13);

    const shown: number[] = [];
    for (const direction of [-1, 1, 1, 1] as const) {
      await step(direction);
      shown.push(fake.shownFrame());
    }

    expect(shown).toEqual([12, 13, 14, 15]);
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

  it("steps past a still screen held longer than a few seconds", async () => {
    const frames = [...frameStarts(24, 25, true), 31, 31 + 1 / 24];
    const { fake, step, goToFrame } = setup(frames);
    await goToFrame(24);

    await step(1);

    expect(fake.shownFrame()).toBe(25);
  });

  it("leaves a seek made mid-step alone", async () => {
    // A screen recording holds a still screen from 1 s to 3 s.
    const frames = [...frameStarts(24, 25, true), 3, 3 + 1 / 24, 3 + 2 / 24];
    const { fake, step, goToFrame, seekMs } = setup(frames);
    await goToFrame(24);
    const userSeekMs = frameTimeMs(frames[27]);
    let probes = 0;

    const kept = await step(1, (ms) => {
      seekMs(ms);
      // The viewer clicks the scrubber while the second probe is in flight.
      if (++probes === 2) queueMicrotask(() => seekMs(userSeekMs));
    });

    expect(kept).toBe(false);
    expect(fake.shownFrame()).toBe(27);
  });

  it("leaves a seek made before the step reads the screen alone", async () => {
    const frames = frameStarts(24, 48, true);
    const { fake, step, goToFrame, seekMs } = setup(frames);
    await goToFrame(5);

    const stepping = step(1);
    // The viewer scrubs while the step waits for the last seek to settle.
    seekMs(frameTimeMs(frames[20]));

    expect(await stepping).toBe(false);
    expect(fake.shownFrame()).toBe(20);
  });

  it("doesn't step from a seek that never shows its frame", async () => {
    vi.useFakeTimers();
    try {
      const frames = frameStarts(24, 48, true);
      const { fake, step, seekMs } = setup(frames);
      fake.stalled = true;
      const soughtMs = frameTimeMs(frames[10]);
      seekMs(soughtMs);

      const stepping = step(1);
      await vi.advanceTimersByTimeAsync(5000);

      expect(await stepping).toBe(false);
      expect(fake.currentTime).toBe(soughtMs / 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a frame from before a seek that reports after it", async () => {
    const frames = frameStarts(24, 48, true);
    const { fake, clock, step, goToFrame, seekMs } = setup(frames);
    await goToFrame(5);
    await clock?.settledFrameStart();
    fake.seekedFirst = true;
    const shownBeforeSeek = performance.now() - 1;

    seekMs(frameTimeMs(frames[20]));
    fake.reportFrame(frames[5], shownBeforeSeek);
    await step(1);

    expect(fake.shownFrame()).toBe(21);
  });

  it("takes a seek's frame presented before its seeking handler ran", async () => {
    const frames = frameStarts(24, 48, true);
    const { fake, step, goToFrame } = setup(frames);
    await goToFrame(5);
    fake.seekingHandlerLagMs = 2;

    expect(await step(1)).toBe(true);
    expect(fake.shownFrame()).toBe(6);
  });

  it("steps onto the last frame before a cut, then across it", async () => {
    // Frame 11 (458 ms) shows for 7 ms before the cut, inside the first probe.
    const frames = frameStarts(24, 48, true);
    const { fake, step, goToFrame } = setup(frames, [
      { startMs: 465, endMs: 1500 },
    ]);
    await goToFrame(10);

    const shown: number[] = [];
    for (const direction of [1, 1, -1, -1] as const) {
      await step(direction);
      shown.push(fake.shownFrame());
    }

    expect(shown).toEqual([11, 36, 11, 10]);
  });

  it("finds the frames between a held frame and a cut", async () => {
    // A still screen from 1 s to 3 s, then frames until a cut at 3.1 s.
    const frames = [
      ...frameStarts(24, 25, true),
      ...Array.from({ length: 36 }, (_, i) => 3 + i / 24),
    ];
    const { fake, step, goToFrame } = setup(frames, [
      { startMs: 3100, endMs: 4000 },
    ]);
    await goToFrame(24);

    await step(1);

    expect(fake.shownFrame()).toBe(25);
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
    // Frame 30 starts at 1 s; its neighbours start at 0.9667 s and 1.0333 s.
    fake.currentTime = 1;
    const seeks: number[] = [];
    const target = {
      video,
      clock: null,
      seekMs: (ms: number) => seeks.push(ms),
      excludedRanges: [],
    };

    await stepVideoFrame(target, 1);
    await stepVideoFrame(target, -1);

    expect(seeks).toEqual([1034, 967]);
  });

  it("falls back to steps that wait for each seek to finish", async () => {
    const fake = new FakeVideo(frameStarts(30, 60), false);

    const kept = await stepVideoFrame(
      {
        video: fake as unknown as HTMLVideoElement,
        clock: null,
        seekMs: (ms) => {
          fake.currentTime = ms / 1000;
        },
        excludedRanges: [],
      },
      1,
    );

    expect(kept).toBe(true);
    expect(fake.seeking).toBe(false);
    expect(fake.shownFrame()).toBe(1);
  });

  it("doesn't keep a fallback step whose seek never finishes", async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeVideo(frameStarts(30, 60), false);
      fake.stalled = true;

      const stepping = stepVideoFrame(
        {
          video: fake as unknown as HTMLVideoElement,
          clock: null,
          seekMs: (ms) => {
            fake.currentTime = ms / 1000;
          },
          excludedRanges: [],
        },
        1,
      );
      await vi.advanceTimersByTimeAsync(5000);

      expect(await stepping).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a step back that clears a cut", async () => {
    const fake = new FakeVideo(frameStarts(30, 60), false);
    // Just after a cut from 0.5 s to 1.5 s.
    fake.currentTime = 1.5;
    const seeks: number[] = [];

    await stepVideoFrame(
      {
        video: fake as unknown as HTMLVideoElement,
        clock: null,
        seekMs: (ms) => seeks.push(ms),
        excludedRanges: [{ startMs: 500, endMs: 1500 }],
      },
      -1,
    );

    expect(seeks).toEqual([499]);
  });
});
