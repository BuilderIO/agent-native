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
