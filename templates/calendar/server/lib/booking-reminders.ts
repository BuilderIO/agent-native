import {
  getAppProductionUrl,
  isEmailConfigured,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";
import type { SQL } from "drizzle-orm";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  min,
  or,
  sql,
} from "drizzle-orm";

import { BOOKING_REMINDER_MINUTES_OPTIONS } from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";
import { sendBookingReminderEmails } from "./booking-emails.js";
import { getOwnerBookingTimeZone } from "./booking-timezone.js";

const MINUTE_MS = 60_000;
const DUE_BATCH_LIMIT = 200;
const RETRY_DELAY_MS = 15 * MINUTE_MS;

export interface BookingReminderTiming {
  start: string;
  createdAt: string;
  reminderMinutes: number;
}

export type BookingReminderDecision = "wait" | "send" | "skip";

export function bookingReminderDueAt(
  timing: Pick<BookingReminderTiming, "start" | "reminderMinutes">,
): number | null {
  const startMs = Date.parse(timing.start);
  if (!Number.isFinite(startMs) || timing.reminderMinutes <= 0) return null;
  return startMs - timing.reminderMinutes * MINUTE_MS;
}

export function bookingReminderDecision(
  timing: BookingReminderTiming,
  nowMs: number,
): BookingReminderDecision {
  const dueAt = bookingReminderDueAt(timing);
  if (dueAt === null || Date.parse(timing.start) <= nowMs) return "skip";
  if (nowMs < dueAt) return "wait";
  const createdMs = Date.parse(timing.createdAt);
  return Number.isFinite(createdMs) && createdMs >= dueAt ? "skip" : "send";
}

const REMINDER_OFFSETS_MINUTES = BOOKING_REMINDER_MINUTES_OPTIONS.filter(
  (minutes) => minutes > 0,
);

const reminderLinkSlug = sql`coalesce(${schema.bookingSlugRedirects.newSlug}, ${schema.bookings.slug})`;

function pendingReminderFilter(nowMs: number): SQL | undefined {
  return and(
    eq(schema.bookings.status, "confirmed"),
    isNull(schema.bookings.reminderHandledAt),
    inArray(schema.bookingLinks.reminderMinutes, REMINDER_OFFSETS_MINUTES),
    gt(schema.bookings.start, new Date(nowMs).toISOString()),
  );
}

function reminderDueFilter(nowMs: number): SQL | undefined {
  return or(
    ...REMINDER_OFFSETS_MINUTES.map((minutes) =>
      and(
        eq(schema.bookingLinks.reminderMinutes, minutes),
        lte(
          schema.bookings.start,
          new Date(nowMs + minutes * MINUTE_MS).toISOString(),
        ),
      ),
    ),
  );
}

function reminderReadyFilter(nowMs: number): SQL | undefined {
  return or(
    isNull(schema.bookings.reminderNextAttemptAt),
    lte(schema.bookings.reminderNextAttemptAt, new Date(nowMs).toISOString()),
  );
}

async function listDueReminders(nowMs: number) {
  return getDb()
    .select({
      booking: schema.bookings,
      reminderMinutes: schema.bookingLinks.reminderMinutes,
      hostEmail: schema.bookingLinks.ownerEmail,
    })
    .from(schema.bookings)
    .leftJoin(
      schema.bookingSlugRedirects,
      eq(schema.bookingSlugRedirects.oldSlug, schema.bookings.slug),
    )
    .innerJoin(
      schema.bookingLinks,
      eq(schema.bookingLinks.slug, reminderLinkSlug),
    )
    .where(
      and(
        pendingReminderFilter(nowMs),
        reminderDueFilter(nowMs),
        reminderReadyFilter(nowMs),
      ),
    )
    .orderBy(asc(schema.bookings.start))
    .limit(DUE_BATCH_LIMIT);
}

async function claimBookingReminder(
  bookingId: string,
  nowMs: number,
  claim: { reminderHandledAt: string } | { reminderNextAttemptAt: string },
): Promise<boolean> {
  const claimed = await getDb()
    .update(schema.bookings)
    .set(claim)
    .where(
      and(
        eq(schema.bookings.id, bookingId),
        eq(schema.bookings.status, "confirmed"),
        isNull(schema.bookings.reminderHandledAt),
        reminderReadyFilter(nowMs),
      ),
    )
    .returning({ id: schema.bookings.id });
  return claimed.length > 0;
}

async function markBookingReminderHandled(
  bookingId: string,
  handledAt: string,
): Promise<void> {
  await getDb()
    .update(schema.bookings)
    .set({ reminderHandledAt: handledAt })
    .where(eq(schema.bookings.id, bookingId));
}

function parseGuestEmails(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((email): email is string => typeof email === "string")
      : undefined;
  } catch (error) {
    console.warn(
      "[calendar booking reminders] unreadable additional guest emails; reminding the booker only:",
      error,
    );
    return undefined;
  }
}

function manageUrlFor(cancelToken: string | null): string | null {
  if (!cancelToken) return null;
  return `${withConfiguredAppBasePath(getAppProductionUrl())}/booking/manage/${encodeURIComponent(cancelToken)}`;
}

export async function runBookingRemindersOnce(
  signal?: AbortSignal,
  nowMs: number = Date.now(),
): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!(await isEmailConfigured())) return result;

  const nowIso = new Date(nowMs).toISOString();
  for (const { booking, reminderMinutes, hostEmail } of await listDueReminders(
    nowMs,
  )) {
    signal?.throwIfAborted();
    const decision = bookingReminderDecision(
      { start: booking.start, createdAt: booking.createdAt, reminderMinutes },
      nowMs,
    );
    if (decision === "wait") continue;
    if (decision === "skip") {
      if (
        await claimBookingReminder(booking.id, nowMs, {
          reminderHandledAt: nowIso,
        })
      )
        result.skipped += 1;
      continue;
    }
    const timeZone = await getOwnerBookingTimeZone(hostEmail);
    const claimed = await claimBookingReminder(booking.id, nowMs, {
      reminderNextAttemptAt: new Date(nowMs + RETRY_DELAY_MS).toISOString(),
    });
    if (!claimed) continue;
    const guestEmails = parseGuestEmails(booking.additionalGuestEmails);
    const delivery = await sendBookingReminderEmails({
      booking: {
        email: booking.email,
        eventTitle: booking.eventTitle ?? "",
        start: booking.start,
        end: booking.end,
        meetingLinkPending: booking.meetingLinkPending,
        ...(guestEmails ? { additionalGuestEmails: guestEmails } : {}),
        ...(booking.meetingLink ? { meetingLink: booking.meetingLink } : {}),
      },
      hostEmail,
      manageUrl: manageUrlFor(booking.cancelToken),
      timeZone,
    });
    if (delivery.delivered === 0 && delivery.failed > 0) {
      result.failed += 1;
      continue;
    }
    await markBookingReminderHandled(booking.id, nowIso);
    if (delivery.delivered > 0) result.sent += 1;
    else result.skipped += 1;
  }
  return result;
}

export async function nextBookingReminderDueAt(
  nowMs: number = Date.now(),
): Promise<number | null> {
  if (!(await isEmailConfigured())) return null;
  const earliestByOffset = await getDb()
    .select({
      reminderMinutes: schema.bookingLinks.reminderMinutes,
      firstStart: sql<
        string | null
      >`min(${schema.bookings.start}) filter (where ${schema.bookings.reminderNextAttemptAt} is null)`,
      retryAt: min(schema.bookings.reminderNextAttemptAt),
    })
    .from(schema.bookings)
    .leftJoin(
      schema.bookingSlugRedirects,
      eq(schema.bookingSlugRedirects.oldSlug, schema.bookings.slug),
    )
    .innerJoin(
      schema.bookingLinks,
      eq(schema.bookingLinks.slug, reminderLinkSlug),
    )
    .where(pendingReminderFilter(nowMs))
    .groupBy(schema.bookingLinks.reminderMinutes);
  let earliest: number | null = null;
  for (const { reminderMinutes, firstStart, retryAt } of earliestByOffset) {
    const dueTimes = [
      firstStart === null
        ? null
        : bookingReminderDueAt({ start: firstStart, reminderMinutes }),
      retryAt === null ? null : Date.parse(retryAt),
    ];
    for (const dueAt of dueTimes) {
      if (dueAt === null || !Number.isFinite(dueAt)) continue;
      earliest = earliest === null ? dueAt : Math.min(earliest, dueAt);
    }
  }
  return earliest === null ? null : Math.max(earliest, nowMs);
}
