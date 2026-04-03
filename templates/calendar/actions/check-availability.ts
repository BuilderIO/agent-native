/**
 * Check available time slots for a given date
 *
 * Usage:
 *   pnpm action check-availability --date 2026-03-15
 *   pnpm action check-availability --date 2026-03-15 --duration 60
 *
 * Options:
 *   --date      Date to check (YYYY-MM-DD, required)
 *   --duration  Minimum slot duration in minutes (default: 30)
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};
import { agentChat } from "@agent-native/core";
import { readSetting } from "@agent-native/core/settings";
import { parseArgs, formatMinutes } from "./helpers.js";

interface AvailabilitySchedule {
  timezone: string;
  schedule: Record<string, { start: string; end: string }[]>;
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

export default async function main(args: string[]) {
  await config();

  const opts = parseArgs(args);

  if (!opts["date"]) {
    console.error("Error: --date is required (YYYY-MM-DD format)");
    process.exit(1);
  }

  const dateStr = opts["date"];
  const duration = parseInt(opts["duration"] || "30", 10);

  // Load availability schedule
  let availability: AvailabilitySchedule;
  try {
    const stored = await readSetting("calendar-availability");
    if (!stored) {
      console.error("Error: No availability configuration found");
      process.exit(1);
    }
    availability = stored as unknown as AvailabilitySchedule;
  } catch {
    console.error("Error: Could not read availability settings");
    process.exit(1);
  }

  // Determine day of week
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
    console.log(`No availability configured for ${dayName} (${dateStr}).`);
    agentChat.submit(`No availability on ${dayName} ${dateStr}.`);
    return;
  }

  // Fetch events from Google Calendar for this date
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
    console.warn(
      "Warning: Could not fetch Google Calendar events. Showing availability based on schedule only.",
    );
  }

  // Convert events to busy intervals (minutes since midnight)
  const busyIntervals: { start: number; end: number }[] = [];
  for (const event of dayEvents) {
    if (event.allDay) {
      // All-day events block the entire day
      busyIntervals.push({ start: 0, end: 24 * 60 });
      continue;
    }

    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    const startMin = eventStart.getHours() * 60 + eventStart.getMinutes();
    const endMin = eventEnd.getHours() * 60 + eventEnd.getMinutes();

    busyIntervals.push({ start: startMin, end: endMin });
  }

  // Sort busy intervals
  busyIntervals.sort((a, b) => a.start - b.start);

  // Compute free slots within each availability window
  const freeSlots: { start: number; end: number }[] = [];

  for (const window of daySchedule) {
    const windowStart = timeToMinutes(window.start);
    const windowEnd = timeToMinutes(window.end);

    let cursor = windowStart;

    for (const busy of busyIntervals) {
      if (busy.end <= cursor) continue;
      if (busy.start >= windowEnd) break;

      if (busy.start > cursor) {
        // Free slot before this busy period
        const slotEnd = Math.min(busy.start, windowEnd);
        if (slotEnd - cursor >= duration) {
          freeSlots.push({ start: cursor, end: slotEnd });
        }
      }

      cursor = Math.max(cursor, busy.end);
    }

    // Free slot after last busy period
    if (cursor < windowEnd && windowEnd - cursor >= duration) {
      freeSlots.push({ start: cursor, end: windowEnd });
    }
  }

  // Print results
  console.log(`\nAvailability for ${dateStr} (${dayName}):`);
  console.log(`Minimum slot duration: ${duration} minutes\n`);

  if (freeSlots.length === 0) {
    console.log("No available slots.");
    agentChat.submit(
      `No available ${duration}-minute slots on ${dateStr} (${dayName}).`,
    );
    return;
  }

  console.log("Available slots:");
  for (const slot of freeSlots) {
    const durationMin = slot.end - slot.start;
    console.log(
      `  ${formatMinutes(slot.start)} – ${formatMinutes(slot.end)}  (${durationMin} min)`,
    );
  }

  console.log(`\nTotal: ${freeSlots.length} available slot(s)`);
  agentChat.submit(
    `Found ${freeSlots.length} available slot(s) on ${dateStr} (${dayName}) with at least ${duration} minutes free.`,
  );
}
