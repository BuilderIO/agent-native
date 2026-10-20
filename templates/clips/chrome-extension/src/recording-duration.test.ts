import { describe, expect, it } from "vitest";

import {
  createRecordingDurationState,
  parseClipDurationLimitMs,
  pauseRecordingDuration,
  reachedClipDurationLimit,
  resumeRecordingDuration,
  startRecordingDuration,
} from "./recording-duration";

describe("recording duration", () => {
  it("excludes time spent paused", () => {
    let state = startRecordingDuration(1_000);
    state = pauseRecordingDuration(state, 31_000);
    state = resumeRecordingDuration(state, 391_000);
    state = pauseRecordingDuration(state, 441_000);

    expect(state).toEqual({ elapsedMs: 80_000, activeSinceMs: null });
  });

  it("freezes duration when recording stops so upload time is excluded", () => {
    let state = startRecordingDuration(1_000);
    state = pauseRecordingDuration(state, 81_000);

    const afterUploadDrain = pauseRecordingDuration(state, 111_000);
    expect(afterUploadDrain.elapsedMs).toBe(80_000);
  });

  it("keeps the elapsed duration when stopping while already paused", () => {
    let state = startRecordingDuration(1_000);
    state = pauseRecordingDuration(state, 41_000);

    state = pauseRecordingDuration(state, 401_000);
    expect(state.elapsedMs).toBe(40_000);
  });

  it("ignores duplicate transitions and backward clock movement", () => {
    let state = createRecordingDurationState();
    state = resumeRecordingDuration(state, 2_000);
    state = resumeRecordingDuration(state, 3_000);
    state = pauseRecordingDuration(state, 1_000);

    expect(state).toEqual({ elapsedMs: 0, activeSinceMs: null });
  });
});

describe("hosted clip duration limit", () => {
  it("stops an unpaused take at the cap and never when uncapped", () => {
    const state = startRecordingDuration(0);
    expect(reachedClipDurationLimit(state, 59_999, 60_000)).toBe(false);
    expect(reachedClipDurationLimit(state, 60_000, 60_000)).toBe(true);
    expect(reachedClipDurationLimit(state, 9_999_999, null)).toBe(false);
    expect(reachedClipDurationLimit(state, 9_999_999, undefined)).toBe(false);
  });

  it("does not count paused time toward the cap", () => {
    const paused = pauseRecordingDuration(startRecordingDuration(0), 50_000);
    expect(reachedClipDurationLimit(paused, 900_000, 60_000)).toBe(false);
    const resumed = resumeRecordingDuration(paused, 900_000);
    expect(reachedClipDurationLimit(resumed, 909_999, 60_000)).toBe(false);
    expect(reachedClipDurationLimit(resumed, 910_000, 60_000)).toBe(true);
  });

  it("treats anything but a positive number from create-recording as uncapped", () => {
    expect(parseClipDurationLimitMs(300_000)).toBe(300_000);
    expect(parseClipDurationLimitMs(null)).toBeNull();
    expect(parseClipDurationLimitMs(undefined)).toBeNull();
    expect(parseClipDurationLimitMs(0)).toBeNull();
    expect(parseClipDurationLimitMs("300000")).toBeNull();
  });
});
