import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { readSetting } from "@agent-native/core/settings";

interface AvailabilitySchedule {
  timezone: string;
  schedule: Record<string, { start: string; end: string }[]>;
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export default defineAction({
  description: "Check available time slots for a given date",
  schema: z.object({
    date: z
      .string()
      .optional()
      .describe("Date to check (YYYY-MM-DD, required)"),
    duration: z.coerce
      .number()
      .optional()
      .default(30)
      .describe("Minimum slot duration in minutes (default: 30)"),
  }),
  http: false,
  run: async (args) => {
    if (!args.date) throw new Error("date is required (YYYY-MM-DD format)");

    const dateStr = args.date;
    const duration = args.duration;

    let availability: AvailabilitySchedule;
    const stored = await readSetting("calendar-availability");
    if (!stored) {
      throw new Error("No availability configuration found");
    }
    availability = stored as unknown as AvailabilitySchedule;

    const date = new Date(dateStr + "T00:00:00");
    const dayNames = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const dayName = dayNames[date.getDay()];

    const daySchedule = availability.schedule[dayName];
    if (!daySchedule || daySchedule.length === 0) {
      return {
        date: dateStr,
        day: dayName,
        slots: [],
        message: `No availability configured for ${dayName}.`,
      };
    }

    const dayStart = new Date(dateStr + "T00:00:00").toISOString();
    const dayEnd = new Date(dateStr + "T23:59:59").toISOString();

    const dayEvents: Array<{
      title: string;
      start: string;
      end: string;
      allDay?: boolean;
    }> = [];

    try {
      const googleCalendar = await import("../server/lib/google-calendar.js");
      if (await googleCalendar.isConnected()) {
        const { events } = await googleCalendar.listEvents(dayStart, dayEnd);
        for (const event of events) {
          dayEvents.push({
            title: event.title,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
          });
        }
      }
    } catch {
      // Continue without Google events if unavailable
    }

    const busyIntervals: { start: number; end: number }[] = [];
    for (const event of dayEvents) {
      if (event.allDay) {
        busyIntervals.push({ start: 0, end: 24 * 60 });
        continue;
      }
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      const startMin = eventStart.getHours() * 60 + eventStart.getMinutes();
      const endMin = eventEnd.getHours() * 60 + eventEnd.getMinutes();
      busyIntervals.push({ start: startMin, end: endMin });
    }
    busyIntervals.sort((a, b) => a.start - b.start);

    const freeSlots: { start: string; end: string; durationMin: number }[] = [];

    for (const window of daySchedule) {
      const windowStart = timeToMinutes(window.start);
      const windowEnd = timeToMinutes(window.end);
      let cursor = windowStart;

      for (const busy of busyIntervals) {
        if (busy.end <= cursor) continue;
        if (busy.start >= windowEnd) break;

        if (busy.start > cursor) {
          const slotEnd = Math.min(busy.start, windowEnd);
          if (slotEnd - cursor >= duration) {
            freeSlots.push({
              start: formatMinutes(cursor),
              end: formatMinutes(slotEnd),
              durationMin: slotEnd - cursor,
            });
          }
        }
        cursor = Math.max(cursor, busy.end);
      }

      if (cursor < windowEnd && windowEnd - cursor >= duration) {
        freeSlots.push({
          start: formatMinutes(cursor),
          end: formatMinutes(windowEnd),
          durationMin: windowEnd - cursor,
        });
      }
    }

    return {
      date: dateStr,
      day: dayName,
      minDuration: duration,
      slots: freeSlots,
      total: freeSlots.length,
    };
  },
});
