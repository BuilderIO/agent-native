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

/**
 * One meter's state: the scrolling samples and the rolling peak they are
 * measured against.
 */
export interface WaveformState {
  history: number[];
  gain: number;
}

export function createWaveformState(): WaveformState {
  return {
    history: new Array(WAVEFORM_BAR_COUNT).fill(0),
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
