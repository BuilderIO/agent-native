import { CronExpressionParser } from "cron-parser";

const ALIAS_MAP: Record<string, string> = {
  "@midnight": "0 0 * * *",
};

function normalize(cronExpr: string): string {
  return ALIAS_MAP[cronExpr.trim().toLowerCase()] ?? cronExpr;
}

export function serverTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch (error) {
    console.warn(
      "[jobs] Could not detect the server timezone; using UTC",
      error,
    );
    return "UTC";
  }
}

export function isValidTimezone(timezone: string): boolean {
  if (!timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    // coercion-ok: invalid IANA timezone is an explicit false validation result
    return false;
  }
}

export function effectiveTimezone(timezone?: string | null): string {
  return timezone && isValidTimezone(timezone) ? timezone : serverTimezone();
}

export function nextOccurrence(
  cronExpr: string,
  after?: Date,
  timezone?: string | null,
): Date {
  const expr = CronExpressionParser.parse(normalize(cronExpr), {
    currentDate: after ?? new Date(),
    tz: effectiveTimezone(timezone),
  });
  const next = expr.next();
  return next.toDate();
}

export function isValidCron(cronExpr: string): boolean {
  try {
    CronExpressionParser.parse(normalize(cronExpr));
    return true;
  } catch {
    return false;
  }
}

export function describeCron(
  cronExpr: string,
  timezone?: string | null,
): string {
  const normalized = normalize(cronExpr);
  const parts = normalized.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpr;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const zone = (text: string) =>
    timezone ? text + " (" + timezone + ")" : text;

  if (normalized === "* * * * *") return "Every minute";

  const minMatch = minute.match(/^\*\/(\d+)$/);
  if (
    minMatch &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return `Every ${minMatch[1]} minutes`;
  }

  if (
    minute !== "*" &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return `Every hour at :${minute.padStart(2, "0")}`;
  }

  const formatTime = (h: string, m: string): string => {
    if (h === "*") return "";
    const hours = h.split(",").map((hh) => {
      const hr = parseInt(hh, 10);
      const ampm = hr >= 12 ? "PM" : "AM";
      const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
      const min = m === "0" || m === "00" ? "" : `:${m.padStart(2, "0")}`;
      return `${hr12}${min} ${ampm}`;
    });
    return hours.join(" and ");
  };

  const time = formatTime(hour, minute);

  const dayNames: Record<string, string> = {
    "0": "Sunday",
    "1": "Monday",
    "2": "Tuesday",
    "3": "Wednesday",
    "4": "Thursday",
    "5": "Friday",
    "6": "Saturday",
    "7": "Sunday",
  };

  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && time) {
    return zone(`Every day at ${time}`);
  }

  if (
    dayOfMonth === "*" &&
    month === "*" &&
    (dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") &&
    time
  ) {
    return zone(`Every weekday at ${time}`);
  }

  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*" && time) {
    const days = dayOfWeek.split(",").map((d) => dayNames[d] || d);
    return zone(`Every ${days.join(", ")} at ${time}`);
  }

  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*" && time) {
    return zone(`On day ${dayOfMonth} of every month at ${time}`);
  }

  return cronExpr;
}
