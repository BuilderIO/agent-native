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

  it("does not seek backward when a sampled pause is applied after rendering advances", () => {
    const sampledTime = 42.4708;
    const paused = updateNativePlaybackClock(
      { global: 0, local: 0, speed: 1, paused: false },
      0,
      { time: sampledTime, speed: 1, paused: true },
      42.52,
    );
    expect(paused.local).toBeCloseTo(42.52);
    expect(paused.paused).toBe(true);
  });

  it("does not seek backward when resuming a paused clock with an older saved sample", () => {
    const resumed = updateNativePlaybackClock(
      { global: 42.52, local: 42.52, speed: 1, paused: true },
      42.4708,
      { time: 42.4708, speed: 1, paused: false },
      44,
    );
    expect(resumed.local).toBeCloseTo(42.52);
    expect(resumed.paused).toBe(false);
  });

  it("keeps an explicit seek on a playback transition distinct from a toggle", () => {
    const sought = updateNativePlaybackClock(
      { global: 42.52, local: 42.52, speed: 1, paused: true },
      42.4708,
      { time: 0, speed: 1, paused: false },
      44,
      true,
    );
    expect(sought.local).toBe(0);
  });

  it("does not hide an unrevisioned backward time edit while playback keeps running", () => {
    const edited = updateNativePlaybackClock(
      { global: 42.52, local: 42.52, speed: 1, paused: false },
      42.4708,
      { time: 42, speed: 1, paused: false },
      42.52,
    );
    expect(edited.local).toBeLessThan(42.5);
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
