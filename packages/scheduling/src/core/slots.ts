import type {
  Slot,
  BusyInterval,
  BookingLimits,
  PeriodType,
} from "../shared/index.js";
import { expandSlotForConflictCheck } from "./buffers.js";
import { hasConflict, mergeBusy } from "./conflicts.js";
import { exceedsLimits, type BookingCounts } from "./limits.js";
import { evaluateAvailabilityForDate, type ScheduleInput } from "./rules.js";
import {
  addMinutes,
  getDayOfWeek,
  zonedTimeToUtc,
  localDatesInRange,
} from "./time.js";

export interface ComputeSlotsInput {
  duration: number;
  minimumBookingNotice: number;
  beforeEventBuffer: number;
  afterEventBuffer: number;
  slotInterval: number | null;
  periodType: PeriodType;
  periodDays?: number;
  periodStartDate?: string;
  periodEndDate?: string;
  bookingLimits?: BookingLimits;
  schedule: ScheduleInput;
  busy: BusyInterval[];
  bookingCounts?: BookingCounts;
  weekStartsOn?: 0 | 1;
  rangeStart: Date;
  rangeEnd: Date;
  now?: Date;
  seatsPerTimeSlot?: number;
  seatsTaken?: Map<string, number>;
  viewerTimezone?: string;
}

export function computeAvailableSlots(input: ComputeSlotsInput): Slot[] {
  const now = input.now ?? new Date();
  const minBookableTime = addMinutes(now, input.minimumBookingNotice);

  const rangeStart = capToPeriodStart(input, input.rangeStart, now);
  const rangeEnd = capToPeriodEnd(input, input.rangeEnd, now);
  if (rangeStart >= rangeEnd) return [];

  const mergedBusy = mergeBusy(input.busy);
  const interval = input.slotInterval ?? input.duration;
  const viewerTz = input.viewerTimezone ?? input.schedule.timezone;
  const slots: Slot[] = [];

  const dates = localDatesInRange(
    rangeStart,
    rangeEnd,
    input.schedule.timezone,
  );

  for (const localDate of dates) {
    const dow = dayOfWeekForLocalDate(localDate, input.schedule.timezone);
    const dayIntervals = evaluateAvailabilityForDate(
      input.schedule,
      localDate,
      dow,
    );
    if (dayIntervals.length === 0) continue;

    for (const iv of dayIntervals) {
      const dayStartUtc = zonedTimeToUtc(
        localDate,
        iv.startTime,
        input.schedule.timezone,
      );
      const dayEndUtc = zonedTimeToUtc(
        localDate,
        iv.endTime,
        input.schedule.timezone,
      );

      let slotStart = dayStartUtc;
      while (addMinutes(slotStart, input.duration) <= dayEndUtc) {
        const slotEnd = addMinutes(slotStart, input.duration);

        if (slotStart < rangeStart || slotEnd > rangeEnd) {
          slotStart = addMinutes(slotStart, interval);
          continue;
        }

        if (slotStart < minBookableTime) {
          slotStart = addMinutes(slotStart, interval);
          continue;
        }

        const expanded = expandSlotForConflictCheck(
          slotStart,
          slotEnd,
          input.beforeEventBuffer,
          input.afterEventBuffer,
        );
        if (hasConflict(expanded, mergedBusy)) {
          slotStart = addMinutes(slotStart, interval);
          continue;
        }

        if (
          input.bookingCounts &&
          exceedsLimits(
            slotStart,
            viewerTz,
            input.bookingLimits,
            input.bookingCounts,
            input.weekStartsOn ?? 0,
          )
        ) {
          slotStart = addMinutes(slotStart, interval);
          continue;
        }

        const seatsTaken = input.seatsTaken?.get(slotStart.toISOString()) ?? 0;
        const seatsRemaining =
          input.seatsPerTimeSlot != null
            ? Math.max(0, input.seatsPerTimeSlot - seatsTaken)
            : undefined;

        if (input.seatsPerTimeSlot != null && seatsRemaining === 0) {
          slotStart = addMinutes(slotStart, interval);
          continue;
        }

        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          available: true,
          seatsRemaining,
        });

        slotStart = addMinutes(slotStart, interval);
      }
    }
  }

  return slots;
}

function capToPeriodStart(
  input: ComputeSlotsInput,
  rangeStart: Date,
  now: Date,
): Date {
  if (input.periodType === "range" && input.periodStartDate) {
    const start = new Date(input.periodStartDate);
    return rangeStart > start ? rangeStart : start;
  }
  return rangeStart > now ? rangeStart : now;
}

function capToPeriodEnd(
  input: ComputeSlotsInput,
  rangeEnd: Date,
  now: Date,
): Date {
  if (input.periodType === "range" && input.periodEndDate) {
    const end = new Date(input.periodEndDate);
    return rangeEnd < end ? rangeEnd : end;
  }
  if (input.periodType === "rolling" && input.periodDays != null) {
    const rollingEnd = addMinutes(now, input.periodDays * 24 * 60);
    return rangeEnd < rollingEnd ? rangeEnd : rollingEnd;
  }
  return rangeEnd;
}

function dayOfWeekForLocalDate(localDate: string, timezone: string): number {
  const noon = zonedTimeToUtc(localDate, "12:00", timezone);
  return getDayOfWeek(noon, timezone);
}
