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

export function shiftEndForStartChange(
  range: EventTimeRange,
  nextStartTime: string,
): EventTimeRange {
  const next = { ...range, startTime: nextStartTime };
  const currentStart = rangeToAbsoluteMinutes(range.date, range.startTime);
  const nextStart = rangeToAbsoluteMinutes(next.date, nextStartTime);
  if (currentStart === null || nextStart === null) return next;

  const delta = nextStart - currentStart;
  const shifted = addMinutesToTimeValue(range.endDate, range.endTime, delta);
  if (!shifted) return next;
  const shiftedEnd = rangeToAbsoluteMinutes(shifted.date, shifted.time);
  if (shiftedEnd !== null && shiftedEnd > nextStart) {
    return { ...next, endDate: shifted.date, endTime: shifted.time };
  }

  const repaired = addMinutesToTimeValue(
    next.date,
    nextStartTime,
    TIME_SLOT_MINUTES,
  );
  if (!repaired) return next;
  return { ...next, endDate: repaired.date, endTime: repaired.time };
}

export function shiftEndForDateChange(
  range: EventTimeRange,
  nextDate: string,
): EventTimeRange {
  const next = { ...range, date: nextDate };
  const currentStart = rangeToAbsoluteMinutes(range.date, range.startTime);
  const nextStart = rangeToAbsoluteMinutes(nextDate, range.startTime);
  if (currentStart === null || nextStart === null) return next;

  const shifted = addMinutesToTimeValue(
    range.endDate,
    range.endTime,
    nextStart - currentStart,
  );
  if (!shifted) return next;
  const shiftedEnd = rangeToAbsoluteMinutes(shifted.date, shifted.time);
  if (shiftedEnd !== null && shiftedEnd > nextStart) {
    return { ...next, endDate: shifted.date, endTime: shifted.time };
  }

  const repaired = addMinutesToTimeValue(
    nextDate,
    range.startTime,
    TIME_SLOT_MINUTES,
  );
  if (!repaired) return next;
  return { ...next, endDate: repaired.date, endTime: repaired.time };
}

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
