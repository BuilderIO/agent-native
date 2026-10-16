export type RecordingDurationState = {
  elapsedMs: number;
  activeSinceMs: number | null;
};

export function createRecordingDurationState(): RecordingDurationState {
  return { elapsedMs: 0, activeSinceMs: null };
}

export function startRecordingDuration(nowMs: number): RecordingDurationState {
  return { elapsedMs: 0, activeSinceMs: nowMs };
}

export function pauseRecordingDuration(
  state: RecordingDurationState,
  nowMs: number,
): RecordingDurationState {
  if (state.activeSinceMs === null) return state;
  return {
    elapsedMs:
      state.elapsedMs + Math.max(0, Math.round(nowMs - state.activeSinceMs)),
    activeSinceMs: null,
  };
}

export function resumeRecordingDuration(
  state: RecordingDurationState,
  nowMs: number,
): RecordingDurationState {
  if (state.activeSinceMs !== null) return state;
  return { ...state, activeSinceMs: nowMs };
}

/** True once an unpaused take has run to the hosted per-clip cap. `null`
 * (own storage) or a missing cap never stops a take. */
export function reachedClipDurationLimit(
  state: RecordingDurationState,
  nowMs: number,
  maxClipDurationMs: number | null | undefined,
): boolean {
  if (
    typeof maxClipDurationMs !== "number" ||
    !Number.isFinite(maxClipDurationMs) ||
    maxClipDurationMs <= 0 ||
    state.activeSinceMs === null
  ) {
    return false;
  }
  return (
    state.elapsedMs + Math.max(0, nowMs - state.activeSinceMs) >=
    maxClipDurationMs
  );
}

/** The create-recording response is authoritative: anything but a positive
 * finite number (null for own storage, absent on older servers) is uncapped. */
export function parseClipDurationLimitMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
