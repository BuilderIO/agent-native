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
import type {
  Booking,
  CalendarEvent,
  AvailabilityConfig,
  TimeSlot,
} from "../../shared/api.js";
import {
  readJsonFile,
  writeJsonFile,
  listJsonFiles,
  deleteJsonFile,
} from "../lib/data-helpers.js";

const BOOKINGS_DIR = path.join(process.cwd(), "data", "bookings");
const EVENTS_DIR = path.join(process.cwd(), "data", "events");
const AVAILABILITY_PATH = path.join(process.cwd(), "data", "availability.json");

function bookingPath(id: string): string {
  return path.join(BOOKINGS_DIR, `${id}.json`);
}

export const listBookings = defineEventHandler((_event: H3Event) => {
  try {
    const bookings = listJsonFiles<Booking>(BOOKINGS_DIR);
    bookings.sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
    return bookings;
  } catch (error: any) {
    setResponseStatus(_event, 500);
    return { error: error.message };
  }
});

export const createBooking = defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event);
    const now = new Date().toISOString();
    const id = nanoid();
    const booking: Booking = {
      ...body,
      id,
      status: "confirmed",
      createdAt: now,
    };

    // Validate required fields
    if (!booking.name || !booking.email || !booking.start || !booking.end) {
      setResponseStatus(event, 400);
      return { error: "name, email, start, and end are required" };
    }

    writeJsonFile(bookingPath(id), booking);

    // Create a corresponding calendar event
    const eventId = nanoid();
    const calEvent: CalendarEvent = {
      id: eventId,
      title: booking.eventTitle || `Booking with ${booking.name}`,
      description: `Booking by ${booking.name} (${booking.email})${booking.notes ? `\n\nNotes: ${booking.notes}` : ""}`,
      start: booking.start,
      end: booking.end,
      location: "",
      allDay: false,
      source: "local",
      color: "#4f46e5",
      createdAt: now,
      updatedAt: now,
    };
    writeJsonFile(path.join(EVENTS_DIR, `${eventId}.json`), calEvent);

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

    // Get all bookings for this date
    const allBookings = listJsonFiles<Booking>(BOOKINGS_DIR);
    const dayBookings = allBookings.filter((b) => {
      if (b.status === "cancelled") return false;
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      return bStart < new Date(dayEnd) && bEnd > new Date(dayStart);
    });

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

        // Check for conflicts with events (including buffer)
        const hasConflict = [...dayEvents, ...dayBookings].some((item) => {
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
    const existing = readJsonFile<Booking>(bookingPath(id));
    if (!existing) {
      setResponseStatus(event, 404);
      return { error: "Booking not found" };
    }

    deleteJsonFile(bookingPath(id));
    return { success: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
