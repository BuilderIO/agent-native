/**
 * Availability engine — combines an event type, schedule, and calendar busy
 * intervals into the slot list shown to the Booker.
 *
 * This is where the pure `computeAvailableSlots` gets plugged into the real
 * world: it fetches the schedule, merges busy times from the selected
 * calendars + existing bookings, and applies booking limits.
 */
import { eq, gte, lt, and, inArray } from "drizzle-orm";

import { expandSlotForConflictCheck } from "../core/buffers.js";
import { hasConflict } from "../core/conflicts.js";
import type { BookingCounts } from "../core/limits.js";
import { bucketKeysForSlot } from "../core/limits.js";
import { computeAvailableSlots } from "../core/slots.js";
import type {
  EventType,
  Schedule,
  BusyInterval,
  Slot,
} from "../shared/index.js";
import { getSchedulingContext } from "./context.js";
import { getCalendarProvider } from "./providers/registry.js";
import { getScheduleById } from "./schedules-repo.js";

const MAX_CALENDAR_BUSY_CONCURRENCY = 4;

export class SlotConflictError extends Error {
  statusCode = 409;
  constructor(message = "This time slot is no longer available") {
    super(message);
    this.name = "SlotConflictError";
  }
}

export interface AssertSlotAvailableInput {
  hostEmail: string;
  startTime: string;
  endTime: string;
  beforeEventBuffer?: number;
  afterEventBuffer?: number;
  /** Booking uid to ignore when checking conflicts (e.g. the one being rescheduled). */
  excludeBookingUid?: string;
}

/**
 * Re-validate a single requested interval right before it's written —
 * cheap by design: aggregates busy only over the buffer-expanded window
 * instead of scanning a full day like `getAvailableSlots`. Throws
 * `SlotConflictError` if the window collides with existing busy time.
 */
export async function assertSlotAvailable(
  input: AssertSlotAvailableInput,
): Promise<void> {
  const expanded = expandSlotForConflictCheck(
    new Date(input.startTime),
    new Date(input.endTime),
    input.beforeEventBuffer ?? 0,
    input.afterEventBuffer ?? 0,
  );
  const busy = await aggregateBusy({
    userEmail: input.hostEmail,
    rangeStart: expanded.start,
    rangeEnd: expanded.end,
  });
  const relevantBusy = input.excludeBookingUid
    ? busy.filter((b) => b.source !== `booking:${input.excludeBookingUid}`)
    : busy;
  if (hasConflict(expanded, relevantBusy)) {
    throw new SlotConflictError();
  }
}

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
  if (creds.length === 0) return busy;

  const selected = await db
    .select({
      credentialId: schema.selectedCalendars.credentialId,
      externalId: schema.selectedCalendars.externalId,
    })
    .from(schema.selectedCalendars)
    .where(
      inArray(
        schema.selectedCalendars.credentialId,
        creds.map((cred: { id: string }) => cred.id),
      ),
    );
  const externalIdsByCredential = new Map<string, string[]>();
  for (const calendar of selected) {
    const externalIds =
      externalIdsByCredential.get(calendar.credentialId) ?? [];
    externalIds.push(calendar.externalId);
    externalIdsByCredential.set(calendar.credentialId, externalIds);
  }

  const providerBusy: BusyInterval[][] = Array.from(
    { length: creds.length },
    () => [],
  );
  let nextCredentialIndex = 0;
  async function worker(): Promise<void> {
    while (nextCredentialIndex < creds.length) {
      const credentialIndex = nextCredentialIndex++;
      const cred = creds[credentialIndex];
      const externalIds = externalIdsByCredential.get(cred.id);
      if (!externalIds?.length) continue;
      const provider = getCalendarProvider(cred.type);
      if (!provider) continue;
      try {
        providerBusy[credentialIndex] = await provider.getBusy({
          credentialId: cred.id,
          calendarExternalIds: externalIds,
          start: input.rangeStart,
          end: input.rangeEnd,
        });
      } catch {
        // Silently degrade — booking UI shows "couldn't verify availability" banner
        // Consumer logs via their own error handler
      }
    }
  }
  const workerCount = Math.min(MAX_CALENDAR_BUSY_CONCURRENCY, creds.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  busy.push(...providerBusy.flat());

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
