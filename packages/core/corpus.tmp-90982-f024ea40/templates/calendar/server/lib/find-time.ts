import type {
  FindTimeBusyBlock,
  FindTimeParticipant,
  FindTimeSlot,
} from "../../shared/api.js";

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

export function normalizeTimezone(timezone?: string): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return "UTC";
  }
}

function datePartsInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function dateOnlyInTimezone(date: Date, timezone: string): string {
  const parts = datePartsInTimezone(date, timezone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function offsetMsForTimezone(date: Date, timezone: string): number {
  const parts = datePartsInTimezone(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

export function zonedDateTimeToUtcIso(
  dateOnly: string,
  time: string,
  timezone: string,
): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstGuess = new Date(wallClockUtc);
  const firstOffset = offsetMsForTimezone(firstGuess, timezone);
  const secondGuess = new Date(wallClockUtc - firstOffset);
  const secondOffset = offsetMsForTimezone(secondGuess, timezone);
  return new Date(wallClockUtc - secondOffset).toISOString();
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
