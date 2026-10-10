import { describe, expect, it } from "vitest";

import { updateNativePlaybackClock } from "./native-playback-clock";

describe("native playback anchors", () => {
  it("rejects a derived f32 overflow while preserving the old clock", () => {
    const clock = { global: 0, local: 2e38, speed: 2e38, paused: false };
    const before = { ...clock };
    expect(() =>
      updateNativePlaybackClock(
        clock,
        0,
        { time: 0, speed: 1, paused: false },
        1,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "native-uniform-timing-invalid",
        field: "time",
      }),
    );
    expect(clock).toEqual(before);
  });

  it.each(["time", "speed"] as const)(
    "rejects authored f32 overflow %s before returning a next clock",
    (field) => {
      expect(() =>
        updateNativePlaybackClock(
          { global: 0, local: 0, speed: 1, paused: false },
          0,
          { time: 0, speed: 1, paused: false, [field]: 1e40 },
          0,
        ),
      ).toThrowError(
        expect.objectContaining({ code: "native-uniform-timing-invalid" }),
      );
    },
  );

  it("persists the captured local time across pause and resume without doubling the offset", () => {
    const running = { global: 0, local: 0, speed: 1, paused: false };
    const paused = updateNativePlaybackClock(
      running,
      0,
      { time: 2.5, speed: 1, paused: true },
      2.5,
    );
    expect(paused.local).toBe(2.5);
    const resumed = updateNativePlaybackClock(
      paused,
      2.5,
      { time: 2.5, speed: 1, paused: false },
      4,
    );
    expect(resumed.local).toBe(2.5);
    expect(resumed.global).toBe(4);
  });

  it("keeps a running phase continuous when speed changes without a time edit", () => {
    const next = updateNativePlaybackClock(
      { global: 1, local: 2, speed: 1, paused: false },
      0,
      { time: 0, speed: 2, paused: false },
      3,
    );
    expect(next.local).toBe(4);
    expect(next.speed).toBe(2);
  });

  it("seeks the selected local playhead on a repeated reset while playback is running", () => {
    const first = updateNativePlaybackClock(
      { global: 1, local: 2, speed: 1, paused: false },
      0,
      { time: 0, speed: 1, paused: false },
      3,
      true,
    );
    expect(first.local).toBe(0);
    expect(first.global).toBe(3);
    const repeated = updateNativePlaybackClock(
      first,
      0,
      { time: 0, speed: 1, paused: false },
      5,
      true,
    );
    expect(repeated.local).toBe(0);
    expect(repeated.global).toBe(5);
  });
});
