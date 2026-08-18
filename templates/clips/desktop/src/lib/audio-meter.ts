/**
 * Level math for the Granola-style waveform meter on the recording pill.
 *
 * Kept separate from the React overlay so the "bars must track how loud people
 * are talking" behaviour is unit-testable without a DOM.
 */

/** Per-bar scale. The middle bar swings widest, like Granola's meter. */
export const METER_BAR_GAINS = [0.72, 1, 0.84];
export const METER_BAR_COUNT = METER_BAR_GAINS.length;
/** Height (0-1) each bar keeps at silence, so the meter idles as three dots. */
export const METER_IDLE_HEIGHT = 0.14;
/** Multiplier applied on every sample tick when no louder audio arrives. */
export const METER_LEVEL_DECAY = 0.82;
/** Floor a new sample must clear, so the meter falls smoothly instead of snapping. */
export const METER_ATTACK_DECAY = 0.55;
/**
 * How long the meter waits for the next capture buffer before decaying on its
 * own. Capture drives the bars; this only covers pause / teardown, where the
 * events stop and a frozen tall bar would claim someone is still talking.
 */
export const METER_IDLE_MS = 120;

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

/** One decay tick. Snaps to silence below a threshold so bars settle at rest. */
export function decayMeterLevel(current: number): number {
  const decayed = current * METER_LEVEL_DECAY;
  return decayed < 0.01 ? 0 : decayed;
}

/**
 * Push the newest sample onto the front of the meter's history. Bar 0 shows
 * the newest level and older levels travel outward, so the bars ripple against
 * each other instead of moving as one block.
 */
export function advanceMeterLevels(levels: number[], sample: number): number[] {
  return [sample, ...levels.slice(0, METER_BAR_COUNT - 1)];
}

/**
 * Bar height as a percentage of the meter's box. Peak levels from speech taps
 * are often quiet even when speech is clear, so a gentle curve keeps the meter
 * responsive without turning background noise into a full-height signal.
 */
export function meterBarHeight(level: number, barIndex: number): number {
  const gain = METER_BAR_GAINS[barIndex] ?? 1;
  const safe = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const shaped = safe > 0 ? Math.min(1, Math.pow(safe, 0.45) * 1.25) : 0;
  return (METER_IDLE_HEIGHT + shaped * gain * (1 - METER_IDLE_HEIGHT)) * 100;
}
