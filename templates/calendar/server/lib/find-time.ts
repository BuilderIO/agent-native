import type {
  FindTimeBusyBlock,
  FindTimeParticipant,
  FindTimeSlot,
} from "../../shared/api.js";
import {
  addDaysToDateKey,
  dateKeyInTimezone,
  dateTimeInTimezoneToIso,
  isCalendarTimezone,
} from "../../shared/timezone.js";

export interface AvailabilitySchedule {
  timezone: string;
  schedule: Record<string, { start: string; end: string }[]>;
}

export interface FindTimeRange {
  from: string;
  to: string;
  timezone: string;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const DEFAULT_SCHEDULE: AvailabilitySchedule["schedule"] = {
  monday: [{ start: "09:00", end: "17:00" }],
  tuesday: [{ start: "09:00", end: "17:00" }],
  wednesday: [{ start: "09:00", end: "17:00" }],
  thursday: [{ start: "09:00", end: "17:00" }],
  friday: [{ start: "09:00", end: "17:00" }],
  saturday: [],
  sunday: [],
};

/**
 * These live in shared/timezone.ts so the grid, the actions, and this module
 * cannot drift on DST edges. Kept under their original names because callers
 * across the template import them from here.
 */
export function normalizeTimezone(timezone?: string): string {
  return isCalendarTimezone(timezone) ? timezone : "UTC";
}

export const dateOnlyInTimezone = dateKeyInTimezone;
export const addDaysToDateOnly = addDaysToDateKey;

export function zonedDateTimeToUtcIso(
  dateOnly: string,
  time: string,
  timezone: string,
): string {
  return dateTimeInTimezoneToIso(dateOnly, time, timezone);
}

function normalizeDateBound(value: string, timezone: string): string {
  if (DATE_ONLY_RE.test(value)) {
    return zonedDateTimeToUtcIso(value, "00:00", timezone);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed.toISOString();
}

export function resolveFindTimeRange(args: {
  from?: string;
  to?: string;
  date?: string;
  timezone?: string;
  now?: Date;
}): FindTimeRange {
  const timezone = normalizeTimezone(args.timezone);
  const today = dateOnlyInTimezone(args.now ?? new Date(), timezone);
  let from = args.from?.trim();
  let to = args.to?.trim();

  if (args.date?.trim()) {
    from = args.date.trim();
    to = addDaysToDateOnly(from, 7);
  } else if (!from && !to) {
    from = today;
    to = addDaysToDateOnly(today, 7);
  } else if (from && !to) {
    to = DATE_ONLY_RE.test(from)
      ? addDaysToDateOnly(from, 7)
      : new Date(
          new Date(from).getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
  } else if (!from && to) {
    from = today;
  }

  const normalizedFrom = normalizeDateBound(from!, timezone);
  const normalizedTo = normalizeDateBound(to!, timezone);
  if (new Date(normalizedFrom).getTime() >= new Date(normalizedTo).getTime()) {
    throw new Error("from must be before to");
  }

  return { from: normalizedFrom, to: normalizedTo, timezone };
}

function dayNameForDateOnly(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function validWindow(window: { start?: string; end?: string }) {
  return (
    typeof window.start === "string" &&
    typeof window.end === "string" &&
    TIME_RE.test(window.start) &&
    TIME_RE.test(window.end) &&
    window.end > window.start
  );
}

export function normalizeAvailabilitySchedule(
  stored: unknown,
  fallbackTimezone: string,
): AvailabilitySchedule {
  if (!stored || typeof stored !== "object") {
    return { timezone: fallbackTimezone, schedule: DEFAULT_SCHEDULE };
  }

  const value = stored as Partial<AvailabilitySchedule> & {
    weeklySchedule?: Record<
      string,
      { enabled?: boolean; slots?: { start: string; end: string }[] }
    >;
  };

  if (value.schedule) {
    return {
      timezone: normalizeTimezone(value.timezone || fallbackTimezone),
      schedule: value.schedule,
    };
  }

  if (!value.weeklySchedule) {
    return { timezone: fallbackTimezone, schedule: DEFAULT_SCHEDULE };
  }

  const schedule: AvailabilitySchedule["schedule"] = {};
  for (const day of DAY_NAMES) {
    const daySchedule = value.weeklySchedule[day];
    schedule[day] =
      daySchedule?.enabled && Array.isArray(daySchedule.slots)
        ? daySchedule.slots.filter(validWindow)
        : [];
  }

  return {
    timezone: normalizeTimezone(value.timezone || fallbackTimezone),
    schedule,
  };
}

function intervalOverlaps(
  start: number,
  end: number,
  block: FindTimeBusyBlock,
) {
  const blockStart = new Date(block.start).getTime();
  const blockEnd = new Date(block.end).getTime();
  return blockStart < end && start < blockEnd;
}

export function computeFindTimeSlots(args: {
  range: FindTimeRange;
  participants: FindTimeParticipant[];
  busyBlocks: FindTimeBusyBlock[];
  schedule: AvailabilitySchedule["schedule"];
  durationMinutes: number;
  slotStepMinutes: number;
  limit?: number;
}): FindTimeSlot[] {
  const durationMs = Math.max(5, args.durationMinutes) * 60 * 1000;
  const stepMs = Math.max(5, args.slotStepMinutes) * 60 * 1000;
  const limit = args.limit ?? 80;
  const fromMs = new Date(args.range.from).getTime();
  const toMs = new Date(args.range.to).getTime();
  const participantEmails = args.participants.map((participant) =>
    participant.email.toLowerCase(),
  );
  const participantEmailSet = new Set(participantEmails);
  const slots: FindTimeSlot[] = [];

  let date = dateOnlyInTimezone(new Date(args.range.from), args.range.timezone);
  for (let i = 0; i < 35; i++) {
    const dayStartMs = new Date(
      zonedDateTimeToUtcIso(date, "00:00", args.range.timezone),
    ).getTime();
    if (dayStartMs >= toMs) break;

    const windows = args.schedule[dayNameForDateOnly(date)] ?? [];
    for (const window of windows) {
      if (!validWindow(window)) continue;
      const windowStart = Math.max(
        fromMs,
        new Date(
          zonedDateTimeToUtcIso(date, window.start, args.range.timezone),
        ).getTime(),
      );
      const windowEnd = Math.min(
        toMs,
        new Date(
          zonedDateTimeToUtcIso(date, window.end, args.range.timezone),
        ).getTime(),
      );

      for (
        let cursor = windowStart;
        cursor + durationMs <= windowEnd;
        cursor += stepMs
      ) {
        const end = cursor + durationMs;
        const unavailable = new Set(
          args.busyBlocks
            .filter((block) =>
              participantEmailSet.has(block.participantEmail.toLowerCase()),
            )
            .filter((block) => intervalOverlaps(cursor, end, block))
            .map((block) => block.participantEmail.toLowerCase()),
        );
        if (unavailable.size > 0) continue;

        slots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(end).toISOString(),
          date,
          durationMinutes: args.durationMinutes,
          availableParticipantEmails: participantEmails,
          unavailableParticipantEmails: [],
        });
        if (slots.length >= limit) return slots;
      }
    }

    date = addDaysToDateOnly(date, 1);
  }

  return slots;
}
