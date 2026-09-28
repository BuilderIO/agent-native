const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

export function formatRelativeTimeFromNow(
  iso: string,
  now: number = Date.now(),
  locale: string = "en",
): string {
  const diffMs = now - Date.parse(iso);
  if (!Number.isFinite(diffMs)) return "";

  const formatter = new Intl.RelativeTimeFormat(locale, {
    style: "long",
    numeric: "auto",
  });
  for (const [unit, unitMs] of UNITS) {
    const value = Math.floor(diffMs / unitMs);
    if (value >= 1) return formatter.format(-value, unit);
  }
  return formatter.format(0, "second");
}
