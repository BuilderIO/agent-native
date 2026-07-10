export interface RealtimeVoiceAudioLevels {
  input: number;
  output: number;
}

export interface RealtimeVoiceAudioLevelStore {
  getSnapshot: () => RealtimeVoiceAudioLevels;
  subscribe: (listener: () => void) => () => void;
  set: (levels: RealtimeVoiceAudioLevels) => void;
  reset: () => void;
}

const SILENT_LEVELS: RealtimeVoiceAudioLevels = { input: 0, output: 0 };

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function normalizeRealtimeVoiceRms(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return clampLevel(Math.max(0, rms - 0.012) * 3.2);
}

export function smoothRealtimeVoiceLevel(
  previous: number,
  next: number,
): number {
  const target = clampLevel(next);
  const factor = target > previous ? 0.55 : 0.2;
  return clampLevel(previous + (target - previous) * factor);
}

export function createRealtimeVoiceAudioLevelStore(): RealtimeVoiceAudioLevelStore {
  let snapshot = SILENT_LEVELS;
  const listeners = new Set<() => void>();

  const set = (levels: RealtimeVoiceAudioLevels) => {
    const next = {
      input: clampLevel(levels.input),
      output: clampLevel(levels.output),
    };
    if (next.input === snapshot.input && next.output === snapshot.output)
      return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    reset: () => set(SILENT_LEVELS),
  };
}
