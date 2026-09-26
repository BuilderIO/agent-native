
export const WAVEFORM_BAR_COUNT = 5;

export const WAVEFORM_MIN_PX = 3;
export const WAVEFORM_RANGE_PX = 11;

export const WAVEFORM_GAIN_FLOOR = 0.04;

export const WAVEFORM_GAIN_DECAY = 0.985;

export const WAVEFORM_IDLE_MS = 350;

export const MIC_AUDIBLE_LEVEL = 0.012;

export const MIC_SILENCE_WARNING_MS = 5_000;

export type MicSignalWarning = "muted" | "silent" | null;

export function micSignalWarning({
  microphoneEnabled,
  paused,
  silentForMs,
}: {
  microphoneEnabled: boolean | null;
  paused: boolean;
  silentForMs: number;
}): MicSignalWarning {
  if (paused || microphoneEnabled === null) return null;
  if (!microphoneEnabled) return "muted";
  return silentForMs >= MIC_SILENCE_WARNING_MS ? "silent" : null;
}

export interface WaveformState {
  history: number[];
  gain: number;
}

export function waveformWidth(bars: number = WAVEFORM_BAR_COUNT): number {
  return Number.isFinite(bars)
    ? Math.max(1, Math.floor(bars))
    : WAVEFORM_BAR_COUNT;
}

export function createWaveformState(
  bars: number = WAVEFORM_BAR_COUNT,
): WaveformState {
  return {
    history: new Array(waveformWidth(bars)).fill(0),
    gain: WAVEFORM_GAIN_FLOOR,
  };
}

export function advanceWaveform(
  state: WaveformState,
  incoming: number,
): WaveformState {
  const level = Number.isFinite(incoming)
    ? Math.max(0, Math.min(1, incoming))
    : 0;
  const gain = Math.max(
    level,
    state.gain * WAVEFORM_GAIN_DECAY,
    WAVEFORM_GAIN_FLOOR,
  );
  const normalized = Math.min(1, level / gain) ** 0.7;
  return { gain, history: [...state.history.slice(1), normalized] };
}

export function nextWaveformState(
  state: WaveformState,
  level: number | null | undefined,
  bars: number = WAVEFORM_BAR_COUNT,
): WaveformState {
  if (level === null || level === undefined) return createWaveformState(bars);
  const sized =
    state.history.length === waveformWidth(bars)
      ? state
      : createWaveformState(bars);
  return advanceWaveform(sized, level);
}

export function waveformBarPx(sample: number): number {
  const safe = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
  return WAVEFORM_MIN_PX + Math.round(safe * WAVEFORM_RANGE_PX);
}

const METER_ATTACK_DECAY = 0.55;

export function nextMeterLevel(current: number, incoming: number): number {
  if (!Number.isFinite(incoming)) return current;
  const clamped = Math.max(0, Math.min(1, incoming));
  return Math.max(current * METER_ATTACK_DECAY, clamped);
}

export type MeterSource = "mic" | "system";
export type MeterSourceLevels = Record<MeterSource, number>;

export const EMPTY_METER_SOURCES: MeterSourceLevels = { mic: 0, system: 0 };

export function foldMeterSources(
  levels: MeterSourceLevels,
  source: MeterSource,
  incoming: number,
): MeterSourceLevels {
  return { ...levels, [source]: nextMeterLevel(levels[source], incoming) };
}

export function combinedMeterLevel(levels: MeterSourceLevels): number {
  return Math.max(levels.mic, levels.system);
}
