/**
 * Availability rule evaluation.
 *
 * Given a Schedule (weekly rules + date overrides) and a local date in the
 * schedule's timezone, produce the set of available intervals on that day.
 *
 * Date overrides win over weekly rules: an empty-intervals override blocks
 * the day entirely; a non-empty override replaces the weekly rules for the day.
 */
import type {
  AvailabilityInterval,
  DateOverride,
  WeeklyAvailability,
} from "../shared/index.js";

export interface ScheduleInput {
  timezone: string;
  weeklyAvailability: WeeklyAvailability[];
  dateOverrides: DateOverride[];
}

/**
 * Return the intervals available for a given local date.
 * Intervals are in the schedule's local HH:MM, not UTC.
 */
export function evaluateAvailabilityForDate(
  schedule: ScheduleInput,
  localDate: string,
  dayOfWeek: number,
): AvailabilityInterval[] {
  const override = schedule.dateOverrides.find((o) => o.date === localDate);
  if (override) return override.intervals;
  const weekly = schedule.weeklyAvailability.find((w) => w.day === dayOfWeek);
  return weekly?.intervals ?? [];
}

/**
 * Normalize an interval list: sort by start, merge overlapping/adjacent,
 * drop zero-length.
 */
export function normalizeIntervals(
  intervals: AvailabilityInterval[],
): AvailabilityInterval[] {
  const sorted = intervals
    .filter((i) => toMinutes(i.startTime) < toMinutes(i.endTime))
    .slice()
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const out: AvailabilityInterval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && toMinutes(iv.startTime) <= toMinutes(last.endTime)) {
      last.endTime =
        toMinutes(iv.endTime) > toMinutes(last.endTime)
          ? iv.endTime
          : last.endTime;
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
