import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as schema from "../schema/index.js";
import type { EventType } from "../shared/index.js";
import { SlotConflictError } from "./availability-engine.js";
import { createBooking, rescheduleBooking } from "./booking-service.js";
import { getBookingByUid, insertBooking } from "./bookings-repo.js";
import { setSchedulingContext } from "./context.js";
import { registerCalendarProvider } from "./providers/registry.js";
import type { CalendarProvider } from "./providers/types.js";

const HOST_EMAIL = "host@example.com";
const ATTENDEE_EMAIL = "attendee@example.com";
const GUEST_EMAIL = "guest@example.com";

let client: Client;
let dbDir: string;

function makeEventType(overrides: Partial<EventType> = {}): EventType {
  const now = new Date().toISOString();
  return {
    id: "event-type-1",
    title: "30 Min Meeting",
    slug: "30min",
    length: 30,
    hidden: false,
    position: 0,
    schedulingType: "personal",
    ownerEmail: HOST_EMAIL,
    locations: [],
    customFields: [],
    minimumBookingNotice: 0,
    beforeEventBuffer: 0,
    afterEventBuffer: 0,
    slotInterval: null,
    periodType: "unlimited",
    requiresConfirmation: false,
    disableGuests: false,
    hideCalendarNotes: false,
    lockTimeZoneToggle: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCalendarProvider(
  kind: string,
  createEvent: CalendarProvider["createEvent"],
): CalendarProvider {
  return {
    kind,
    label: `Test provider ${kind}`,
    startOAuth: async () => ({ authUrl: "https://example.test/oauth" }),
    completeOAuth: async () => ({
      externalEmail: "provider-test@example.com",
      calendars: [],
    }),
    listCalendars: async () => [],
    getBusy: async () => [],
    createEvent,
    updateEvent: async () => ({ iCalSequence: 1 }),
    deleteEvent: async () => {},
  };
}

beforeEach(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "scheduling-booking-test-"));
  client = createClient({ url: `file:${join(dbDir, `${randomUUID()}.db`)}` });
  await client.execute(`
    CREATE TABLE bookings (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      event_type_id TEXT NOT NULL,
      host_email TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'confirmed',
      location TEXT,
      custom_responses TEXT,
      cancel_token TEXT,
      reschedule_token TEXT,
      from_reschedule TEXT,
      cancellation_reason TEXT,
      rescheduling_reason TEXT,
      ical_uid TEXT NOT NULL,
      ical_sequence INTEGER NOT NULL DEFAULT 0,
      recurring_event_id TEXT,
      paid INTEGER NOT NULL DEFAULT 0,
      no_show_host INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);
  await client.execute(`
    CREATE TABLE booking_attendees (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      timezone TEXT,
      locale TEXT,
      no_show INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  await client.execute(`
    CREATE TABLE booking_references (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      meeting_url TEXT,
      meeting_password TEXT,
      credential_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await client.execute(`
    CREATE TABLE destination_calendars (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      integration TEXT NOT NULL,
      external_id TEXT NOT NULL,
      primary_email TEXT,
      event_type_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await client.execute(`
    CREATE TABLE scheduling_credentials (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_email TEXT,
      team_id TEXT,
      app_id TEXT,
      oauth_token_id TEXT,
      display_name TEXT,
      external_email TEXT,
      invalid INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await client.execute(`
    CREATE TABLE selected_calendars (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      external_id TEXT NOT NULL,
      integration TEXT NOT NULL,
      event_type_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await client.execute(`
    CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger TEXT NOT NULL,
      team_id TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      active_on_event_type_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);
  await client.execute(`
    CREATE TABLE webhooks (
      id TEXT PRIMARY KEY,
      name TEXT,
      subscriber_url TEXT NOT NULL,
      secret TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      event_triggers TEXT NOT NULL DEFAULT '[]',
      team_id TEXT,
      event_type_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);
  await client.execute(`
    CREATE TABLE event_types (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      length INTEGER NOT NULL DEFAULT 30,
      durations TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      scheduling_type TEXT NOT NULL DEFAULT 'personal',
      team_id TEXT,
      locations TEXT,
      custom_fields TEXT,
      schedule_id TEXT,
      minimum_booking_notice INTEGER NOT NULL DEFAULT 0,
      before_event_buffer INTEGER NOT NULL DEFAULT 0,
      after_event_buffer INTEGER NOT NULL DEFAULT 0,
      slot_interval INTEGER,
      period_type TEXT NOT NULL DEFAULT 'rolling',
      period_days INTEGER DEFAULT 60,
      period_start_date TEXT,
      period_end_date TEXT,
      seats_per_time_slot INTEGER,
      requires_confirmation INTEGER NOT NULL DEFAULT 0,
      disable_guests INTEGER NOT NULL DEFAULT 0,
      hide_calendar_notes INTEGER NOT NULL DEFAULT 0,
      success_redirect_url TEXT,
      booking_limits TEXT,
      lock_time_zone_toggle INTEGER NOT NULL DEFAULT 0,
      recurring_event TEXT,
      event_name TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);

  const db = drizzle(client, { schema });
  setSchedulingContext({
    getDb: () => db,
    schema,
    getCurrentUserEmail: () => HOST_EMAIL,
  });
});

afterEach(() => {
  client.close();
  rmSync(dbDir, { recursive: true, force: true });
});

/** `rescheduleBooking` re-loads the event type by id, so it must exist. */
async function seedEventType(eventType: EventType): Promise<void> {
  await client.execute({
    sql: `INSERT INTO event_types (
      id, title, slug, description, length, durations, position, hidden, color,
      scheduling_type, team_id, locations, custom_fields, schedule_id,
      minimum_booking_notice, before_event_buffer, after_event_buffer, slot_interval,
      period_type, period_days, period_start_date, period_end_date,
      seats_per_time_slot, requires_confirmation, disable_guests, hide_calendar_notes,
      success_redirect_url, booking_limits, lock_time_zone_toggle, recurring_event,
      event_name, metadata, created_at, updated_at, owner_email, org_id, visibility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      eventType.id,
      eventType.title,
      eventType.slug,
      eventType.description ?? null,
      eventType.length,
      eventType.durations ? JSON.stringify(eventType.durations) : null,
      eventType.position,
      eventType.hidden ? 1 : 0,
      eventType.color ?? null,
      eventType.schedulingType,
      eventType.teamId ?? null,
      JSON.stringify(eventType.locations),
      JSON.stringify(eventType.customFields),
      eventType.scheduleId ?? null,
      eventType.minimumBookingNotice,
      eventType.beforeEventBuffer,
      eventType.afterEventBuffer,
      eventType.slotInterval,
      eventType.periodType,
      eventType.periodDays ?? null,
      eventType.periodStartDate ?? null,
      eventType.periodEndDate ?? null,
      eventType.seatsPerTimeSlot ?? null,
      eventType.requiresConfirmation ? 1 : 0,
      eventType.disableGuests ? 1 : 0,
      eventType.hideCalendarNotes ? 1 : 0,
      eventType.successRedirectUrl ?? null,
      eventType.bookingLimits ? JSON.stringify(eventType.bookingLimits) : null,
      eventType.lockTimeZoneToggle ? 1 : 0,
      eventType.recurringEvent
        ? JSON.stringify(eventType.recurringEvent)
        : null,
      eventType.eventName ?? null,
      eventType.metadata ? JSON.stringify(eventType.metadata) : null,
      eventType.createdAt,
      eventType.updatedAt,
      eventType.ownerEmail ?? "local@localhost",
      null,
      "private",
    ],
  });
}

describe("insertBooking", () => {
  it("writes the booking, attendees, and references together", async () => {
    const booking = await insertBooking({
      eventTypeId: "event-type-1",
      hostEmail: HOST_EMAIL,
      title: "Round trip meeting",
      startTime: "2026-08-03T10:00:00.000Z",
      endTime: "2026-08-03T10:30:00.000Z",
      timezone: "UTC",
      attendees: [
        { email: ATTENDEE_EMAIL, name: "Attendee One" },
        { email: GUEST_EMAIL, name: "Guest" },
      ],
      references: [{ type: "google_calendar", externalId: "gcal-event-1" }],
      ownerEmail: HOST_EMAIL,
    });

    expect(booking.hostEmail).toBe(HOST_EMAIL);
    expect(booking.attendees.map((a) => a.email).sort()).toEqual(
      [ATTENDEE_EMAIL, GUEST_EMAIL].sort(),
    );
    expect(booking.references).toEqual([
      expect.objectContaining({
        type: "google_calendar",
        externalId: "gcal-event-1",
      }),
    ]);

    const reloaded = await getBookingByUid(booking.uid);
    expect(reloaded?.attendees).toHaveLength(2);
    expect(reloaded?.references).toHaveLength(1);
  });

  it("rolls back the entire booking when an attendee write fails midway", async () => {
    await expect(
      insertBooking({
        eventTypeId: "event-type-1",
        hostEmail: HOST_EMAIL,
        title: "Doomed meeting",
        startTime: "2026-08-04T10:00:00.000Z",
        endTime: "2026-08-04T10:30:00.000Z",
        timezone: "UTC",
        attendees: [
          { email: ATTENDEE_EMAIL, name: "Attendee One" },
          // A null email violates the NOT NULL constraint after the first
          // attendee (and the booking row) have already been written —
          // proving the whole write is one atomic unit.
          { email: null as unknown as string, name: "Bad Attendee" },
        ],
        ownerEmail: HOST_EMAIL,
      }),
    ).rejects.toThrow();

    const { rows } = await client.execute("SELECT * FROM bookings");
    expect(rows).toHaveLength(0);
    const { rows: attendeeRows } = await client.execute(
      "SELECT * FROM booking_attendees",
    );
    expect(attendeeRows).toHaveLength(0);
  });
});

describe("createBooking", () => {
  it("creates a booking with attendees and references on a free slot", async () => {
    const now = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO destination_calendars
        (id, credential_id, user_email, integration, external_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["dest-1", "cred-1", HOST_EMAIL, "google_calendar", "primary", now],
    });
    registerCalendarProvider(
      makeCalendarProvider("google_calendar", async () => ({
        externalId: "gcal-event-free-slot",
      })),
    );

    const booking = await createBooking({
      eventType: makeEventType(),
      hostEmail: HOST_EMAIL,
      startTime: "2026-08-03T10:00:00.000Z",
      endTime: "2026-08-03T10:30:00.000Z",
      timezone: "UTC",
      attendee: { email: ATTENDEE_EMAIL, name: "Attendee One" },
      guests: [{ email: GUEST_EMAIL, name: "Guest" }],
    });

    expect(booking.status).toBe("confirmed");
    expect(booking.attendees.map((a) => a.email).sort()).toEqual(
      [ATTENDEE_EMAIL, GUEST_EMAIL].sort(),
    );
    expect(booking.references).toEqual([
      expect.objectContaining({
        type: "google_calendar",
        externalId: "gcal-event-free-slot",
      }),
    ]);
  });

  it("rejects a second booking that conflicts with an existing one for the same host", async () => {
    const eventType = makeEventType();
    await createBooking({
      eventType,
      hostEmail: HOST_EMAIL,
      startTime: "2026-08-05T10:00:00.000Z",
      endTime: "2026-08-05T10:30:00.000Z",
      timezone: "UTC",
      attendee: { email: ATTENDEE_EMAIL, name: "Attendee One" },
    });

    await expect(
      createBooking({
        eventType,
        hostEmail: HOST_EMAIL,
        startTime: "2026-08-05T10:00:00.000Z",
        endTime: "2026-08-05T10:30:00.000Z",
        timezone: "UTC",
        attendee: { email: GUEST_EMAIL, name: "Someone Else" },
      }),
    ).rejects.toBeInstanceOf(SlotConflictError);

    const { rows } = await client.execute(
      "SELECT * FROM bookings WHERE host_email = 'host@example.com'",
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects a request that only conflicts once the event type's buffer is applied", async () => {
    const plainEventType = makeEventType({ id: "event-type-plain" });
    await createBooking({
      eventType: plainEventType,
      hostEmail: HOST_EMAIL,
      startTime: "2026-08-06T10:00:00.000Z",
      endTime: "2026-08-06T10:30:00.000Z",
      timezone: "UTC",
      attendee: { email: ATTENDEE_EMAIL, name: "Attendee One" },
    });

    // Starts exactly when the first booking ends, so the raw windows don't
    // overlap — only the buffered event type's 15-minute lead-in collides.
    const bufferedEventType = makeEventType({
      id: "event-type-buffered",
      beforeEventBuffer: 15,
    });
    await expect(
      createBooking({
        eventType: bufferedEventType,
        hostEmail: HOST_EMAIL,
        startTime: "2026-08-06T10:30:00.000Z",
        endTime: "2026-08-06T11:00:00.000Z",
        timezone: "UTC",
        attendee: { email: GUEST_EMAIL, name: "Someone Else" },
      }),
    ).rejects.toBeInstanceOf(SlotConflictError);
  });

  it("allows an out-of-availability free slot once the conflicting booking is cancelled", async () => {
    // Sanity check that the conflict guard is scoped to the requested
    // window, not a blanket rejection — a later, non-overlapping slot for
    // the same host must still succeed.
    const eventType = makeEventType();
    await createBooking({
      eventType,
      hostEmail: HOST_EMAIL,
      startTime: "2026-08-07T10:00:00.000Z",
      endTime: "2026-08-07T10:30:00.000Z",
      timezone: "UTC",
      attendee: { email: ATTENDEE_EMAIL, name: "Attendee One" },
    });

    const booking = await createBooking({
      eventType,
      hostEmail: HOST_EMAIL,
      startTime: "2026-08-07T11:00:00.000Z",
      endTime: "2026-08-07T11:30:00.000Z",
      timezone: "UTC",
      attendee: { email: GUEST_EMAIL, name: "Someone Else" },
    });
    expect(booking.status).toBe("confirmed");
  });
});

describe("rescheduleBooking", () => {
  it("ignores the booking's own original slot when re-validating availability", async () => {
    const eventType = makeEventType();
    await seedEventType(eventType);
    const original = await createBooking({
      eventType,
      hostEmail: HOST_EMAIL,
      startTime: "2026-08-08T10:00:00.000Z",
      endTime: "2026-08-08T10:30:00.000Z",
      timezone: "UTC",
      attendee: { email: ATTENDEE_EMAIL, name: "Attendee One" },
    });

    // Reschedule to an overlapping-but-shifted slot; if the original
    // booking's own busy interval weren't excluded, this would always
    // conflict with itself.
    const rescheduled = await rescheduleBooking({
      uid: original.uid,
      newStartTime: "2026-08-08T10:15:00.000Z",
      newEndTime: "2026-08-08T10:45:00.000Z",
    });

    expect(rescheduled.startTime).toBe("2026-08-08T10:15:00.000Z");
    expect(rescheduled.fromReschedule).toBe(original.uid);
  });

  it("still rejects a reschedule that collides with a different booking", async () => {
    const eventType = makeEventType();
    await seedEventType(eventType);
    const original = await createBooking({
      eventType,
      hostEmail: HOST_EMAIL,
      startTime: "2026-08-09T10:00:00.000Z",
      endTime: "2026-08-09T10:30:00.000Z",
      timezone: "UTC",
      attendee: { email: ATTENDEE_EMAIL, name: "Attendee One" },
    });
    await createBooking({
      eventType,
      hostEmail: HOST_EMAIL,
      startTime: "2026-08-09T14:00:00.000Z",
      endTime: "2026-08-09T14:30:00.000Z",
      timezone: "UTC",
      attendee: { email: GUEST_EMAIL, name: "Someone Else" },
    });

    await expect(
      rescheduleBooking({
        uid: original.uid,
        newStartTime: "2026-08-09T14:00:00.000Z",
        newEndTime: "2026-08-09T14:30:00.000Z",
      }),
    ).rejects.toBeInstanceOf(SlotConflictError);

    // The original booking must stay intact after a failed reschedule
    // attempt — it should never be left marked "rescheduled" with no
    // successor.
    const stillOriginal = await getBookingByUid(original.uid);
    expect(stillOriginal?.status).toBe("confirmed");
  });
});
