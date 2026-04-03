import {
  defineEventHandler,
  getQuery,
  getRequestURL,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";
import { eq, and, gte, lte, ne } from "drizzle-orm";
import { verifyCaptcha } from "@agent-native/core/server";
import type {
  Booking,
  CalendarEvent,
  AvailabilityConfig,
  ConferencingConfig,
  CustomField,
  TimeSlot,
} from "../../shared/api.js";
import { getSetting } from "@agent-native/core/settings";
import { getDb, schema } from "../db/index.js";
import * as googleCalendar from "../lib/google-calendar.js";

export const listBookings = defineEventHandler(async (_event: H3Event) => {
  try {
    const rows = await getDb()
      .select()
      .from(schema.bookings)
      .orderBy(schema.bookings.start);
    return rows.map(rowToBooking);
  } catch (error: any) {
    setResponseStatus(_event, 500);
    return { error: error.message };
  }
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
    const insertResult = await db.transaction(async (tx) => {
      const conflicting = await tx
        .select()
        .from(schema.bookings)
        .where(
          and(
            ne(schema.bookings.status, "cancelled"),
            lte(schema.bookings.start, body.end),
            gte(schema.bookings.end, body.start),
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

    // For zoom/custom, use the static URL — only allow http(s) schemes
    if (
      conferencing &&
      (conferencing.type === "zoom" || conferencing.type === "custom") &&
      conferencing.url
    ) {
      try {
        const parsed = new URL(conferencing.url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          meetingLink = conferencing.url;
        }
      } catch {
        // Invalid URL — skip
      }
    }

    // Build the manage-booking URL for the event description
    const reqUrl = getRequestURL(event);
    const origin = reqUrl.origin;
    const manageUrl = `${origin}/booking/manage/${cancelToken}`;

    // Create a corresponding Google Calendar event if connected
    if (await googleCalendar.isConnected()) {
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
          createdAt: now,
          updatedAt: now,
        };
        const result = await googleCalendar.createEvent(calEvent, {
          addGoogleMeet: conferencing?.type === "google_meet",
        });
        // Google Meet link is returned by the API when created
        if (result.meetLink) {
          meetingLink = result.meetLink;
        }
      } catch {
        // Continue even if Google Calendar creation fails
      }
    }

    // Persist the meeting link to the booking row
    if (meetingLink) {
      await getDb()
        .update(schema.bookings)
        .set({ meetingLink })
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
      cancelToken,
      status: "confirmed",
      createdAt: now,
    };

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
    const date = query.date as string;
    const duration = parseInt((query.duration as string) || "30", 10);

    if (!date) {
      setResponseStatus(event, 400);
      return { error: "date query parameter is required" };
    }

    const config = (await getSetting(
      "calendar-availability",
    )) as unknown as AvailabilityConfig | null;
    if (!config) {
      return { slots: [] };
    }

    // Determine the day of the week
    const targetDate = new Date(date + "T00:00:00");
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

    if (
      !daySchedule ||
      !daySchedule.enabled ||
      daySchedule.slots.length === 0
    ) {
      return { slots: [] };
    }

    // Get all events for this date to check for conflicts
    const dayStart = new Date(date + "T00:00:00").toISOString();
    const dayEnd = new Date(date + "T23:59:59").toISOString();

    // Fetch Google Calendar events for the day if connected
    let dayEvents: Array<{ start: string; end: string }> = [];
    if (await googleCalendar.isConnected()) {
      try {
        const { events: googleEvents } = await googleCalendar.listEvents(
          dayStart,
          dayEnd,
        );
        dayEvents = googleEvents.map((e) => ({ start: e.start, end: e.end }));
      } catch {
        // Continue without Google events if API fails
      }
    }

    // Get bookings for this date from DB
    const dayBookings = await getDb()
      .select()
      .from(schema.bookings)
      .where(
        and(
          ne(schema.bookings.status, "cancelled"),
          lte(schema.bookings.start, dayEnd),
          gte(schema.bookings.end, dayStart),
        ),
      );

    // Generate available slots
    const availableSlots: TimeSlot[] = [];
    const slotDuration = duration || config.slotDurationMinutes;
    const bufferMs = config.bufferMinutes * 60 * 1000;

    for (const scheduleSlot of daySchedule.slots) {
      const [startHour, startMin] = scheduleSlot.start.split(":").map(Number);
      const [endHour, endMin] = scheduleSlot.end.split(":").map(Number);

      const slotStart = new Date(date + "T00:00:00");
      slotStart.setHours(startHour, startMin, 0, 0);

      const slotEnd = new Date(date + "T00:00:00");
      slotEnd.setHours(endHour, endMin, 0, 0);

      let current = new Date(slotStart);

      while (
        current.getTime() + slotDuration * 60 * 1000 <=
        slotEnd.getTime()
      ) {
        const candidateStart = new Date(current);
        const candidateEnd = new Date(
          current.getTime() + slotDuration * 60 * 1000,
        );

        // Check for conflicts with events and DB bookings (including buffer)
        const allConflictItems = [
          ...dayEvents.map((e) => ({ start: e.start, end: e.end })),
          ...dayBookings.map((b) => ({ start: b.start, end: b.end })),
        ];
        const hasConflict = allConflictItems.some((item) => {
          const itemStart = new Date(item.start).getTime() - bufferMs;
          const itemEnd = new Date(item.end).getTime() + bufferMs;
          return (
            candidateStart.getTime() < itemEnd &&
            candidateEnd.getTime() > itemStart
          );
        });

        if (!hasConflict) {
          availableSlots.push({
            start: candidateStart.toISOString(),
            end: candidateEnd.toISOString(),
          });
        }

        current = new Date(current.getTime() + slotDuration * 60 * 1000);
      }
    }

    return { slots: availableSlots };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const deleteBooking = defineEventHandler(async (event: H3Event) => {
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

    await db.delete(schema.bookings).where(eq(schema.bookings.id, id));
    return { success: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
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
    status: row.status,
    createdAt: row.createdAt,
  };
}
