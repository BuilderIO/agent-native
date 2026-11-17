import { dbText } from "./text";

/** The page's language, for numbers, dates and lists. */
export function pageLocale(): string {
  return typeof document === "undefined" || !document.documentElement.lang
    ? "en-US"
    : document.documentElement.lang;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** "2 minutes ago", "just now" and the like, in the page's language. */
export function sourceRelativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const format = new Intl.RelativeTimeFormat(pageLocale(), {
    numeric: "auto",
  });
  const seconds = Math.round((at - now) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.round(seconds / size), unit);
    }
  }
  return dbText("sourceJustNow");
}

/** "Updated 2 minutes ago", or "Not updated yet" before the first update. */
export function sourceUpdatedText(
  updatedAt: string | null,
  now: number,
): string {
  return updatedAt
    ? dbText("sourceUpdatedAgo", { time: sourceRelativeTime(updatedAt, now) })
    : dbText("sourceNotUpdatedYet");
}
