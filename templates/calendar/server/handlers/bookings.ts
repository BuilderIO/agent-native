import {
  defineEventHandler,
  getQuery,
  readBody,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import path from "path";
import { nanoid } from "nanoid";
import { eq, and, gte, lte, ne } from "drizzle-orm";
import { verifyCaptcha } from "@agent-native/core/server";
import type {
  Booking,
  CalendarEvent,
  AvailabilityConfig,
  TimeSlot,
} from "../../shared/api.js";
import { readJsonFile, writeJsonFile, listJsonFiles } from "../lib/data-helpers.js";
import { db, schema } from "../db/index.js";

const EVENTS_DIR = path.join(process.cwd(), "data", "events");
const AVAILABILITY_PATH = path.join(process.cwd(), "data", "availability.json");

export const listBookings = defineEventHandler((_event: H3Event) => {
  try {
    const rows = db
      .select()
      .from(schema.bookings)
      .orderBy(schema.bookings.start)
      .all();
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

    // Validate required fields
    if (!body.name || !body.email || !body.start || !body.end) {
      setResponseStatus(event, 400);
      return { error: "name, email, start, and end are required" };
    }

    // Insert booking into DB
    db.insert(schema.bookings)
      .values({
        id,
        name: body.name,
        email: body.email,
        start: body.start,
        end: body.end,
        slug: body.slug || "",
        eventTitle: body.eventTitle || null,
        notes: body.notes || null,
        status: "confirmed",
        createdAt: now,
      })
      .run();

    // Create a corresponding calendar event (file-based for Google Calendar sync)
    const eventId = nanoid();
    const calEvent: CalendarEvent = {
      id: eventId,
      title: body.eventTitle || `Booking with ${body.name}`,
      description: `Booking by ${body.name} (${body.email})${body.notes ? `\n\nNotes: ${body.notes}` : ""}`,
      start: body.start,
      end: body.end,
      location: "",
      allDay: false,
      source: "local",
      color: "#4f46e5",
      createdAt: now,
      updatedAt: now,
    };
    writeJsonFile(path.join(EVENTS_DIR, `${eventId}.json`), calEvent);

    const booking: Booking = {
      id,
      name: body.name,
      email: body.email,
      start: body.start,
      end: body.end,
      slug: body.slug || "",
      eventTitle: body.eventTitle,
      notes: body.notes,
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

export const getAvailableSlots = defineEventHandler((event: H3Event) => {
  try {
    const query = getQuery(event);
    const date = query.date as string;
    const duration = parseInt((query.duration as string) || "30", 10);

    if (!date) {
      setResponseStatus(event, 400);
      return { error: "date query parameter is required" };
    }

    const config = readJsonFile<AvailabilityConfig>(AVAILABILITY_PATH);
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
    const allEvents = listJsonFiles<CalendarEvent>(EVENTS_DIR);
    const dayEvents = allEvents.filter((e) => {
      const eventStart = new Date(e.start);
      const eventEnd = new Date(e.end);
      return eventStart < new Date(dayEnd) && eventEnd > new Date(dayStart);
    });

    // Get bookings for this date from DB
    const dayBookings = db
      .select()
      .from(schema.bookings)
      .where(
        and(
          ne(schema.bookings.status, "cancelled"),
          lte(schema.bookings.start, dayEnd),
          gte(schema.bookings.end, dayStart),
        ),
      )
      .all();

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

export const deleteBooking = defineEventHandler((event: H3Event) => {
  try {
    const id = getRouterParam(event, "id") as string;

    const existing = db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .get();

    if (!existing) {
      setResponseStatus(event, 404);
      return { error: "Booking not found" };
    }

    db.delete(schema.bookings).where(eq(schema.bookings.id, id)).run();
    return { success: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

// Helper to convert DB row to Booking type
function rowToBooking(row: typeof schema.bookings.$inferSelect): Booking {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    start: row.start,
    end: row.end,
    slug: row.slug,
    eventTitle: row.eventTitle ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
  };
}
