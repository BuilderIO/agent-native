import type { ItemState } from "../../workflow/contract.js";

const MINUTE_MS = 60_000;

/** The least a wake time may be late before an item is overdue, whatever the cadence. */
export const OVERDUE_AFTER_MINUTES = 10;

/**
 * How late a wake time may be before the item counts as overdue: the
 * threshold the `wait_overdue` tripwire and the diagnostics bundle share. The
 * scheduler wakes items at the check cadence, so an item can wait a whole
 * cadence past its time when it just missed a tick. Past two cadences a tick
 * was skipped, which is what `wait_overdue` records.
 */
export function overdueAfterMinutes(checkCadenceMinutes: number): number {
  return Math.max(OVERDUE_AFTER_MINUTES, 2 * checkCadenceMinutes);
}

interface OverdueWakes {
  count: number;
  oldestLatenessMinutes: number;
  thresholdMinutes: number;
}

/**
 * The parked items whose wake time (the sooner of their deadline and next
 * check, the same `least(dueAt, nextCheckAt)` diagnostics counts) passed more
 * than the threshold before `nowMs`. Null when none did.
 */
export function findOverdueWakes(
  parked: readonly ItemState[],
  nowMs: number,
  checkCadenceMinutes: number,
): OverdueWakes | null {
  const thresholdMinutes = overdueAfterMinutes(checkCadenceMinutes);
  let count = 0;
  let oldestMs = 0;
  for (const state of parked) {
    if (!state.wake) continue;
    const times = [state.wake.dueAt, state.wake.nextCheckAt]
      .filter((at): at is string => at !== undefined)
      .map((at) => Date.parse(at))
      .filter(Number.isFinite);
    if (times.length === 0) continue;
    const latenessMs = nowMs - Math.min(...times);
    if (latenessMs <= thresholdMinutes * MINUTE_MS) continue;
    count += 1;
    oldestMs = Math.max(oldestMs, latenessMs);
  }
  return count === 0
    ? null
    : {
        count,
        oldestLatenessMinutes: Math.floor(oldestMs / MINUTE_MS),
        thresholdMinutes,
      };
}
