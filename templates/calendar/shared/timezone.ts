const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function timezoneFormatter(
  timezone: string | undefined,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): Intl.DateTimeFormat {
  const key = `${locale ?? ""}\u0000${timezone ?? ""}\u0000${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: timezone,
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function isCalendarTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

const OFFSET_PROBE_OPTIONS: Intl.DateTimeFormatOptions = {
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

function offsetMsInTimezone(date: Date, timezone: string): number {
  const parts = timezoneFormatter(
    timezone,
    OFFSET_PROBE_OPTIONS,
    "en-US",
  ).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.get("year")),
    Number(values.get("month")) - 1,
    Number(values.get("day")),
    Number(values.get("hour")),
    Number(values.get("minute")),
    Number(values.get("second")),
  );
  return asUtc - date.getTime();
}

export function dateTimeInTimezoneToIso(
  date: string,
  time: string,
  timezone: string,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(
      offsetMsInTimezone(
        new Date(wallClockUtc + hours * 60 * 60 * 1000),
        timezone,
      ),
    );
  }

  const candidates = [...offsets]
    .map((offset) => new Date(wallClockUtc - offset))
    .map((candidate) => ({
      candidate,
      localWallClock:
        candidate.getTime() + offsetMsInTimezone(candidate, timezone),
    }))
    .sort((a, b) => {
      const aDelta = a.localWallClock - wallClockUtc;
      const bDelta = b.localWallClock - wallClockUtc;
      if (aDelta === 0 && bDelta === 0) {
        return a.candidate.getTime() - b.candidate.getTime();
      }
      if (aDelta >= 0 && bDelta < 0) return -1;
      if (aDelta < 0 && bDelta >= 0) return 1;
      return Math.abs(aDelta) - Math.abs(bDelta);
    });

  return candidates[0].candidate.toISOString();
}

export function dateKeyInTimezone(date: Date, timezone: string): string {
  const parts = timezoneFormatter(
    timezone,
    { year: "numeric", month: "2-digit", day: "2-digit" },
    "en-CA",
  ).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addDaysToDateKey(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return shifted.toISOString().slice(0, 10);
}

export type CalendarViewMode = "month" | "week" | "day";

function startOfCalendarWeek(date: string, weekStartsOn: 0 | 1): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDaysToDateKey(date, -((weekday - weekStartsOn + 7) % 7));
}

export function getCalendarViewDateRange(
  viewMode: CalendarViewMode,
  selectedDate: string,
  timezone: string,
  weekStartsOn: 0 | 1 = 0,
  numberOfDays = 7,
): { from: string; to: string } {
  const selectedMonthStart = `${selectedDate.slice(0, 7)}-01`;
  const [year, month] = selectedMonthStart.split("-").map(Number);
  const nextMonthStart = new Date(Date.UTC(year, month, 1))
    .toISOString()
    .slice(0, 10);

  let rangeStart = selectedDate;
  let rangeEndExclusive = addDaysToDateKey(selectedDate, 1);
  if (viewMode === "week") {
    const displayedDays = Number.isInteger(numberOfDays)
      ? Math.min(31, Math.max(1, numberOfDays))
      : 7;
    rangeStart =
      displayedDays === 7
        ? startOfCalendarWeek(selectedDate, weekStartsOn)
        : selectedDate;
    rangeEndExclusive = addDaysToDateKey(rangeStart, displayedDays);
  } else if (viewMode === "month") {
    const monthEnd = addDaysToDateKey(nextMonthStart, -1);
    rangeStart = startOfCalendarWeek(selectedMonthStart, weekStartsOn);
    rangeEndExclusive = addDaysToDateKey(
      startOfCalendarWeek(monthEnd, weekStartsOn),
      7,
    );
  }

  return {
    from: dateTimeInTimezoneToIso(rangeStart, "00:00", timezone),
    to: dateTimeInTimezoneToIso(rangeEndExclusive, "00:00", timezone),
  };
}
