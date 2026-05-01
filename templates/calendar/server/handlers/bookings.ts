import {
  createError,
  defineEventHandler,
  getQuery,
  getRequestURL,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";
import { eq, and, gte, lte, ne, inArray } from "drizzle-orm";
import {
  getSession,
  readBody,
  runWithRequestContext,
  verifyCaptcha,
} from "@agent-native/core/server";
import { emit } from "@agent-native/core/event-bus";
import { accessFilter } from "@agent-native/core/sharing";
import type {
  Booking,
  CalendarEvent,
  AvailabilityConfig,
  ConferencingConfig,
  CustomField,
  TimeSlot,
} from "../../shared/api.js";
import { getSetting, getUserSetting } from "@agent-native/core/settings";
import { getDb, schema } from "../db/index.js";
import * as googleCalendar from "../lib/google-calendar.js";
import { createZoomMeeting } from "../lib/zoom.js";
import {
  sendBookingCancellationEmails,
  sendBookingConfirmationEmails,
} from "../lib/booking-emails.js";

async function requireRequestContext<T>(
  event: H3Event,
  fn: () => Promise<T>,
): Promise<T> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    fn,
  );
}

async function getBookingLinkSlugsForOwner(
  ownerEmail: string,
): Promise<string[]> {
  const rows = await getDb()
    .select({ slug: schema.bookingLinks.slug })
    .from(schema.bookingLinks)
    .where(eq(schema.bookingLinks.ownerEmail, ownerEmail));
  return rows.map((row) => row.slug);
}

async function getBookingLinkOwnerEmail(
  slug: string,
): Promise<string | undefined> {
  if (!slug) return undefined;
  const row = await getDb()
    .select({ ownerEmail: schema.bookingLinks.ownerEmail })
    .from(schema.bookingLinks)
    .where(eq(schema.bookingLinks.slug, slug))
    .then((rows) => rows[0]);
  return row?.ownerEmail;
}

async function deleteGoogleEventForBooking({
  booking,
  hostEmail,
}: {
  booking: Pick<
    typeof schema.bookings.$inferSelect,
    "id" | "slug" | "googleEventId"
  >;
  hostEmail?: string;
}) {
  if (!booking.googleEventId) return;
  const ownerEmail =
    hostEmail ?? (await getBookingLinkOwnerEmail(booking.slug));
  if (!ownerEmail) return;

  try {
    await googleCalendar.deleteEvent(booking.googleEventId, ownerEmail, {
      sendUpdates: "none",
    });
  } catch (error) {
    console.warn(
      `[bookings] Failed to delete Google Calendar event for booking ${booking.id}:`,
      error,
    );
  }
}

type AvailabilityContext = {
  effectiveConfig: AvailabilityConfig | null;
  ownerEmail?: string;
  slug: string;
  conflictSlugs: string[];
};

type ConflictItem = { start: string; end: string };

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AVAILABILITY_RANGE_DAYS = 93;

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !DATE_ONLY_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateOnly(date) === value ? date : null;
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function countDaysInclusive(start: Date, end: Date): number {
  let count = 0;
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = addLocalDays(cursor, 1)
  ) {
    count += 1;
    if (count > MAX_AVAILABILITY_RANGE_DAYS) return count;
  }
  return count;
}

function dateStartIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

function dateEndIso(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

async function resolveAvailabilityContext(
  slug: string,
): Promise<AvailabilityContext> {
  const config = (await getSetting(
    "calendar-availability",
  )) as unknown as AvailabilityConfig | null;
  const bookingLink = slug
    ? await getDb()
        .select()
        .from(schema.bookingLinks)
        .where(eq(schema.bookingLinks.slug, slug))
        .then((rows) => rows[0])
    : undefined;
  const ownerEmail = bookingLink?.ownerEmail;
  const ownerConfig = ownerEmail
    ? ((await getUserSetting(
        ownerEmail,
        "calendar-availability",
      )) as unknown as AvailabilityConfig | null)
    : null;
  const conflictSlugs = ownerEmail
    ? await getBookingLinkSlugsForOwner(ownerEmail)
    : slug
      ? [slug]
      : [];

  return {
    effectiveConfig: ownerConfig || config,
    ownerEmail,
    slug,
    conflictSlugs,
  };
}

async function getConflictItems({
  ownerEmail,
  conflictSlugs,
  rangeStartIso,
  rangeEndIso,
}: {
  ownerEmail?: string;
  conflictSlugs: string[];
  rangeStartIso: string;
  rangeEndIso: string;
}): Promise<ConflictItem[]> {
  const conflictItems: ConflictItem[] = [];

  if (await googleCalendar.isConnected(ownerEmail)) {
    try {
      const { events: googleEvents } = await googleCalendar.listEvents(
        rangeStartIso,
        rangeEndIso,
        ownerEmail,
      );
      conflictItems.push(
        ...googleEvents.map((event) => ({
          start: event.start,
          end: event.end,
        })),
      );
    } catch {
      // Continue without Google events if API fails
    }
  }

  const bookings = await getDb()
    .select()
    .from(schema.bookings)
    .where(
      and(
        ne(schema.bookings.status, "cancelled"),
        lte(schema.bookings.start, rangeEndIso),
        gte(schema.bookings.end, rangeStartIso),
        conflictSlugs.length > 0
          ? inArray(schema.bookings.slug, conflictSlugs)
          : undefined,
      ),
    );

  conflictItems.push(
    ...bookings.map((booking) => ({
      start: booking.start,
      end: booking.end,
    })),
  );

  return conflictItems;
}

function generateAvailableSlotsForDate({
  date,
  duration,
  config,
  conflictItems,
}: {
  date: string;
  duration: number;
  config: AvailabilityConfig;
  conflictItems: ConflictItem[];
}): TimeSlot[] {
  const targetDate = new Date(`${date}T00:00:00`);
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const;
  const dayName = dayNames[targetDate.getDay()];
  const daySchedule =
    config.weeklySchedule[dayName as keyof typeof config.weeklySchedule];

  if (!daySchedule || !daySchedule.enabled || daySchedule.slots.length === 0) {
    return [];
  }

  const availableSlots: TimeSlot[] = [];
  const slotDuration = duration || config.slotDurationMinutes;
  const bufferMinutes = Number.isFinite(config.bufferMinutes)
    ? config.bufferMinutes
    : 0;
  const minNoticeHours = Number.isFinite(config.minNoticeHours)
    ? config.minNoticeHours
    : 0;
  const maxAdvanceDays = Number.isFinite(config.maxAdvanceDays)
    ? config.maxAdvanceDays
    : 60;
  const bufferMs = Math.max(0, bufferMinutes) * 60 * 1000;
  const earliestStart =
    Date.now() + Math.max(0, minNoticeHours) * 60 * 60 * 1000;
  const latestDate = new Date();
  latestDate.setHours(23, 59, 59, 999);
  latestDate.setDate(latestDate.getDate() + Math.max(0, maxAdvanceDays));

  for (const scheduleSlot of daySchedule.slots) {
    const [startHour, startMin] = scheduleSlot.start.split(":").map(Number);
    const [endHour, endMin] = scheduleSlot.end.split(":").map(Number);
    if (
      !Number.isFinite(startHour) ||
      !Number.isFinite(startMin) ||
      !Number.isFinite(endHour) ||
      !Number.isFinite(endMin)
    ) {
      continue;
    }

    const slotStart = new Date(`${date}T00:00:00`);
    slotStart.setHours(startHour, startMin, 0, 0);

    const slotEnd = new Date(`${date}T00:00:00`);
    slotEnd.setHours(endHour, endMin, 0, 0);

    let current = new Date(slotStart);

    while (current.getTime() + slotDuration * 60 * 1000 <= slotEnd.getTime()) {
      const candidateStart = new Date(current);
      const candidateEnd = new Date(
        current.getTime() + slotDuration * 60 * 1000,
      );

      const outsideBookingWindow =
        candidateStart.getTime() < earliestStart ||
        candidateStart.getTime() > latestDate.getTime();
      const hasConflict = conflictItems.some((item) => {
        const itemStart = new Date(item.start).getTime() - bufferMs;
        const itemEnd = new Date(item.end).getTime() + bufferMs;
        return (
          candidateStart.getTime() < itemEnd &&
          candidateEnd.getTime() > itemStart
        );
      });

      if (!outsideBookingWindow && !hasConflict) {
        availableSlots.push({
          start: candidateStart.toISOString(),
          end: candidateEnd.toISOString(),
        });
      }

      current = new Date(current.getTime() + slotDuration * 60 * 1000);
    }
  }

  return availableSlots;
}

export const listBookings = defineEventHandler(async (_event: H3Event) => {
  return requireRequestContext(_event, async () => {
    try {
      const accessibleLinks = await getDb()
        .select({ slug: schema.bookingLinks.slug })
        .from(schema.bookingLinks)
        .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares));
      const slugs = accessibleLinks.map((link) => link.slug);
      if (slugs.length === 0) return [];

      const rows = await getDb()
        .select()
        .from(schema.bookings)
        .where(inArray(schema.bookings.slug, slugs))
        .orderBy(schema.bookings.start);
      return rows.map(rowToBooking);
    } catch (error: any) {
      setResponseStatus(_event, error?.statusCode ?? 500);
      return { error: error.message };
    }
  });
});

export const createBooking = defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event);

    // Verify captcha token
    const captchaResult = await verifyCaptcha(body.captchaToken ?? "");
    if (!captchaResult.success) {
      setResponseStatus(event, 403);
      return { error: "Captcha verification failed" };
    }

    const now = new Date().toISOString();
    const id = nanoid();
    const cancelToken = nanoid();

    // Validate required fields
    if (!body.name || !body.email || !body.start || !body.end) {
      setResponseStatus(event, 400);
      return { error: "name, email, start, and end are required" };
    }

    const bookingLink =
      body.slug &&
      (
        await getDb()
          .select()
          .from(schema.bookingLinks)
          .where(eq(schema.bookingLinks.slug, body.slug))
      )[0];

    if (body.slug && (!bookingLink || !bookingLink.isActive)) {
      setResponseStatus(event, 404);
      return { error: "Booking link not found" };
    }

    // Validate custom field responses
    let customFields: CustomField[] = [];
    if (bookingLink?.customFields) {
      try {
        customFields = JSON.parse(bookingLink.customFields);
      } catch {}
    }
    const rawFieldResponses: Record<string, string | boolean> =
      body.fieldResponses || {};
    // Filter to only declared field IDs — don't persist arbitrary caller keys
    const fieldResponses: Record<string, string | boolean> = Object.fromEntries(
      customFields
        .map((f) => [f.id, rawFieldResponses[f.id]] as const)
        .filter(([, v]) => v !== undefined),
    );
    for (const field of customFields) {
      const value = fieldResponses[field.id];
      if (field.required) {
        if (
          value === undefined ||
          value === null ||
          value === "" ||
          value === false
        ) {
          setResponseStatus(event, 400);
          return { error: `${field.label} is required` };
        }
      }
      if (
        field.type === "select" &&
        typeof value === "string" &&
        field.options &&
        field.options.length > 0 &&
        !field.options.includes(value)
      ) {
        setResponseStatus(event, 400);
        return { error: `Invalid value for ${field.label}` };
      }
      if (
        field.type === "checkbox" &&
        value !== undefined &&
        typeof value !== "boolean"
      ) {
        setResponseStatus(event, 400);
        return { error: `${field.label} must be true or false` };
      }
      if (field.pattern && typeof value === "string" && value) {
        // Cap input length to mitigate ReDoS on user-defined patterns
        const safeValue = value.slice(0, 1000);
        let re: RegExp;
        // Limit pattern length and reject obviously dangerous constructs
        if (field.pattern.length > 200) {
          setResponseStatus(event, 400);
          return { error: `Validation pattern too long for ${field.label}` };
        }
        try {
          re = new RegExp(field.pattern);
        } catch {
          setResponseStatus(event, 400);
          return { error: `Invalid validation pattern for ${field.label}` };
        }
        if (!re.test(safeValue)) {
          setResponseStatus(event, 400);
          return {
            error:
              field.patternError ||
              `${field.label} does not match the expected format`,
          };
        }
      }
    }

    // Check for conflicts + insert atomically in a transaction
    const db = getDb();
    const conflictSlugs = bookingLink?.ownerEmail
      ? await getBookingLinkSlugsForOwner(bookingLink.ownerEmail)
      : body.slug
        ? [String(body.slug)]
        : [];
    const insertResult = await db.transaction(async (tx) => {
      const conflicting = await tx
        .select()
        .from(schema.bookings)
        .where(
          and(
            ne(schema.bookings.status, "cancelled"),
            lte(schema.bookings.start, body.end),
            gte(schema.bookings.end, body.start),
            conflictSlugs.length > 0
              ? inArray(schema.bookings.slug, conflictSlugs)
              : undefined,
          ),
        );

      if (conflicting.length > 0) {
        return { conflict: true } as const;
      }

      await tx.insert(schema.bookings).values({
        id,
        name: body.name,
        email: body.email,
        start: body.start,
        end: body.end,
        slug: body.slug || "",
        eventTitle: body.eventTitle || bookingLink?.title || null,
        notes: body.notes || null,
        fieldResponses:
          Object.keys(fieldResponses).length > 0
            ? JSON.stringify(fieldResponses)
            : null,
        cancelToken,
        status: "confirmed",
        createdAt: now,
      });

      return { conflict: false } as const;
    });

    if (insertResult.conflict) {
      setResponseStatus(event, 409);
      return { error: "This time slot is no longer available" };
    }

    // Resolve conferencing config
    let conferencing: ConferencingConfig | undefined;
    if (bookingLink?.conferencing) {
      try {
        conferencing = JSON.parse(bookingLink.conferencing);
      } catch {}
    }
    let meetingLink: string | undefined;
    let googleEventId: string | undefined;

    // For custom-URL conferencing, use the static URL — only http(s).
    if (conferencing?.type === "custom" && conferencing.url) {
      try {
        const parsed = new URL(conferencing.url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          meetingLink = conferencing.url;
        }
      } catch {
        // Invalid URL — skip
      }
    }

    const hostEmail =
      (bookingLink as any)?.ownerEmail || (bookingLink as any)?.owner_email;
    if (!hostEmail) {
      setResponseStatus(event, 500);
      return { error: "Booking link has no host email" };
    }

    // For Zoom, create a real meeting via the host's connected OAuth
    // account. The booking link's owner_email is the host.
    if (conferencing?.type === "zoom") {
      try {
        const zoomResult = await createZoomMeeting({
          hostEmail,
          title:
            body.eventTitle ||
            bookingLink?.title ||
            `Booking with ${body.name}`,
          startTime: body.start,
          endTime: body.end,
          timezone:
            (body.timezone as string | undefined) ??
            Intl.DateTimeFormat().resolvedOptions().timeZone ??
            "UTC",
        });
        if (zoomResult?.meetingUrl) {
          meetingLink = zoomResult.meetingUrl;
        }
      } catch {
        // Fall through — booking still succeeds without a Zoom link.
      }
    }

    // Build the manage-booking URL for the event description
    const reqUrl = getRequestURL(event);
    const origin = reqUrl.origin;
    const manageUrl = `${origin}/booking/manage/${cancelToken}`;

    // Create a corresponding Google Calendar event on the booking link owner's
    // connected Google account. Public booking requests do not have an
    // authenticated request context, so this must be explicitly scoped to the
    // host rather than relying on ambient user state.
    if (await googleCalendar.isConnected(hostEmail)) {
      try {
        const descParts: string[] = [`Booking by ${body.name} (${body.email})`];
        if (body.notes) descParts.push(`Notes: ${body.notes}`);
        if (customFields.length > 0 && Object.keys(fieldResponses).length > 0) {
          const fieldLines = customFields
            .filter(
              (f) =>
                fieldResponses[f.id] !== undefined &&
                fieldResponses[f.id] !== "",
            )
            .map((f) => `${f.label}: ${fieldResponses[f.id]}`);
          if (fieldLines.length > 0) descParts.push(fieldLines.join("\n"));
        }
        if (meetingLink) descParts.push(`Meeting link: ${meetingLink}`);
        descParts.push(
          `──────────\nNeed to make changes?\nCancel or reschedule: ${manageUrl}`,
        );

        const calEvent: CalendarEvent = {
          id: nanoid(),
          title:
            body.eventTitle ||
            bookingLink?.title ||
            `Booking with ${body.name}`,
          description: descParts.join("\n\n"),
          start: body.start,
          end: body.end,
          location: meetingLink || "",
          allDay: false,
          source: "google",
          accountEmail: hostEmail,
          createdAt: now,
          updatedAt: now,
        };
        const result = await googleCalendar.createEvent(calEvent, {
          addGoogleMeet: conferencing?.type === "google_meet",
        });
        // Google Meet link is returned by the API when created
        googleEventId = result.id;
        if (result.meetLink) {
          meetingLink = result.meetLink;
        }
      } catch (error) {
        console.warn(
          `[bookings] Failed to create Google Calendar event for ${hostEmail}:`,
          error,
        );
        // Continue even if Google Calendar creation fails
      }
    }

    // Persist provider details created after the initial booking insert.
    if (meetingLink || googleEventId) {
      const providerUpdates: {
        meetingLink?: string;
        googleEventId?: string;
      } = {};
      if (meetingLink) providerUpdates.meetingLink = meetingLink;
      if (googleEventId) providerUpdates.googleEventId = googleEventId;
      await getDb()
        .update(schema.bookings)
        .set(providerUpdates)
        .where(eq(schema.bookings.id, id));
    }

    const booking: Booking = {
      id,
      name: body.name,
      email: body.email,
      start: body.start,
      end: body.end,
      slug: body.slug || "",
      eventTitle: body.eventTitle || bookingLink?.title,
      notes: body.notes,
      fieldResponses:
        Object.keys(fieldResponses).length > 0 ? fieldResponses : undefined,
      meetingLink,
      googleEventId,
      cancelToken,
      status: "confirmed",
      createdAt: now,
    };

    await sendBookingConfirmationEmails({
      booking,
      hostEmail,
      manageUrl,
      timeZone:
        (body.timezone as string | undefined) ??
        Intl.DateTimeFormat().resolvedOptions().timeZone ??
        "UTC",
    });

    try {
      emit(
        "calendar.booking.created",
        {
          bookingId: id,
          schedulingLinkSlug: body.slug || "",
          attendeeName: body.name,
          attendeeEmail: body.email,
          startTime: body.start,
          endTime: body.end,
          eventTitle: booking.eventTitle || "",
        },
        { owner: hostEmail },
      );
    } catch {
      // best-effort
    }

    setResponseStatus(event, 201);
    return booking;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const getAvailableSlots = defineEventHandler(async (event: H3Event) => {
  try {
    const query = getQuery(event);
    const date = typeof query.date === "string" ? query.date : "";
    const from = parseDateOnly(query.from);
    const to = parseDateOnly(query.to);
    const hasRangeQuery = query.from !== undefined || query.to !== undefined;
    const duration = parseInt(
      typeof query.duration === "string" ? query.duration : "30",
      10,
    );
    const slug = typeof query.slug === "string" ? query.slug : "";

    if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60) {
      setResponseStatus(event, 400);
      return { error: "duration must be between 1 and 1440 minutes" };
    }

    if (hasRangeQuery) {
      if (!from || !to) {
        setResponseStatus(event, 400);
        return {
          error:
            "from and to query parameters are required together in YYYY-MM-DD format",
        };
      }
      if (from > to) {
        setResponseStatus(event, 400);
        return { error: "from must be before to" };
      }
      if (countDaysInclusive(from, to) > MAX_AVAILABILITY_RANGE_DAYS) {
        setResponseStatus(event, 400);
        return {
          error: `date range cannot exceed ${MAX_AVAILABILITY_RANGE_DAYS} days`,
        };
      }
    } else if (!parseDateOnly(date)) {
      setResponseStatus(event, 400);
      return { error: "date query parameter is required" };
    }

    const context = await resolveAvailabilityContext(slug);
    if (!context.effectiveConfig) {
      return hasRangeQuery ? { dates: [] } : { slots: [] };
    }

    if (hasRangeQuery) {
      const rangeStart = formatDateOnly(from!);
      const rangeEnd = formatDateOnly(to!);
      const conflictItems = await getConflictItems({
        ownerEmail: context.ownerEmail,
        conflictSlugs: context.conflictSlugs,
        rangeStartIso: dateStartIso(rangeStart),
        rangeEndIso: dateEndIso(rangeEnd),
      });
      const dates: string[] = [];
      for (
        let cursor = new Date(from!);
        cursor <= to!;
        cursor = addLocalDays(cursor, 1)
      ) {
        const day = formatDateOnly(cursor);
        const slots = generateAvailableSlotsForDate({
          date: day,
          duration,
          config: context.effectiveConfig,
          conflictItems,
        });
        if (slots.length > 0) {
          dates.push(day);
        }
      }
      return { dates };
    }

    const conflictItems = await getConflictItems({
      ownerEmail: context.ownerEmail,
      conflictSlugs: context.conflictSlugs,
      rangeStartIso: dateStartIso(date),
      rangeEndIso: dateEndIso(date),
    });
    const availableSlots = generateAvailableSlotsForDate({
      date,
      duration,
      config: context.effectiveConfig,
      conflictItems,
    });

    return { slots: availableSlots };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const deleteBooking = defineEventHandler(async (event: H3Event) => {
  return requireRequestContext(event, async () => {
    try {
      const id = getRouterParam(event, "id") as string;
      const db = getDb();

      const existing = await db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, id))
        .then((rows) => rows[0]);

      if (!existing) {
        setResponseStatus(event, 404);
        return { error: "Booking not found" };
      }

      // Verify the caller has access to the booking link that owns this booking.
      // Bookings have no ownerEmail of their own — scoping is via the slug →
      // bookingLink ownership/sharing chain.
      const accessibleLinks = await db
        .select({ slug: schema.bookingLinks.slug })
        .from(schema.bookingLinks)
        .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares));
      const accessibleSlugs = new Set(accessibleLinks.map((l) => l.slug));

      if (!accessibleSlugs.has(existing.slug)) {
        setResponseStatus(event, 403);
        return { error: "Access denied" };
      }

      const hostEmail = await getBookingLinkOwnerEmail(existing.slug);
      const reqUrl = getRequestURL(event);
      const bookAgainUrl = existing.slug
        ? `${reqUrl.origin}/book/${existing.slug}`
        : undefined;

      await sendBookingCancellationEmails({
        booking: rowToBooking(existing),
        hostEmail,
        bookAgainUrl,
      });
      await deleteGoogleEventForBooking({ booking: existing, hostEmail });

      await db.delete(schema.bookings).where(eq(schema.bookings.id, id));
      return { success: true };
    } catch (error: any) {
      setResponseStatus(event, error?.statusCode ?? 500);
      return { error: error.message };
    }
  });
});

/** Look up a booking by its cancel token (public, no auth) */
export const getBookingByToken = defineEventHandler(async (event: H3Event) => {
  try {
    const token = getRouterParam(event, "token") as string;
    if (!token) {
      setResponseStatus(event, 400);
      return { error: "Token is required" };
    }

    const row = await getDb()
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.cancelToken, token))
      .then((rows) => rows[0]);

    if (!row) {
      setResponseStatus(event, 404);
      return { error: "Booking not found" };
    }

    // Return limited info — don't expose internal IDs
    const booking = rowToBooking(row);
    return {
      eventTitle: booking.eventTitle,
      name: booking.name,
      start: booking.start,
      end: booking.end,
      slug: booking.slug,
      meetingLink: booking.meetingLink,
      status: booking.status,
    };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

/** Cancel a booking by its cancel token (public, no auth) */
export const cancelBookingByToken = defineEventHandler(
  async (event: H3Event) => {
    try {
      const token = getRouterParam(event, "token") as string;
      if (!token) {
        setResponseStatus(event, 400);
        return { error: "Token is required" };
      }

      const db = getDb();
      const row = await db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.cancelToken, token))
        .then((rows) => rows[0]);

      if (!row) {
        setResponseStatus(event, 404);
        return { error: "Booking not found" };
      }

      if (row.status === "cancelled") {
        return { success: true, alreadyCancelled: true };
      }

      await db
        .update(schema.bookings)
        .set({ status: "cancelled" })
        .where(eq(schema.bookings.id, row.id));

      const hostEmail = await getBookingLinkOwnerEmail(row.slug);
      const reqUrl = getRequestURL(event);
      const bookAgainUrl = row.slug
        ? `${reqUrl.origin}/book/${row.slug}`
        : undefined;
      await sendBookingCancellationEmails({
        booking: rowToBooking(row),
        hostEmail,
        bookAgainUrl,
      });
      await deleteGoogleEventForBooking({ booking: row, hostEmail });

      return { success: true, slug: row.slug };
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  },
);

// Helper to convert DB row to Booking type
function rowToBooking(row: typeof schema.bookings.$inferSelect): Booking {
  let fieldResponses: Record<string, string | boolean> | undefined;
  if (row.fieldResponses) {
    try {
      fieldResponses = JSON.parse(row.fieldResponses);
    } catch {}
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    start: row.start,
    end: row.end,
    slug: row.slug,
    eventTitle: row.eventTitle ?? undefined,
    notes: row.notes ?? undefined,
    fieldResponses,
    meetingLink: row.meetingLink ?? undefined,
    googleEventId: row.googleEventId ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
  };
}
