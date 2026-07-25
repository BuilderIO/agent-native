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
export const METER_SAMPLE_MS = 50;

/** Fold an incoming 0-1 audio level into the current level. */
export function nextMeterLevel(current: number, incoming: number): number {
  if (!Number.isFinite(incoming)) return current;
  const clamped = Math.max(0, Math.min(1, incoming));
  return Math.max(current * METER_ATTACK_DECAY, clamped);
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
  const shaped = safe > 0 ? Math.min(1, Math.pow(safe, 0.52) * 1.08) : 0;
  return (METER_IDLE_HEIGHT + shaped * gain * (1 - METER_IDLE_HEIGHT)) * 100;
}
