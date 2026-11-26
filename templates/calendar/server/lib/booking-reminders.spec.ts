import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const sendEmailMock = vi.hoisted(() =>
  vi.fn<
    (args: {
      to: string;
      subject: string;
      html: string;
      replyTo?: string;
      templateId?: string;
    }) => Promise<void>
  >(),
);
const isEmailConfiguredMock = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

vi.mock("../db/index.js", async () => {
  const schema =
    await vi.importActual<typeof import("../db/schema.js")>("../db/schema.js");
  return { getDb: getDbMock, schema };
});

vi.mock("@agent-native/core/server", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/server")
  >("@agent-native/core/server");
  return {
    ...actual,
    getAppProductionUrl: () => "https://calendar.example.test",
    withConfiguredAppBasePath: (url: string) => url,
    isEmailConfigured: isEmailConfiguredMock,
    sendEmail: sendEmailMock,
  };
});

vi.mock("./booking-timezone.js", async () => {
  const actual = await vi.importActual<typeof import("./booking-timezone.js")>(
    "./booking-timezone.js",
  );
  return {
    ...actual,
    getOwnerBookingTimeZone: async () => "America/New_York",
  };
});

import * as dbModule from "../db/index.js";
import {
  bookingReminderDecision,
  nextBookingReminderDueAt,
  runBookingRemindersOnce,
} from "./booking-reminders.js";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse("2026-12-01T12:00:00.000Z");
const host = "host@example.test";

const DDL = `
  CREATE TABLE bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    additional_guest_emails TEXT,
    start TEXT NOT NULL,
    "end" TEXT NOT NULL,
    slug TEXT NOT NULL,
    event_title TEXT,
    notes TEXT,
    field_responses TEXT,
    meeting_link TEXT,
    meeting_link_pending BOOLEAN NOT NULL DEFAULT false,
    google_event_id TEXT,
    calendar_account_id TEXT,
    cancel_token TEXT,
    zoom_needs_review BOOLEAN NOT NULL DEFAULT false,
    zoom_meeting_id TEXT,
    zoom_account_id TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL,
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    reminder_handled_at TEXT,
    reminder_next_attempt_at TEXT
  );
  CREATE TABLE booking_links (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    duration INTEGER NOT NULL DEFAULT 30,
    durations TEXT,
    hosts TEXT,
    custom_fields TEXT,
    conferencing TEXT,
    color TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    reminder_minutes INTEGER NOT NULL DEFAULT 1440,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    owner_email TEXT NOT NULL DEFAULT 'local@localhost',
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
  );
  CREATE TABLE booking_slug_redirects (
    old_slug TEXT PRIMARY KEY,
    new_slug TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

function iso(ms: number) {
  return new Date(ms).toISOString();
}

describe("booking reminder timing", () => {
  const start = iso(NOW + 2 * HOUR_MS);

  it("waits until the reminder time", () => {
    expect(
      bookingReminderDecision(
        { start, createdAt: iso(NOW - DAY_MS), reminderMinutes: 60 },
        NOW,
      ),
    ).toBe("wait");
  });

  it("sends once the reminder time has passed", () => {
    expect(
      bookingReminderDecision(
        { start, createdAt: iso(NOW - DAY_MS), reminderMinutes: 1440 },
        NOW,
      ),
    ).toBe("send");
  });

  it("skips a booking made after its reminder time", () => {
    expect(
      bookingReminderDecision(
        { start, createdAt: iso(NOW - HOUR_MS), reminderMinutes: 1440 },
        NOW,
      ),
    ).toBe("skip");
  });

  it("skips a meeting that has started", () => {
    expect(
      bookingReminderDecision(
        {
          start: iso(NOW - 1),
          createdAt: iso(NOW - DAY_MS * 2),
          reminderMinutes: 60,
        },
        NOW,
      ),
    ).toBe("skip");
  });
});

describe("booking reminders", () => {
  let client: PGlite;

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    getDbMock.mockReset();
    getDbMock.mockReturnValue(drizzle(client, { schema: dbModule.schema }));
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(undefined);
    isEmailConfiguredMock.mockReset();
    isEmailConfiguredMock.mockResolvedValue(true);
    await client.exec(DDL);
    await addLink({ slug: "intro", reminderMinutes: 1440 });
  });

  afterEach(async () => {
    await client.close();
  });

  async function addLink({
    slug,
    reminderMinutes,
  }: {
    slug: string;
    reminderMinutes: number;
  }) {
    await client.query(
      `INSERT INTO booking_links (id, slug, title, reminder_minutes, created_at, updated_at, owner_email)
       VALUES ($1, $2, 'Intro call', $3, $4, $4, $5)`,
      [`link-${slug}`, slug, reminderMinutes, iso(NOW - 30 * DAY_MS), host],
    );
  }

  async function addBooking({
    id,
    slug = "intro",
    startMs,
    createdMs = NOW - 7 * DAY_MS,
    status = "confirmed",
    guests,
  }: {
    id: string;
    slug?: string;
    startMs: number;
    createdMs?: number;
    status?: string;
    guests?: string[];
  }) {
    await client.query(
      `INSERT INTO bookings (id, name, email, additional_guest_emails, start, "end", slug, event_title, meeting_link, cancel_token, status, created_at, owner_email)
       VALUES ($1, 'Sam Rivera', 'sam@example.test', $2, $3, $4, $5, 'Intro call', 'https://meet.example.test/intro', $6, $7, $8, $9)`,
      [
        id,
        guests ? JSON.stringify(guests) : null,
        iso(startMs),
        iso(startMs + 30 * 60_000),
        slug,
        `cancel-${id}`,
        status,
        iso(createdMs),
        host,
      ],
    );
  }

  async function handledAt(id: string) {
    const result = await client.query<{ reminder_handled_at: string | null }>(
      "SELECT reminder_handled_at FROM bookings WHERE id = $1",
      [id],
    );
    return result.rows.map((row) => row.reminder_handled_at);
  }

  it("emails the booker and their guests once, with the manage link", async () => {
    await addBooking({
      id: "b1",
      startMs: NOW + 20 * HOUR_MS,
      guests: ["pat@example.test"],
    });

    await expect(runBookingRemindersOnce(undefined, NOW)).resolves.toEqual({
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    expect(sendEmailMock.mock.calls.map(([args]) => args.to)).toEqual([
      "sam@example.test",
      "pat@example.test",
    ]);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "sam@example.test",
        subject: "Reminder: Intro call",
        replyTo: host,
        templateId: "calendar.booking-reminder",
        html: expect.stringContaining(
          "https://calendar.example.test/booking/manage/cancel-b1",
        ),
      }),
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "sam@example.test",
        html: expect.stringContaining("https://meet.example.test/intro"),
      }),
    );
    await expect(handledAt("b1")).resolves.toEqual([iso(NOW)]);

    sendEmailMock.mockClear();
    await expect(
      runBookingRemindersOnce(undefined, NOW + 60_000),
    ).resolves.toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("sends one reminder when two sweeps overlap", async () => {
    await addBooking({ id: "b1", startMs: NOW + 20 * HOUR_MS });

    const results = await Promise.all([
      runBookingRemindersOnce(undefined, NOW),
      runBookingRemindersOnce(undefined, NOW),
    ]);

    expect(results.reduce((total, result) => total + result.sent, 0)).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("waits for a booking whose reminder isn't due yet", async () => {
    await addBooking({ id: "b1", startMs: NOW + 25 * HOUR_MS });

    await runBookingRemindersOnce(undefined, NOW);

    expect(sendEmailMock).not.toHaveBeenCalled();
    await expect(handledAt("b1")).resolves.toEqual([null]);
  });

  it("never reminds a cancelled booking", async () => {
    await addBooking({
      id: "b1",
      startMs: NOW + 20 * HOUR_MS,
      status: "cancelled",
    });

    await runBookingRemindersOnce(undefined, NOW);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips a booking made after its reminder time without emailing", async () => {
    await addBooking({
      id: "b1",
      startMs: NOW + 3 * HOUR_MS,
      createdMs: NOW - HOUR_MS,
    });

    await expect(runBookingRemindersOnce(undefined, NOW)).resolves.toEqual({
      sent: 0,
      skipped: 1,
      failed: 0,
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    await expect(handledAt("b1")).resolves.toEqual([iso(NOW)]);
  });

  it("tries again later when nobody received the reminder", async () => {
    sendEmailMock.mockRejectedValue(new Error("provider down"));
    await addBooking({ id: "b1", startMs: NOW + 20 * HOUR_MS });

    await expect(runBookingRemindersOnce(undefined, NOW)).resolves.toEqual({
      sent: 0,
      skipped: 0,
      failed: 1,
    });
    await expect(handledAt("b1")).resolves.toEqual([null]);
    await expect(nextBookingReminderDueAt(NOW + 60_000)).resolves.toBe(
      NOW + 15 * 60_000,
    );

    sendEmailMock.mockClear();
    await runBookingRemindersOnce(undefined, NOW + 60_000);
    expect(sendEmailMock).not.toHaveBeenCalled();

    sendEmailMock.mockResolvedValue(undefined);
    await expect(
      runBookingRemindersOnce(undefined, NOW + 15 * 60_000),
    ).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 });
    await expect(handledAt("b1")).resolves.toEqual([iso(NOW + 15 * 60_000)]);
  });

  it("doesn't email the booker twice when only a guest's email fails", async () => {
    sendEmailMock.mockImplementation(async ({ to }) => {
      if (to === "pat@example.test") throw new Error("rejected");
    });
    await addBooking({
      id: "b1",
      startMs: NOW + 20 * HOUR_MS,
      guests: ["pat@example.test"],
    });

    await expect(runBookingRemindersOnce(undefined, NOW)).resolves.toEqual({
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    await expect(handledAt("b1")).resolves.toEqual([iso(NOW)]);
  });

  it("sends nothing while a link's reminder is off, and resumes when it's on", async () => {
    await addLink({ slug: "quiet", reminderMinutes: 0 });
    await addBooking({ id: "b1", slug: "quiet", startMs: NOW + 20 * HOUR_MS });

    await runBookingRemindersOnce(undefined, NOW);
    expect(sendEmailMock).not.toHaveBeenCalled();
    await expect(handledAt("b1")).resolves.toEqual([null]);

    await client.query(
      "UPDATE booking_links SET reminder_minutes = 1440 WHERE slug = 'quiet'",
    );
    await runBookingRemindersOnce(undefined, NOW);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("follows a renamed link to its reminder setting", async () => {
    await client.query(
      "UPDATE booking_links SET slug = 'intro-call', reminder_minutes = 60 WHERE slug = 'intro'",
    );
    await client.query(
      "INSERT INTO booking_slug_redirects (old_slug, new_slug, created_at) VALUES ('intro', 'intro-call', $1)",
      [iso(NOW - DAY_MS)],
    );
    await addBooking({ id: "b1", startMs: NOW + 20 * HOUR_MS });
    await addBooking({ id: "b2", startMs: NOW + 30 * 60_000 });

    await runBookingRemindersOnce(undefined, NOW);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    await expect(handledAt("b1")).resolves.toEqual([null]);
    await expect(handledAt("b2")).resolves.toEqual([iso(NOW)]);
  });

  it("leaves bookings alone when email isn't configured", async () => {
    isEmailConfiguredMock.mockResolvedValue(false);
    await addBooking({ id: "b1", startMs: NOW + 20 * HOUR_MS });

    await runBookingRemindersOnce(undefined, NOW);

    expect(sendEmailMock).not.toHaveBeenCalled();
    await expect(handledAt("b1")).resolves.toEqual([null]);
  });

  it("wakes for the earliest reminder across links", async () => {
    await addLink({ slug: "soon", reminderMinutes: 60 });
    await addBooking({ id: "b1", startMs: NOW + 30 * HOUR_MS });
    await addBooking({ id: "b2", slug: "soon", startMs: NOW + 4 * HOUR_MS });

    await expect(nextBookingReminderDueAt(NOW)).resolves.toBe(
      NOW + 3 * HOUR_MS,
    );
  });

  it("wakes right away for a reminder that's already due", async () => {
    await addBooking({ id: "b1", startMs: NOW + 20 * HOUR_MS });

    await expect(nextBookingReminderDueAt(NOW)).resolves.toBe(NOW);
  });

  it("has nothing to wake for without upcoming reminders", async () => {
    await addLink({ slug: "quiet", reminderMinutes: 0 });
    await addBooking({ id: "b1", startMs: NOW - HOUR_MS });
    await addBooking({ id: "b2", slug: "quiet", startMs: NOW + 20 * HOUR_MS });

    await expect(nextBookingReminderDueAt(NOW)).resolves.toBeNull();
  });

  it("has nothing to wake for when email isn't configured", async () => {
    isEmailConfiguredMock.mockResolvedValue(false);
    await addBooking({ id: "b1", startMs: NOW + 20 * HOUR_MS });

    await expect(nextBookingReminderDueAt(NOW)).resolves.toBeNull();
  });
});
