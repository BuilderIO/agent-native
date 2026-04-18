/**
 * Slot computation — the heart of the scheduling package.
 *
 * Input: an event type's config (duration, buffers, limits, period),
 *        a schedule (weekly hours + date overrides),
 *        a set of busy intervals (from external calendars + existing bookings),
 *        a time range to compute over.
 * Output: an array of Slot objects (UTC start/end) that are available
 *         and pass every constraint.
 *
 * Correctness priorities, in order:
 *   1. Never return a slot in the past (respect `now + minimumBookingNotice`)
 *   2. Never return a slot that overlaps a busy interval (with buffers)
 *   3. Never return a slot outside the schedule's available windows
 *   4. Never exceed booking limits (per-day/week/month/year)
 *   5. Respect the event type's period (rolling / range / unlimited)
 *   6. Correctness across DST transitions
 */
import type {
  Slot,
  BusyInterval,
  BookingLimits,
  PeriodType,
} from "../shared/index.js";
import {
  addMinutes,
  getDayOfWeek,
  formatLocalDate,
  zonedTimeToUtc,
  localDatesInRange,
  overlaps,
} from "./time.js";
import { evaluateAvailabilityForDate, type ScheduleInput } from "./rules.js";
import { hasConflict, mergeBusy } from "./conflicts.js";
import {
  exceedsLimits,
  bucketKeysForSlot,
  type BookingCounts,
} from "./limits.js";
import { expandSlotForConflictCheck } from "./buffers.js";

export interface ComputeSlotsInput {
  /** Event type duration, minutes */
  duration: number;
  /** Minutes before event start where the event type becomes unbookable; 0 = up to now */
  minimumBookingNotice: number;
  /** Buffers in minutes applied to any existing busy interval and the candidate slot */
  beforeEventBuffer: number;
  afterEventBuffer: number;
  /** Null = increment by duration */
  slotInterval: number | null;
  periodType: PeriodType;
  periodDays?: number;
  periodStartDate?: string;
  periodEndDate?: string;
  bookingLimits?: BookingLimits;
  /** Schedule — intervals in schedule's timezone */
  schedule: ScheduleInput;
  /** Busy intervals in UTC (already aggregated from all sources) */
  busy: BusyInterval[];
  /** Existing bookings grouped by bucket key — used for limit enforcement */
  bookingCounts?: BookingCounts;
  /** Week start for limit-bucketing */
  weekStartsOn?: 0 | 1;
  /** Range to compute over, UTC */
  rangeStart: Date;
  rangeEnd: Date;
  /** Current time (UTC). Defaults to now. */
  now?: Date;
  /** Seats per slot — if > 1, slot stays available until seats exhausted */
  seatsPerTimeSlot?: number;
  /** Seat count already reserved, keyed by ISO start */
  seatsTaken?: Map<string, number>;
  /** Timezone in which the Booker displays the slots (for limit buckets) */
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

  // Enumerate each local day in the schedule's timezone that the range touches.
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

        // Cap to range
        if (slotStart < rangeStart || slotEnd > rangeEnd) {
          slotStart = addMinutes(slotStart, interval);
          continue;
        }

        // Respect minimum notice
        if (slotStart < minBookableTime) {
          slotStart = addMinutes(slotStart, interval);
          continue;
        }

        // Conflict check (expanded with buffers)
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

        // Booking limits (in viewer's timezone for perDay buckets)
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

        // Seats
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
  // Rolling + unlimited don't restrict start
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
  // Construct a UTC date that corresponds to noon on that local date in the
  // target timezone, then ask what day-of-week it is in that timezone.
  const noon = zonedTimeToUtc(localDate, "12:00", timezone);
  return getDayOfWeek(noon, timezone);
}
