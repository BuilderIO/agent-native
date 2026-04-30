import { CronExpressionParser } from "cron-parser";

// cron-parser v5 mishandles @midnight — normalize it to an equivalent 5-field expression.
const ALIAS_MAP: Record<string, string> = {
  "@midnight": "0 0 * * *",
};

function normalize(cronExpr: string): string {
  return ALIAS_MAP[cronExpr.trim().toLowerCase()] ?? cronExpr;
}

/**
 * Compute the next occurrence of a cron expression after the given date.
 */
export function nextOccurrence(cronExpr: string, after?: Date): Date {
  const expr = CronExpressionParser.parse(normalize(cronExpr), {
    currentDate: after ?? new Date(),
  });
  const next = expr.next();
  return next.toDate();
}

/**
 * Validate a cron expression. Returns true if valid.
 */
export function isValidCron(cronExpr: string): boolean {
  try {
    CronExpressionParser.parse(normalize(cronExpr));
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a cron expression to a human-readable description.
 * Handles common patterns; falls back to the raw expression for unusual ones.
 */
export function describeCron(cronExpr: string): string {
  const normalized = normalize(cronExpr);
  const parts = normalized.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpr;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (normalized === "* * * * *") return "Every minute";

  // Every N minutes
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

  // Every hour
  if (
    minute !== "*" &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return `Every hour at :${minute.padStart(2, "0")}`;
  }

  // Build time string
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

  // Day of week mapping
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

  // Every day at specific time
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && time) {
    return `Every day at ${time}`;
  }

  // Weekdays
  if (
    dayOfMonth === "*" &&
    month === "*" &&
    (dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") &&
    time
  ) {
    return `Every weekday at ${time}`;
  }

  // Specific day of week
  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*" && time) {
    const days = dayOfWeek.split(",").map((d) => dayNames[d] || d);
    return `Every ${days.join(", ")} at ${time}`;
  }

  // Specific day of month
  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*" && time) {
    return `On day ${dayOfMonth} of every month at ${time}`;
  }

  return cronExpr;
}
