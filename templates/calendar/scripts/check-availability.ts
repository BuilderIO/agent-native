/**
 * Check available time slots for a given date
 *
 * Usage:
 *   pnpm script check-availability --date 2026-03-15
 *   pnpm script check-availability --date 2026-03-15 --duration 60
 *
 * Options:
 *   --date      Date to check (YYYY-MM-DD, required)
 *   --duration  Minimum slot duration in minutes (default: 30)
 */

import { config } from "dotenv";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { agentChat } from "@agent-native/core";
import { parseArgs, formatMinutes } from "./helpers.js";

interface AvailabilitySchedule {
  timezone: string;
  schedule: Record<string, { start: string; end: string }[]>;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  status?: string;
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

export default async function main(args: string[]) {
  config();

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
    availability = JSON.parse(
      readFileSync(join("data", "availability.json"), "utf-8"),
    );
  } catch {
    console.error("Error: Could not read data/availability.json");
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

  // Load events for this date
  const eventsDir = join("data", "events");
  const dayEvents: CalendarEvent[] = [];

  try {
    const files = readdirSync(eventsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const event: CalendarEvent = JSON.parse(
          readFileSync(join(eventsDir, file), "utf-8"),
        );

        // Skip cancelled events
        if (event.status === "cancelled") continue;

        // Check if event overlaps with this date
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        const dayStart = new Date(dateStr + "T00:00:00");
        const dayEnd = new Date(dateStr + "T23:59:59");

        if (eventStart <= dayEnd && eventEnd >= dayStart) {
          dayEvents.push(event);
        }
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // No events directory — all slots are free
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
