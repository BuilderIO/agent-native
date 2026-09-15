/**
 * Level math for the one waveform meter the product uses.
 *
 * Every live meter — record pill, meeting pill, dictation bar — renders
 * `LiveWaveform` over this state, so "how loud is it right now" is answered the
 * same way everywhere. Kept out of the React layer so the behaviour is
 * unit-testable without a DOM.
 */

/** Slots in the scrolling waveform. Five reads as a signal; three reads as a
 *  glyph, and the meter is supposed to be the audio, not decoration. */
export const WAVEFORM_BAR_COUNT = 5;

/** Height in px at silence and at full scale, so a resting meter is a row of
 *  dots rather than an empty gap. */
export const WAVEFORM_MIN_PX = 3;
export const WAVEFORM_RANGE_PX = 11;

/** Floor for the rolling peak. Without it, a silent room drives the gain to
 *  zero and the first whisper pins the meter to full height. */
export const WAVEFORM_GAIN_FLOOR = 0.04;

/** How fast the rolling peak forgets a loud moment. */
export const WAVEFORM_GAIN_DECAY = 0.985;

/** After this long with no capture buffer the meter falls flat. Capture keeps
 *  emitting through silence, so this only covers pause and teardown — where a
 *  frozen tall bar would claim someone is still talking. */
export const WAVEFORM_IDLE_MS = 350;

/** A mic below this level is effectively silent rather than merely quiet. */
export const MIC_AUDIBLE_LEVEL = 0.012;

/** Give normal pauses room before treating sustained silence as a problem. */
export const MIC_SILENCE_WARNING_MS = 5_000;

export type MicSignalWarning = "muted" | "silent" | null;

/**
 * Classify the microphone state shown by recording chrome.
 *
 * An explicitly disabled mic warns immediately. An enabled mic gets a short
 * grace period so ordinary pauses do not flash a false warning. Pausing the
 * recording suppresses the warning because silence is expected then.
 */
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

/**
 * One meter's state: the scrolling samples and the rolling peak they are
 * measured against.
 */
export interface WaveformState {
  history: number[];
  gain: number;
}

/** Slots a meter of `bars` actually gets. A meter is only as wide as its
 *  history: `advanceWaveform` scrolls a fixed-length array and never grows it,
 *  so every slot past the end would stay at the resting dot forever. */
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

/**
 * Push one sample through the meter.
 *
 * Raw capture peaks rarely pass ~0.3 even when someone is shouting, so a fixed
 * scale leaves the meter nearly flat no matter how loud the room is. Samples
 * are normalized against a slowly-decaying rolling peak instead, the way a
 * real meter's auto-gain works, and the history scrolls so the bars are the
 * signal moving past rather than five copies of one number.
 */
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

/**
 * The meter state one render later.
 *
 * Two cases the caller must not have to remember. A `level` of `null` means
 * there is no stream — rest, rather than hold the last frame, or a surface that
 * stops capture without also dimming keeps showing the last loud waveform and
 * claims someone is still talking. A changed `bars` means a different meter, so
 * the history is rebuilt at the new width instead of leaving the extra slots
 * pinned at the resting dot.
 */
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

/** Bar height in px for one normalized sample. */
export function waveformBarPx(sample: number): number {
  const safe = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
  return WAVEFORM_MIN_PX + Math.round(safe * WAVEFORM_RANGE_PX);
}

/** How far a source's level may fall on one frame before a new sample lands,
 *  so the meter drops smoothly instead of snapping to the newest buffer. */
const METER_ATTACK_DECAY = 0.55;

/** Fold an incoming 0-1 audio level into the current level. */
export function nextMeterLevel(current: number, incoming: number): number {
  if (!Number.isFinite(incoming)) return current;
  const clamped = Math.max(0, Math.min(1, incoming));
  return Math.max(current * METER_ATTACK_DECAY, clamped);
}

export type MeterSource = "mic" | "system";
export type MeterSourceLevels = Record<MeterSource, number>;

export const EMPTY_METER_SOURCES: MeterSourceLevels = { mic: 0, system: 0 };

/**
 * Fold one capture buffer into the per-source levels. Mic and system audio
 * interleave on a single event, so each stream has to decay on its own frames
 * only — one shared level lets a silent mic halve the level of whoever is
 * actually talking on every other event, which pins the meter to its floor.
 */
export function foldMeterSources(
  levels: MeterSourceLevels,
  source: MeterSource,
  incoming: number,
): MeterSourceLevels {
  return { ...levels, [source]: nextMeterLevel(levels[source], incoming) };
}

/** What the bars show: whichever side of the conversation is louder. */
export function combinedMeterLevel(levels: MeterSourceLevels): number {
  return Math.max(levels.mic, levels.system);
}
