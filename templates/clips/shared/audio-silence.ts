/** Signal-only capture diagnostics. This does not infer whether someone meant to speak. */
export const SILENCE_THRESHOLD_DB = -70;
export const SUSTAINED_SILENCE_MS = 10_000;

export type AudioSignalEvidence = {
  sampleCount: number;
  silentSampleCount: number;
  durationMs: number;
  silentDurationMs: number;
  peakDb: number | null;
  meanDb: number | null;
  thresholdDb: number;
};

export type AudioSilenceState = {
  startedAtMs: number | null;
  samples: number;
  silentSamples: number;
  silentStartedAtMs: number | null;
  longestSilentMs: number;
  peakDb: number | null;
  totalDb: number;
};

export function createAudioSilenceState(): AudioSilenceState {
  return {
    startedAtMs: null,
    samples: 0,
    silentSamples: 0,
    silentStartedAtMs: null,
    longestSilentMs: 0,
    peakDb: null,
    totalDb: 0,
  };
}

export function recordAudioSignalSample(
  state: AudioSilenceState,
  db: number,
  nowMs: number,
): AudioSilenceState {
  const startedAtMs = state.startedAtMs ?? nowMs;
  const silent = db <= SILENCE_THRESHOLD_DB;
  const silentStartedAtMs = silent ? (state.silentStartedAtMs ?? nowMs) : null;
  const currentSilentMs =
    silentStartedAtMs === null ? 0 : nowMs - silentStartedAtMs;
  return {
    startedAtMs,
    samples: state.samples + 1,
    silentSamples: state.silentSamples + (silent ? 1 : 0),
    silentStartedAtMs,
    longestSilentMs: Math.max(state.longestSilentMs, currentSilentMs),
    peakDb: state.peakDb === null ? db : Math.max(state.peakDb, db),
    totalDb: state.totalDb + db,
  };
}

export function audioSignalEvidence(
  state: AudioSilenceState,
  nowMs: number,
): AudioSignalEvidence | null {
  if (state.startedAtMs === null || state.samples === 0) return null;
  const silentDurationMs = Math.max(
    state.longestSilentMs,
    state.silentStartedAtMs === null ? 0 : nowMs - state.silentStartedAtMs,
  );
  return {
    sampleCount: state.samples,
    silentSampleCount: state.silentSamples,
    durationMs: Math.max(0, nowMs - state.startedAtMs),
    silentDurationMs,
    peakDb: state.peakDb,
    meanDb: state.totalDb / state.samples,
    thresholdDb: SILENCE_THRESHOLD_DB,
  };
}

export function isSustainedDigitalSilence(
  evidence: AudioSignalEvidence | null,
): boolean {
  return Boolean(
    evidence &&
    evidence.silentDurationMs >= SUSTAINED_SILENCE_MS &&
    evidence.peakDb !== null &&
    evidence.peakDb <= evidence.thresholdDb,
  );
}
