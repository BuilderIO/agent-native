import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, createGetDb, getDbExec } from "@agent-native/core/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import addBookingAttendee from "../actions/add-booking-attendee.js";
import exportBookingsCsv from "../actions/export-bookings-csv.js";
import removeBookingAttendee from "../actions/remove-booking-attendee.js";
import * as schema from "../schema/index.js";
import type { EventType } from "../shared/index.js";
import { createBooking, rescheduleBooking } from "./booking-service.js";
import {
  BookingAttendeeOrderUnavailableError,
  getBookingByUid,
} from "./bookings-repo.js";
import { setSchedulingContext } from "./context.js";

const PRIMARY_EMAIL = "z-primary@example.com";
const A_GUEST_EMAIL = "a-guest@example.com";
const B_GUEST_EMAIL = "b-guest@example.com";
const SAME_CREATED_AT = "2026-08-01T09:00:00.000Z";

let dbDir: string;
let currentUserEmail: string | undefined;

function postgresSql(sql: string): string {
  let index = 0;
  // raw-sql-ok: renumbers ? placeholders; no values enter the text
  return sql.replace(/\?/g, () => "$" + ++index);
}

async function execute(statement: string | { sql: string; args?: unknown[] }) {
  if (typeof statement === "string")
    return getDbExec().execute(postgresSql(statement));
  return getDbExec().execute({
    ...statement,
    sql: postgresSql(statement.sql),
  });
}

beforeEach(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "scheduling-attendee-order-test-"));
  process.env.DATABASE_URL = `pglite:${dbDir}`;
  await execute(`
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
      paid BOOLEAN NOT NULL DEFAULT false,
      no_show_host BOOLEAN NOT NULL DEFAULT false,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);
  await execute(`
    CREATE TABLE booking_attendees (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      timezone TEXT,
      locale TEXT,
      no_show BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL
    );
  `);
  await execute(`
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
  await execute(`
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
  await execute(`
    CREATE TABLE scheduling_credentials (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_email TEXT,
      team_id TEXT,
      app_id TEXT,
      oauth_token_id TEXT,
      display_name TEXT,
      external_email TEXT,
      invalid BOOLEAN NOT NULL DEFAULT false,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await execute(`
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
  await execute(`
    CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger TEXT NOT NULL,
      team_id TEXT,
      disabled BOOLEAN NOT NULL DEFAULT false,
      active_on_event_type_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);
  await execute(`
    CREATE TABLE workflow_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      notified_at TEXT
    );
  `);
  await execute(`
    CREATE TABLE workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 0,
      action TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL DEFAULT 0,
      send_to TEXT,
      email_subject TEXT,
      email_body TEXT,
      sms_body TEXT,
      webhook_url TEXT,
      template TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await execute(`
    CREATE TABLE webhooks (
      id TEXT PRIMARY KEY,
      name TEXT,
      subscriber_url TEXT NOT NULL,
      secret TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
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
  await execute(`
    CREATE TABLE webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      response_status INTEGER,
      response_body TEXT,
      success BOOLEAN NOT NULL DEFAULT false,
      attempts INTEGER NOT NULL DEFAULT 0
    );
  `);
  await execute(`
    CREATE TABLE scheduled_reminders (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      workflow_step_id TEXT NOT NULL,
      method TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      sent BOOLEAN NOT NULL DEFAULT false,
      sent_at TEXT,
      failed BOOLEAN NOT NULL DEFAULT false,
      failure_reason TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  await execute(`
    CREATE TABLE event_types (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      length INTEGER NOT NULL DEFAULT 30,
      durations TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      hidden BOOLEAN NOT NULL DEFAULT false,
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
      requires_confirmation BOOLEAN NOT NULL DEFAULT false,
      disable_guests BOOLEAN NOT NULL DEFAULT false,
      hide_calendar_notes BOOLEAN NOT NULL DEFAULT false,
      success_redirect_url TEXT,
      booking_limits TEXT,
      lock_time_zone_toggle BOOLEAN NOT NULL DEFAULT false,
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
  await execute(`
    CREATE TABLE calendar_busy (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      external_id TEXT NOT NULL,
      integration TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  await execute(`
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);
  // Baseline booking-service fixture predates the v4 position column; the
  // attendee-order acceptance needs it present for the non-migration cases.
  await execute(`ALTER TABLE booking_attendees ADD COLUMN position INTEGER`);

  const db = createGetDb(schema)();
  currentUserEmail = PRIMARY_EMAIL;
  setSchedulingContext({
    getDb: () => db,
    schema,
    getCurrentUserEmail: () => currentUserEmail,
  });

  const now = new Date().toISOString();
  await execute({
    sql: `INSERT INTO event_types (id, title, slug, length, position, hidden, scheduling_type, locations, custom_fields, period_type, requires_confirmation, disable_guests, created_at, updated_at, owner_email, org_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "event-type-1",
      "Test Event",
      "test-event",
      30,
      0,
      false,
      "personal",
      "[]",
      "[]",
      "rolling",
      false,
      false,
      now,
      now,
      PRIMARY_EMAIL,
      null,
      "private",
    ],
  });
  await execute({
    sql: `INSERT INTO schedules (id, name, timezone, is_default, created_at, updated_at, owner_email, org_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "schedule-1",
      "Default Schedule",
      "UTC",
      true,
      now,
      now,
      PRIMARY_EMAIL,
      null,
      "private",
    ],
  });
});

afterEach(async () => {
  await closeDbExec();
  rmSync(dbDir, { recursive: true, force: true });
});

async function createTestBooking() {
  const now = new Date().toISOString();
  const eventType: EventType = {
    id: "event-type-1",
    title: "Test Event",
    slug: "test-event",
    length: 30,
    position: 0,
    hidden: false,
    schedulingType: "personal",
    locations: [],
    customFields: [],
    minimumBookingNotice: 0,
    beforeEventBuffer: 0,
    afterEventBuffer: 0,
    slotInterval: null,
    periodType: "rolling",
    periodDays: 60,
    requiresConfirmation: false,
    disableGuests: false,
    hideCalendarNotes: false,
    lockTimeZoneToggle: false,
    createdAt: now,
    updatedAt: now,
    ownerEmail: PRIMARY_EMAIL,
    orgId: null,
    visibility: "private",
  };

  // Persist the event type so rescheduleBooking can resolve it by id.
  await execute({
    sql: `INSERT INTO event_types (id, title, slug, length, locations, created_at, updated_at, owner_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    args: [
      "event-type-1",
      "Test Event",
      "test-event",
      30,
      "[]",
      now,
      now,
      PRIMARY_EMAIL,
    ],
  });

  const booking = await createBooking({
    eventType,
    hostEmail: PRIMARY_EMAIL,
    startTime: "2026-08-01T10:00:00.000Z",
    endTime: "2026-08-01T10:30:00.000Z",
    timezone: "UTC",
    title: "Test Meeting",
    attendee: { email: PRIMARY_EMAIL, name: "Primary" },
    guests: [
      { email: A_GUEST_EMAIL, name: "A Guest" },
      { email: B_GUEST_EMAIL, name: "B Guest" },
    ],
  });
  return booking;
}

describe("attendee order", () => {
  it("creates attendees in primary-first order", async () => {
    const booking = await createTestBooking();
    expect(booking.attendees.map((a) => a.email)).toEqual([
      PRIMARY_EMAIL,
      A_GUEST_EMAIL,
      B_GUEST_EMAIL,
    ]);
    expect(booking).toHaveProperty("attendeeOrderKnown", true);
  });

  it("keeps primary order when the primary row is physically moved", async () => {
    const booking = await createTestBooking();
    // Delete primary row
    await execute({
      sql: "DELETE FROM booking_attendees WHERE booking_id = ? AND email = ?",
      args: [booking.id, PRIMARY_EMAIL],
    });
    // Reinsert primary row with same fields including its logical position
    // (new id, but the durable position value must survive the relocation).
    await execute({
      sql: "INSERT INTO booking_attendees (id, booking_id, email, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [
        "new-primary-id",
        booking.id,
        PRIMARY_EMAIL,
        "Primary",
        0,
        SAME_CREATED_AT,
      ],
    });
    const fetched = await getBookingByUid(booking.uid);
    expect(fetched?.attendees.map((a) => a.email)).toEqual([
      PRIMARY_EMAIL,
      A_GUEST_EMAIL,
      B_GUEST_EMAIL,
    ]);
    expect(fetched).toHaveProperty("attendeeOrderKnown", true);
  });

  it("appends a new guest to the end of the attendee list", async () => {
    const booking = await createTestBooking();
    await addBookingAttendee.run({
      uid: booking.uid,
      name: "C Guest",
      email: "c-guest@example.com",
    });
    const fetched = await getBookingByUid(booking.uid);
    expect(fetched?.attendees.map((a) => a.email)).toEqual([
      PRIMARY_EMAIL,
      A_GUEST_EMAIL,
      B_GUEST_EMAIL,
      "c-guest@example.com",
    ]);
    expect(fetched).toHaveProperty("attendeeOrderKnown", true);
  });

  it("preserves order after removing a guest", async () => {
    const booking = await createTestBooking();
    await removeBookingAttendee.run({
      uid: booking.uid,
      email: A_GUEST_EMAIL,
    });
    const fetched = await getBookingByUid(booking.uid);
    expect(fetched?.attendees.map((a) => a.email)).toEqual([
      PRIMARY_EMAIL,
      B_GUEST_EMAIL,
    ]);
    expect(fetched).toHaveProperty("attendeeOrderKnown", true);
  });

  it("allows adding a new attendee after all attendees are removed", async () => {
    const booking = await createTestBooking();
    await removeBookingAttendee.run({ uid: booking.uid, email: PRIMARY_EMAIL });
    await removeBookingAttendee.run({ uid: booking.uid, email: A_GUEST_EMAIL });
    await removeBookingAttendee.run({ uid: booking.uid, email: B_GUEST_EMAIL });

    await addBookingAttendee.run({
      uid: booking.uid,
      name: "New Primary",
      email: "new-primary@example.com",
    });
    const fetched = await getBookingByUid(booking.uid);
    expect(fetched?.attendees.map((a) => a.email)).toEqual([
      "new-primary@example.com",
    ]);
    expect(fetched).toHaveProperty("attendeeOrderKnown", true);
  });

  it("flags attendeeOrderKnown false when all positions are null for multiple attendees", async () => {
    const booking = await createTestBooking();
    await execute({
      sql: "UPDATE booking_attendees SET position = NULL WHERE booking_id = ?",
      args: [booking.id],
    });
    const fetched = await getBookingByUid(booking.uid);
    expect(fetched).toHaveProperty("attendeeOrderKnown", false);
  });

  it("flags attendeeOrderKnown true for a single legacy attendee with null position", async () => {
    const booking = await createTestBooking();
    await removeBookingAttendee.run({ uid: booking.uid, email: A_GUEST_EMAIL });
    await removeBookingAttendee.run({ uid: booking.uid, email: B_GUEST_EMAIL });
    await execute({
      sql: "UPDATE booking_attendees SET position = NULL WHERE booking_id = ?",
      args: [booking.id],
    });
    const fetched = await getBookingByUid(booking.uid);
    expect(fetched).toHaveProperty("attendeeOrderKnown", true);
  });

  it("flags attendeeOrderKnown false for mixed positions", async () => {
    const booking = await createTestBooking();
    await execute({
      sql: "UPDATE booking_attendees SET position = 0 WHERE booking_id = ? AND email = ?",
      args: [booking.id, PRIMARY_EMAIL],
    });
    await execute({
      sql: "UPDATE booking_attendees SET position = NULL WHERE booking_id = ? AND email = ?",
      args: [booking.id, A_GUEST_EMAIL],
    });
    const fetched = await getBookingByUid(booking.uid);
    expect(fetched).toHaveProperty("attendeeOrderKnown", false);
  });

  it("flags attendeeOrderKnown false for duplicate positions", async () => {
    const booking = await createTestBooking();
    await execute({
      sql: "UPDATE booking_attendees SET position = 0 WHERE booking_id = ? AND email = ?",
      args: [booking.id, PRIMARY_EMAIL],
    });
    await execute({
      sql: "UPDATE booking_attendees SET position = 0 WHERE booking_id = ? AND email = ?",
      args: [booking.id, A_GUEST_EMAIL],
    });
    const fetched = await getBookingByUid(booking.uid);
    expect(fetched).toHaveProperty("attendeeOrderKnown", false);
  });

  it("fails reschedule before mutation when order is unknown", async () => {
    const booking = await createTestBooking();
    await execute({
      sql: "UPDATE booking_attendees SET position = NULL WHERE booking_id = ?",
      args: [booking.id],
    });
    let rescheduleError: unknown;
    try {
      await rescheduleBooking({
        uid: booking.uid,
        newStartTime: "2026-08-02T10:00:00.000Z",
        newEndTime: "2026-08-02T10:30:00.000Z",
      });
    } catch (error) {
      rescheduleError = error;
    }
    expect(rescheduleError).toBeInstanceOf(
      BookingAttendeeOrderUnavailableError,
    );
    const typedRescheduleError =
      rescheduleError as BookingAttendeeOrderUnavailableError;
    expect(typedRescheduleError.name).toBe(
      "BookingAttendeeOrderUnavailableError",
    );
    expect(typedRescheduleError.errorCode).toBe("attendee_order_unavailable");
    expect(typedRescheduleError.statusCode).toBe(422);
    expect(typedRescheduleError.message).toBe(
      "Could not determine the primary attendee for this booking.",
    );

    const original = await getBookingByUid(booking.uid);
    expect(original?.status).toBe("confirmed");
    expect(original?.startTime).toBe("2026-08-01T10:00:00.000Z");
  });

  it("reschedules with primary-first order after the primary row is physically moved", async () => {
    const booking = await createTestBooking();
    // Physically move the primary row after the guests by delete + reinsert.
    await execute({
      sql: "DELETE FROM booking_attendees WHERE booking_id = ? AND email = ?",
      args: [booking.id, PRIMARY_EMAIL],
    });
    await execute({
      sql: "INSERT INTO booking_attendees (id, booking_id, email, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [
        "moved-primary-id",
        booking.id,
        PRIMARY_EMAIL,
        "Primary",
        0,
        SAME_CREATED_AT,
      ],
    });

    const rescheduled = await rescheduleBooking({
      uid: booking.uid,
      newStartTime: "2026-08-02T10:00:00.000Z",
      newEndTime: "2026-08-02T10:30:00.000Z",
    });
    expect(rescheduled.attendees.map((a) => a.email)).toEqual([
      PRIMARY_EMAIL,
      A_GUEST_EMAIL,
      B_GUEST_EMAIL,
    ]);

    const original = await getBookingByUid(booking.uid);
    expect(original?.status).toBe("rescheduled");
  });

  it("fails export before mutation when order is unknown", async () => {
    const booking = await createTestBooking();
    await execute({
      sql: "UPDATE booking_attendees SET position = NULL WHERE booking_id = ?",
      args: [booking.id],
    });
    let exportError: unknown;
    try {
      await exportBookingsCsv.run({});
    } catch (error) {
      exportError = error;
    }
    expect(exportError).toBeInstanceOf(BookingAttendeeOrderUnavailableError);
    const typedExportError =
      exportError as BookingAttendeeOrderUnavailableError;
    expect(typedExportError.name).toBe("BookingAttendeeOrderUnavailableError");
    expect(typedExportError.errorCode).toBe("attendee_order_unavailable");
    expect(typedExportError.statusCode).toBe(422);
    expect(typedExportError.message).toBe(
      "Could not determine the primary attendee for this booking.",
    );
  });

  it("exports the primary attendee in CSV", async () => {
    await createTestBooking();
    const result = await exportBookingsCsv.run({});
    expect(result.csv).toContain(PRIMARY_EMAIL);
  });

  it("rejects non-host adding or removing attendees", async () => {
    const booking = await createTestBooking();
    currentUserEmail = "not-host@example.com";
    await expect(
      addBookingAttendee.run({
        uid: booking.uid,
        name: "Intruder",
        email: "intruder@example.com",
      }),
    ).rejects.toThrow(/Not authorized/i);

    await expect(
      removeBookingAttendee.run({
        uid: booking.uid,
        email: A_GUEST_EMAIL,
      }),
    ).rejects.toThrow(/Not authorized/i);

    const fetched = await getBookingByUid(booking.uid);
    expect(fetched?.attendees.map((a) => a.email)).toEqual([
      PRIMARY_EMAIL,
      A_GUEST_EMAIL,
      B_GUEST_EMAIL,
    ]);
  });

  it("allows the host to remove the primary attendee", async () => {
    const booking = await createTestBooking();
    await removeBookingAttendee.run({ uid: booking.uid, email: PRIMARY_EMAIL });
    const fetched = await getBookingByUid(booking.uid);
    expect(fetched?.attendees.map((a) => a.email)).toEqual([
      A_GUEST_EMAIL,
      B_GUEST_EMAIL,
    ]);
    expect(fetched).toHaveProperty("attendeeOrderKnown", true);
  });
});
