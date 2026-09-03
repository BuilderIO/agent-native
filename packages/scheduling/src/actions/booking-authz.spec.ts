/**
 * Cross-tenant write (IDOR) regression tests for booking actions that
 * mutate — or disclose a capability token for — a booking that belongs to
 * another host. Mirrors the `isHost` guard already proven in
 * `cancel-booking.ts` / `reschedule-booking.ts`.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as schema from "../schema/index.js";
import { setSchedulingContext } from "../server/context.js";
import addBookingAttendee from "./add-booking-attendee.js";
import addBookingNote from "./add-booking-note.js";
import confirmBooking from "./confirm-booking.js";
import markNoShow from "./mark-no-show.js";
import removeBookingAttendee from "./remove-booking-attendee.js";
import sendRescheduleLink from "./send-reschedule-link.js";

const HOST_EMAIL = "host@example.com";
const OUTSIDER_EMAIL = "outsider@example.com";
const BOOKING_UID = "booking-uid-1";
const ATTENDEE_EMAIL = "attendee@example.com";

let client: Client;
let dbDir: string;
let currentUserEmail: string | undefined;

beforeEach(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "scheduling-booking-authz-test-"));
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
    CREATE TABLE booking_notes (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      author_email TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const db = drizzle(client, { schema });
  currentUserEmail = HOST_EMAIL;
  setSchedulingContext({
    getDb: () => db,
    schema,
    getCurrentUserEmail: () => currentUserEmail,
  });

  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO bookings (
      id, uid, event_type_id, host_email, title, start_time, end_time,
      timezone, status, cancel_token, reschedule_token, ical_uid, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      "booking-1",
      BOOKING_UID,
      "event-type-1",
      HOST_EMAIL,
      "Test Meeting",
      "2026-08-01T10:00:00.000Z",
      "2026-08-01T10:30:00.000Z",
      "UTC",
      "pending",
      "cancel-token-1",
      "reschedule-token-1",
      "ical-uid-1",
      now,
      now,
    ],
  });
  await client.execute({
    sql: `INSERT INTO booking_attendees (id, booking_id, email, name, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: ["attendee-1", "booking-1", ATTENDEE_EMAIL, "Attendee One", now],
  });
});

afterEach(() => {
  client.close();
  rmSync(dbDir, { recursive: true, force: true });
});

async function bookingStatus(): Promise<string> {
  const { rows } = await client.execute({
    sql: "SELECT status FROM bookings WHERE uid = ?",
    args: [BOOKING_UID],
  });
  return String(rows[0]?.status);
}

async function attendeeEmails(): Promise<string[]> {
  const { rows } = await client.execute({
    sql: "SELECT email FROM booking_attendees WHERE booking_id = 'booking-1'",
  });
  return rows.map((r: any) => String(r.email)).sort();
}

async function attendeeNoShow(email: string): Promise<boolean> {
  const { rows } = await client.execute({
    sql: "SELECT no_show FROM booking_attendees WHERE booking_id = 'booking-1' AND email = ?",
    args: [email],
  });
  return Boolean(rows[0]?.no_show);
}

async function noteCount(): Promise<number> {
  const { rows } = await client.execute("SELECT * FROM booking_notes");
  return rows.length;
}

describe("confirm-booking authorization", () => {
  it("rejects a non-host caller and leaves the booking unchanged", async () => {
    currentUserEmail = OUTSIDER_EMAIL;
    await expect(confirmBooking.run({ uid: BOOKING_UID })).rejects.toThrow(
      /not authorized/i,
    );
    expect(await bookingStatus()).toBe("pending");
  });

  it("allows the host to confirm the booking", async () => {
    currentUserEmail = HOST_EMAIL;
    const result: any = await confirmBooking.run({ uid: BOOKING_UID });
    expect(result.booking?.status).toBe("confirmed");
    expect(await bookingStatus()).toBe("confirmed");
  });
});

describe("mark-no-show authorization", () => {
  it("rejects a non-host caller and leaves the attendee unchanged", async () => {
    currentUserEmail = OUTSIDER_EMAIL;
    await expect(
      markNoShow.run({ uid: BOOKING_UID, attendeeEmail: ATTENDEE_EMAIL }),
    ).rejects.toThrow(/not authorized/i);
    expect(await attendeeNoShow(ATTENDEE_EMAIL)).toBe(false);
  });

  it("allows the host to mark an attendee no-show", async () => {
    currentUserEmail = HOST_EMAIL;
    const result: any = await markNoShow.run({
      uid: BOOKING_UID,
      attendeeEmail: ATTENDEE_EMAIL,
    });
    expect(result.ok).toBe(true);
    expect(await attendeeNoShow(ATTENDEE_EMAIL)).toBe(true);
  });
});

describe("add-booking-attendee authorization", () => {
  it("rejects a non-host caller and does not add the attendee", async () => {
    currentUserEmail = OUTSIDER_EMAIL;
    await expect(
      addBookingAttendee.run({
        uid: BOOKING_UID,
        name: "Intruder",
        email: "intruder@example.com",
      }),
    ).rejects.toThrow(/not authorized/i);
    expect(await attendeeEmails()).toEqual([ATTENDEE_EMAIL]);
  });

  it("allows the host to add an attendee", async () => {
    currentUserEmail = HOST_EMAIL;
    await addBookingAttendee.run({
      uid: BOOKING_UID,
      name: "New Guest",
      email: "guest@example.com",
    });
    expect(await attendeeEmails()).toEqual(
      [ATTENDEE_EMAIL, "guest@example.com"].sort(),
    );
  });
});

describe("remove-booking-attendee authorization", () => {
  it("rejects a non-host caller and does not remove the attendee", async () => {
    currentUserEmail = OUTSIDER_EMAIL;
    await expect(
      removeBookingAttendee.run({ uid: BOOKING_UID, email: ATTENDEE_EMAIL }),
    ).rejects.toThrow(/not authorized/i);
    expect(await attendeeEmails()).toEqual([ATTENDEE_EMAIL]);
  });

  it("allows the host to remove an attendee", async () => {
    currentUserEmail = HOST_EMAIL;
    await removeBookingAttendee.run({
      uid: BOOKING_UID,
      email: ATTENDEE_EMAIL,
    });
    expect(await attendeeEmails()).toEqual([]);
  });
});

describe("add-booking-note authorization", () => {
  it("rejects a non-host caller and does not create a note", async () => {
    currentUserEmail = OUTSIDER_EMAIL;
    await expect(
      addBookingNote.run({ uid: BOOKING_UID, content: "snooping" }),
    ).rejects.toThrow(/not authorized/i);
    expect(await noteCount()).toBe(0);
  });

  it("allows the host to add a note", async () => {
    currentUserEmail = HOST_EMAIL;
    const result: any = await addBookingNote.run({
      uid: BOOKING_UID,
      content: "host note",
    });
    expect(result.id).toBeTruthy();
    expect(await noteCount()).toBe(1);
  });
});

describe("send-reschedule-link authorization", () => {
  it("rejects a non-host caller and never returns the reschedule token", async () => {
    currentUserEmail = OUTSIDER_EMAIL;
    await expect(sendRescheduleLink.run({ uid: BOOKING_UID })).rejects.toThrow(
      /not authorized/i,
    );
  });

  it("returns the reschedule URL with token for the host", async () => {
    currentUserEmail = HOST_EMAIL;
    const result: any = await sendRescheduleLink.run({ uid: BOOKING_UID });
    expect(result.url).toContain("reschedule-token-1");
  });
});
