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
