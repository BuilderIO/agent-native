import { describe, expect, it } from "vitest";

import {
  createRecordingDurationState,
  pauseRecordingDuration,
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
