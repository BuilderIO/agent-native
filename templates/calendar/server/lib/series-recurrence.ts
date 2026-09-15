import type { CalendarEvent } from "../../shared/api.js";

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DAY_CODE_BY_LABEL: Record<string, (typeof DAY_CODES)[number]> = {
  Sun: "SU",
  Mon: "MO",
  Tue: "TU",
  Wed: "WE",
  Thu: "TH",
  Fri: "FR",
  Sat: "SA",
};

function isDateOnlyValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseGoogleDateValue(value: string): Date {
  if (isDateOnlyValue(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(value);
}

function googleDateWeekdayCode(
  value: string | undefined,
  timeZone?: string,
): (typeof DAY_CODES)[number] | undefined {
  if (!value) return undefined;
  const date = parseGoogleDateValue(value);
  if (Number.isNaN(date.getTime())) return undefined;

  if (isDateOnlyValue(value)) {
    return DAY_CODES[date.getUTCDay()];
  }

  if (timeZone) {
    try {
      const label = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
      }).format(date);
      return DAY_CODE_BY_LABEL[label];
    } catch {
      // Fall through to UTC if Google returned an invalid timezone.
    }
  }

  return DAY_CODES[date.getUTCDay()];
}

function recurrenceField(rule: string, key: string): string | undefined {
  return rule.match(new RegExp(`(?:^|[:;])${key}=([^;]+)`))?.[1];
}

function replaceRecurrenceField(
  rule: string,
  key: string,
  value: string,
): string {
  const pattern = new RegExp(`(${key}=)[^;]+`);
  if (pattern.test(rule)) return rule.replace(pattern, `$1${value}`);
  return `${rule};${key}=${value}`;
}

function alignWeeklyRecurrenceDay(
  rule: string,
  oldDay: string,
  newDay: string,
): string {
  if (!rule.startsWith("RRULE:")) return rule;
  if (recurrenceField(rule, "FREQ") !== "WEEKLY") return rule;

  const byDay = recurrenceField(rule, "BYDAY");
  if (!byDay) return rule;

  const days = byDay.split(",");
  if (days.length === 1) {
    return replaceRecurrenceField(rule, "BYDAY", newDay);
  }
  if (!days.includes(oldDay) || days.includes(newDay)) return rule;

  return replaceRecurrenceField(
    rule,
    "BYDAY",
    days.map((day) => (day === oldDay ? newDay : day)).join(","),
  );
}

export function shiftSeriesDateValue(
  nextValue: string | undefined,
  instanceValue: string | undefined,
  masterValue: string | undefined,
): string | undefined {
  if (!nextValue || !instanceValue || !masterValue) return nextValue;
  const next = parseGoogleDateValue(nextValue);
  const instance = parseGoogleDateValue(instanceValue);
  const master = parseGoogleDateValue(masterValue);
  if (
    Number.isNaN(next.getTime()) ||
    Number.isNaN(instance.getTime()) ||
    Number.isNaN(master.getTime())
  ) {
    return nextValue;
  }

  const shifted = new Date(
    master.getTime() + (next.getTime() - instance.getTime()),
  );
  if (isDateOnlyValue(nextValue)) return shifted.toISOString().split("T")[0];
  return shifted.toISOString().replace(/\.000Z$/, "Z");
}

export function alignSeriesRecurrenceToStart(
  event: Partial<Pick<CalendarEvent, "start" | "startTimeZone" | "recurrence">>,
  master: {
    startValue?: string;
    startTimeZone?: string;
    recurrence?: string[];
  },
): Partial<Pick<CalendarEvent, "start" | "startTimeZone" | "recurrence">> {
  if (event.recurrence !== undefined || event.start === undefined) return event;
  if (!master.recurrence?.length) return event;

  const timeZone = event.startTimeZone || master.startTimeZone;
  const oldDay = googleDateWeekdayCode(master.startValue, timeZone);
  const newDay = googleDateWeekdayCode(event.start, timeZone);
  if (!oldDay || !newDay || oldDay === newDay) return event;

  const recurrence = master.recurrence.map((rule) =>
    alignWeeklyRecurrenceDay(rule, oldDay, newDay),
  );
  if (recurrence.every((rule, index) => rule === master.recurrence?.[index])) {
    return event;
  }

  return { ...event, recurrence };
}
