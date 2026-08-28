import { OCEAN_TUNING, type AdaptiveLevel } from "./tuning";

/**
 * Decides how dense the particle field is allowed to be on this machine, from
 * measured frame intervals alone. No GPU, no DOM: the renderer feeds it
 * timings and applies whatever level comes back.
 *
 * Two properties matter and both are deliberate. It decides on the median, so
 * one hitch cannot downgrade a machine that is otherwise keeping up. And it
 * only ever steps down, so the field settles instead of oscillating between two
 * densities in front of the viewer.
 */
export interface ParticleBudget {
  /** The level in force right now. */
  readonly level: AdaptiveLevel;
  /**
   * Records one frame interval in ms. Returns the new level when this sample
   * completed a window that failed the budget, and undefined otherwise -- so
   * the caller reconfigures the draw only on an actual change.
   */
  record(intervalMs: number): AdaptiveLevel | undefined;
  /**
   * Drops the next interval. A resume from pause or a resize rebuild spans real
   * wall-clock time that the GPU was not drawing across, and counting it as a
   * frame is how a scrolled-out hero or a window drag gets mistaken for a slow
   * device.
   */
  discardNextInterval(): void;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function createParticleBudget(
  tuning = OCEAN_TUNING.adaptive,
): ParticleBudget {
  const { levels, frameBudgetMs, overshootRatio, sampleWindow, warmupFrames } =
    tuning;
  const limitMs = frameBudgetMs * overshootRatio;

  let index = 0;
  let warmupRemaining = warmupFrames;
  let discard = true;
  const window: number[] = [];

  return {
    get level() {
      return levels[index]!;
    },

    discardNextInterval() {
      discard = true;
    },

    record(intervalMs) {
      if (discard) {
        discard = false;
        return undefined;
      }
      if (warmupRemaining > 0) {
        warmupRemaining--;
        return undefined;
      }

      window.push(intervalMs);
      if (window.length < sampleWindow) return undefined;

      const observed = median(window);
      window.length = 0;
      if (observed <= limitMs) return undefined;
      if (index >= levels.length - 1) return undefined;

      index++;
      return levels[index]!;
    },
  };
}
