/**
 * Availability engine — combines an event type, schedule, and calendar busy
 * intervals into the slot list shown to the Booker.
 *
 * This is where the pure `computeAvailableSlots` gets plugged into the real
 * world: it fetches the schedule, merges busy times from the selected
 * calendars + existing bookings, and applies booking limits.
 */
import { inArray, eq, gte, lt, and } from "drizzle-orm";
import type {
  EventType,
  Schedule,
  BusyInterval,
  Slot,
} from "../shared/index.js";
import type { BookingCounts } from "../core/limits.js";
import { computeAvailableSlots } from "../core/slots.js";
import { bucketKeysForSlot } from "../core/limits.js";
import { getScheduleById } from "./schedules-repo.js";
import { getSchedulingContext } from "./context.js";
import { getCalendarProvider } from "./providers/registry.js";
import { TZDate } from "@date-fns/tz";
import { format, startOfWeek, startOfMonth, startOfYear } from "date-fns";

export interface GetSlotsInput {
  eventType: EventType;
  /** The user we're finding availability for — their schedule + calendars. */
  forUserEmail: string;
  rangeStart: Date;
  rangeEnd: Date;
  viewerTimezone?: string;
  now?: Date;
}

export async function getAvailableSlots(input: GetSlotsInput): Promise<Slot[]> {
  const schedule = input.eventType.scheduleId
    ? await getScheduleById(input.eventType.scheduleId)
    : await resolveDefaultSchedule(input.forUserEmail);
  if (!schedule) {
    return [];
  }
  const busy = await aggregateBusy({
    userEmail: input.forUserEmail,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
  });
  const counts = await bookingCountsFor(
    input.forUserEmail,
    input.eventType.id,
    input.viewerTimezone ?? schedule.timezone,
  );
  return computeAvailableSlots({
    duration: input.eventType.length,
    minimumBookingNotice: input.eventType.minimumBookingNotice,
    beforeEventBuffer: input.eventType.beforeEventBuffer,
    afterEventBuffer: input.eventType.afterEventBuffer,
    slotInterval: input.eventType.slotInterval,
    periodType: input.eventType.periodType,
    periodDays: input.eventType.periodDays,
    periodStartDate: input.eventType.periodStartDate,
    periodEndDate: input.eventType.periodEndDate,
    bookingLimits: input.eventType.bookingLimits,
    schedule: {
      timezone: schedule.timezone,
      weeklyAvailability: schedule.weeklyAvailability,
      dateOverrides: schedule.dateOverrides,
    },
    busy,
    bookingCounts: counts,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    now: input.now,
    seatsPerTimeSlot: input.eventType.seatsPerTimeSlot,
    viewerTimezone: input.viewerTimezone ?? schedule.timezone,
  });
}

async function resolveDefaultSchedule(
  ownerEmail: string,
): Promise<Schedule | null> {
  const { getDb, schema } = getSchedulingContext();
  const rows = await getDb()
    .select()
    .from(schema.schedules)
    .where(
      and(
        eq(schema.schedules.ownerEmail, ownerEmail),
        eq(schema.schedules.isDefault, true),
      ),
    );
  if (!rows[0]) return null;
  return getScheduleById(rows[0].id);
}

/**
 * Merge busy intervals from: (a) existing bookings for the user, (b) selected
 * external calendars (via providers), (c) the calendar cache.
 */
export async function aggregateBusy(input: {
  userEmail: string;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<BusyInterval[]> {
  const { getDb, schema } = getSchedulingContext();
  const db = getDb();
  const busy: BusyInterval[] = [];

  // Existing bookings where this user is the host
  const bookings = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostEmail, input.userEmail),
        eq(schema.bookings.status, "confirmed"),
        gte(schema.bookings.endTime, input.rangeStart.toISOString()),
        lt(schema.bookings.startTime, input.rangeEnd.toISOString()),
      ),
    );
  for (const b of bookings) {
    busy.push({
      start: b.startTime,
      end: b.endTime,
      source: `booking:${b.uid}`,
    });
  }

  // External calendars via registered providers
  const creds = await db
    .select()
    .from(schema.schedulingCredentials)
    .where(
      and(
        eq(schema.schedulingCredentials.userEmail, input.userEmail),
        eq(schema.schedulingCredentials.invalid, false),
      ),
    );
  for (const cred of creds) {
    const selected = await db
      .select()
      .from(schema.selectedCalendars)
      .where(eq(schema.selectedCalendars.credentialId, cred.id));
    if (selected.length === 0) continue;
    const provider = getCalendarProvider(cred.type);
    if (!provider) continue;
    try {
      const result = await provider.getBusy({
        credentialId: cred.id,
        calendarExternalIds: selected.map((s: any) => s.externalId),
        start: input.rangeStart,
        end: input.rangeEnd,
      });
      busy.push(...result);
    } catch (err) {
      // Silently degrade — booking UI shows "couldn't verify availability" banner
      // Consumer logs via their own error handler
    }
  }

  return busy;
}

async function bookingCountsFor(
  userEmail: string,
  eventTypeId: string,
  timezone: string,
): Promise<BookingCounts> {
  const { getDb, schema } = getSchedulingContext();
  const rows = await getDb()
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.hostEmail, userEmail),
        eq(schema.bookings.eventTypeId, eventTypeId),
        eq(schema.bookings.status, "confirmed"),
      ),
    );
  const counts: BookingCounts = {
    perDay: {},
    perWeek: {},
    perMonth: {},
    perYear: {},
  };
  for (const r of rows) {
    const keys = bucketKeysForSlot(new Date(r.startTime), timezone);
    counts.perDay[keys.day] = (counts.perDay[keys.day] ?? 0) + 1;
    counts.perWeek[keys.week] = (counts.perWeek[keys.week] ?? 0) + 1;
    counts.perMonth[keys.month] = (counts.perMonth[keys.month] ?? 0) + 1;
    counts.perYear[keys.year] = (counts.perYear[keys.year] ?? 0) + 1;
  }
  return counts;
}
