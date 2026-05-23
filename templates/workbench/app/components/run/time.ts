/**
 * Tiny relative-time formatter used by run cards and the run detail header.
 *
 * Keeps the dependency surface zero — Workbench's run UI doesn't justify a
 * full Intl.RelativeTimeFormat polyfill, and the bands here ("4m", "1h",
 * "3d") match the PRD's mockups.
 */

interface RelativeOptions {
  /** Suffix to append, e.g. "ago". */
  suffix?: string;
  /** Now timestamp override (for tests). */
  now?: number;
}

export function formatRelativeTime(
  timestamp: number,
  options: RelativeOptions = {},
): string {
  const now = options.now ?? Date.now();
  const delta = Math.max(0, now - timestamp);
  const seconds = Math.round(delta / 1000);

  if (seconds < 5) return "just now";

  let value: string;
  if (seconds < 60) value = `${seconds}s`;
  else if (seconds < 3600) value = `${Math.round(seconds / 60)}m`;
  else if (seconds < 86_400) value = `${Math.round(seconds / 3600)}h`;
  else if (seconds < 604_800) value = `${Math.round(seconds / 86_400)}d`;
  else value = `${Math.round(seconds / 604_800)}w`;

  return options.suffix ? `${value} ${options.suffix}` : value;
}

/**
 * Format an elapsed duration ("1h 12m", "4m 5s"). Used in the run summary
 * card. Drops the seconds component once the duration exceeds an hour to
 * keep the surface from getting noisy.
 */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}
