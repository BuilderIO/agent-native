const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

/**
 * "2 min. ago" or "in 3 min." in the reader's language. An instant that does
 * not parse comes back as null, so the caller shows nothing rather than a
 * made-up time. `past` says the instant already happened: a clock that has not
 * caught up with it, or a server stamp a moment ahead of it, reads as now
 * instead of as "in 6 sec.", which beside a status such as "Done" reads as how
 * long the work took.
 */
export function formatRelativeTime(
  instant: string | number | null | undefined,
  now: number,
  locale: string,
  options: { past?: boolean } = {},
): string | null {
  if (instant === null || instant === undefined || instant === "") return null;
  const at = typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(at)) return null;
  const formatter = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "short",
  });
  const diff = options.past ? Math.min(at - now, 0) : at - now;
  const size = Math.abs(diff);
  for (const { unit, ms } of UNITS) {
    if (size >= ms) return formatter.format(Math.trunc(diff / ms), unit);
  }
  return formatter.format(Math.trunc(diff / 1000), "second");
}

/** When a run finished, or started while it is still going, as time since: a run is always in the past. */
export function formatRunTime(
  run: { startedAt: string; finishedAt: string | null },
  now: number,
  locale: string,
): string | null {
  return formatRelativeTime(run.finishedAt ?? run.startedAt, now, locale, {
    past: true,
  });
}

export type ScheduleSummary =
  | { kind: "minutes"; minutes: number }
  | { kind: "hours"; hours: number }
  | { kind: "hourly" }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; day: number; time: string }
  | { kind: "custom"; cron: string };

function clock(minute: string, hour: string): string {
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

const NUMBER = /^\d+$/;

/**
 * Reads back the cron shapes a workflow's job file is written with: a minute
 * or hour step, an hourly mark, and a clock time that repeats daily, on
 * weekdays, or on one day of the week. Any other cron comes back as `custom`
 * so it is shown as written, never guessed at.
 */
export function describeCron(
  cron: string | null | undefined,
): ScheduleSummary | null {
  const text = cron?.trim();
  if (!text) return null;
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return { kind: "custom", cron: text };
  const [minute = "", hour = "", dayOfMonth, month, dayOfWeek = ""] = parts;
  if (dayOfMonth !== "*" || month !== "*")
    return { kind: "custom", cron: text };

  const everyMinutes = /^\*\/(\d+)$/.exec(minute);
  if (everyMinutes && hour === "*" && dayOfWeek === "*") {
    return { kind: "minutes", minutes: Number(everyMinutes[1]) };
  }
  if (minute === "0" && hour === "*" && dayOfWeek === "*") {
    return { kind: "hourly" };
  }
  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (minute === "0" && everyHours && dayOfWeek === "*") {
    return { kind: "hours", hours: Number(everyHours[1]) };
  }
  if (NUMBER.test(minute) && NUMBER.test(hour)) {
    const time = clock(minute, hour);
    if (dayOfWeek === "*") return { kind: "daily", time };
    if (dayOfWeek === "1-5") return { kind: "weekdays", time };
    if (/^[0-6]$/.test(dayOfWeek)) {
      return { kind: "weekly", day: Number(dayOfWeek), time };
    }
  }
  return { kind: "custom", cron: text };
}
