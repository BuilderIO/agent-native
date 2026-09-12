export const TIME_SLOT_MINUTES = 15;

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = 86_400_000;

export const TIME_SLOTS: readonly string[] = Array.from(
  { length: MINUTES_PER_DAY / TIME_SLOT_MINUTES },
  (_, index) => minutesToTimeValue(index * TIME_SLOT_MINUTES),
);

export interface EventTimeRange {
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function minutesToTimeValue(minutes: number): string {
  const normalized =
    ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(normalized / 60);
  return `${String(hour).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function dateValueToDayIndex(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(timestamp) ? null : Math.round(timestamp / MS_PER_DAY);
}

function dayIndexToDateValue(dayIndex: number): string {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addMinutesToTimeValue(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } | null {
  const dayIndex = dateValueToDayIndex(date);
  const minuteOfDay = timeValueToMinutes(time);
  if (dayIndex === null || minuteOfDay === null) return null;
  const total = minuteOfDay + minutes;
  return {
    date: dayIndexToDateValue(dayIndex + Math.floor(total / MINUTES_PER_DAY)),
    time: minutesToTimeValue(total),
  };
}

function rangeToAbsoluteMinutes(date: string, time: string): number | null {
  const dayIndex = dateValueToDayIndex(date);
  const minuteOfDay = timeValueToMinutes(time);
  if (dayIndex === null || minuteOfDay === null) return null;
  return dayIndex * MINUTES_PER_DAY + minuteOfDay;
}

/**
 * Minutes from `start` to `end` treating an `end` at or before `start` as the
 * following day, so every option an end-time picker offers reads as a positive
 * duration rather than a negative one.
 */
export function wrappedDurationMinutes(
  start: string,
  end: string,
): number | null {
  const startMinutes = timeValueToMinutes(start);
  const endMinutes = timeValueToMinutes(end);
  if (startMinutes === null || endMinutes === null) return null;
  const diff = endMinutes - startMinutes;
  return diff > 0 ? diff : diff + MINUTES_PER_DAY;
}

export function eventDurationMinutes(range: EventTimeRange): number | null {
  const start = rangeToAbsoluteMinutes(range.date, range.startTime);
  const end = rangeToAbsoluteMinutes(range.endDate, range.endTime);
  if (start === null || end === null) return null;
  return end - start;
}

/**
 * Time options for a picker. When `after` is supplied the 24h slot list is
 * rotated to begin at the first slot strictly after it, so an end-time list
 * reads forward from the chosen start instead of from midnight.
 */
export function buildTimeOptions({
  value,
  after,
}: {
  value: string;
  after?: string;
}): string[] {
  const afterMinutes = after === undefined ? null : timeValueToMinutes(after);
  let options: string[];
  if (afterMinutes === null) {
    options = [...TIME_SLOTS];
  } else {
    const pivot = TIME_SLOTS.findIndex((slot) => {
      const slotMinutes = timeValueToMinutes(slot);
      return slotMinutes !== null && slotMinutes > afterMinutes;
    });
    options =
      pivot <= 0
        ? [...TIME_SLOTS]
        : [...TIME_SLOTS.slice(pivot), ...TIME_SLOTS.slice(0, pivot)];
  }
  return options.includes(value) ? options : [value, ...options];
}

/**
 * Keeps the range valid when the start moves. An end that would land on or
 * before the new start is pushed forward by the duration the draft already
 * had, so the user never holds an end-before-start event.
 */
export function shiftEndForStartChange(
  range: EventTimeRange,
  nextStartTime: string,
): EventTimeRange {
  const next = { ...range, startTime: nextStartTime };
  const nextStart = rangeToAbsoluteMinutes(next.date, nextStartTime);
  const currentEnd = rangeToAbsoluteMinutes(range.endDate, range.endTime);
  if (nextStart === null || currentEnd === null) return next;
  if (currentEnd > nextStart) return next;

  const previousDuration = eventDurationMinutes(range);
  const duration = Math.max(
    TIME_SLOT_MINUTES,
    previousDuration ?? TIME_SLOT_MINUTES,
  );
  const shifted = addMinutesToTimeValue(next.date, nextStartTime, duration);
  if (!shifted) return next;
  return { ...next, endDate: shifted.date, endTime: shifted.time };
}

/**
 * Resolves an end-time pick against the start. A pick that reads as earlier in
 * the day is the wrapped option from `buildTimeOptions`, so it belongs to the
 * next day rather than being an invalid end.
 */
export function applyEndTimeChange(
  range: EventTimeRange,
  nextEndTime: string,
): EventTimeRange {
  const next = { ...range, endTime: nextEndTime };
  const start = rangeToAbsoluteMinutes(range.date, range.startTime);
  const end = rangeToAbsoluteMinutes(range.endDate, nextEndTime);
  if (start === null || end === null) return next;
  if (end > start) return next;

  const rolled = addMinutesToTimeValue(
    next.endDate,
    nextEndTime,
    MINUTES_PER_DAY,
  );
  if (!rolled) return next;
  return { ...next, endDate: rolled.date };
}
