import type { ItemsStrings } from "../items-strings";
import { formatRelativeTime } from "../workflow-time";

const DAY = 24 * 60 * 60_000;

function parse(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * "5 min. ago", "in 40 min." in the reader's language. An unreadable stamp
 * comes back as it was stored, never as a blank.
 */
export function formatRelative(
  value: string | null | undefined,
  nowMs: number,
  locale: string,
): string | null {
  if (!value) return null;
  if (parse(value) === null) return value;
  return formatRelativeTime(value, nowMs, locale);
}

export function formatClock(value: string, locale: string): string {
  const at = parse(value);
  if (at === null) return value;
  return new Date(at).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(value: string, locale: string): string {
  const at = parse(value);
  if (at === null) return value;
  return new Date(at).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function localDayStart(ms: number): number {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** Stable per local calendar day; two entries share a heading when it matches. */
export function dayKey(value: string): string {
  const at = parse(value);
  if (at === null) return value;
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatDayLabel(
  value: string,
  nowMs: number,
  s: ItemsStrings,
  locale: string,
): string {
  const at = parse(value);
  if (at === null) return value;
  const daysAgo = Math.round((localDayStart(nowMs) - localDayStart(at)) / DAY);
  if (daysAgo === 0) return s.time.today;
  if (daysAgo === 1) return s.time.yesterday;
  return new Date(at).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "14:40" when it is later today, otherwise the date with the time. */
export function formatUntil(
  value: string,
  nowMs: number,
  locale: string,
): string {
  const at = parse(value);
  if (at === null) return value;
  return localDayStart(at) === localDayStart(nowMs)
    ? formatClock(value, locale)
    : formatDateTime(value, locale);
}

export function formatDuration(ms: number, s: ItemsStrings): string {
  if (ms < 1000) return s.duration.ms(Math.round(ms));
  if (ms < 60_000) {
    const seconds = ms / 1000;
    return s.duration.seconds(
      seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds)),
    );
  }
  const minutes = Math.floor(ms / 60_000);
  return s.duration.minutes(minutes, Math.round((ms % 60_000) / 1000));
}

/** 0 -> "0%", 0.004 -> "<1%", 0.126 -> "13%". */
export function formatPercent(fraction: number): string {
  if (fraction <= 0) return "0%";
  const percent = fraction * 100;
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

/** Keeps long ids readable in a narrow column without losing the end that differs. */
export function shortId(id: string, max = 14): string {
  if (id.length <= max) return id;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${id.slice(0, head)}…${id.slice(id.length - (keep - head))}`;
}
