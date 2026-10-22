const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Shown for a duration with no value. */
export const EMPTY_DURATION = "–";

// One decimal below 10 ("7.4 hours"), whole numbers from 10 up ("32 hours").
function amount(value: number): number {
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

function withUnit(value: number, singular: string, plural: string): string {
  const shown = amount(value);
  return `${shown.toLocaleString("en-US")} ${shown === 1 ? singular : plural}`;
}

/**
 * A number of seconds as short text: "45 sec", "16 min", "7.4 hours",
 * "3.1 days". Minutes stay whole; a value that rounds up to the next unit's
 * threshold moves to that unit, so 59.7 minutes reads "1 hour", never "60 min".
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return EMPTY_DURATION;
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  if (amount(abs) < MINUTE) return `${sign}${withUnit(abs, "sec", "sec")}`;
  const minutes = Math.round(abs / MINUTE);
  if (minutes < 60) return `${sign}${minutes} min`;
  if (amount(abs / HOUR) < 48) {
    return `${sign}${withUnit(abs / HOUR, "hour", "hours")}`;
  }
  return `${sign}${withUnit(abs / DAY, "day", "days")}`;
}

// Axis steps that read cleanly through formatDuration. There are no
// half-minute steps: minutes show whole, so 90 seconds would read "2 min"
// next to a real "2 min".
const AXIS_STEPS = [
  0.1,
  0.2,
  0.5,
  1,
  2,
  5,
  10,
  15,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
];

/** The smallest clean axis step, in seconds, of at least `seconds`. */
export function durationStep(seconds: number): number {
  const step = AXIS_STEPS.find((candidate) => candidate >= seconds);
  if (step !== undefined) return step;
  // Past two weeks, step in 20, 50, 100, 200... days.
  const days = seconds / DAY;
  const power = 10 ** Math.floor(Math.log10(days));
  const multiple = [1, 2, 5, 10].find((m) => m * power >= days) ?? 10;
  return multiple * power * DAY;
}

/**
 * Axis ticks covering `min` to `max` seconds (and zero) in clean steps such as
 * 15 min or 6 hours, aiming for about `count` ticks. Chart libraries pick
 * decimal steps, which land on labels like "39 hours".
 */
export function durationTicks(min: number, max: number, count = 5): number[] {
  const low = Math.min(0, Number.isFinite(min) ? min : 0);
  const top = Math.max(0, Number.isFinite(max) ? max : 0);
  // All zeros still get an axis, 0 to 1 min.
  const high = top > low ? top : MINUTE;
  const step = durationStep((high - low) / Math.max(count - 1, 1));
  const first = Math.floor(low / step);
  const last = Math.max(Math.ceil(high / step), first + 1);
  return Array.from(
    { length: last - first + 1 },
    (_, index) => (first + index) * step,
  );
}
