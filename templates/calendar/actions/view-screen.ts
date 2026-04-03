/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches matching data (events for visible
 * date range, or details for a selected event).
 *
 * Usage:
 *   pnpm action view-screen
 */

import { parseArgs, formatDateRange } from "./helpers.js";
import { readAppState } from "@agent-native/core/application-state";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "See what the user is currently looking at on screen. Returns the current view, date range, and visible events. Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {},
  },
};

async function fetchEventsForRange(from: string, to: string): Promise<any[]> {
  try {
    const googleCalendar = await import("../server/lib/google-calendar.js");
    if (!(await googleCalendar.isConnected())) {
      return [];
    }
    const { events } = await googleCalendar.listEvents(from, to);
    return events;
  } catch {
    return [];
  }
}

export async function run(args: Record<string, string>): Promise<string> {
  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = navigation as any;

  if (nav?.view === "calendar" || !nav?.view) {
    // On calendar view — fetch events for the visible date range
    const now = new Date();
    const viewDate = nav?.date ? new Date(nav.date) : now;

    // Default to current week if no specific range
    const from = new Date(viewDate);
    from.setDate(from.getDate() - from.getDay()); // start of week
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);

    const events = await fetchEventsForRange(
      from.toISOString(),
      to.toISOString(),
    );

    const compact = events.slice(0, 50).map((e: any) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      location: e.location || undefined,
      allDay: e.allDay || undefined,
      attendees: e.attendees?.length ?? 0,
    }));

    screen.events = {
      from: from.toISOString(),
      to: to.toISOString(),
      count: compact.length,
      items: compact,
    };

    if (nav?.eventId) {
      // User has a specific event selected — include its details
      const match = events.find((e: any) => e.id === nav.eventId);
      if (match) screen.selectedEvent = match;
    }
  } else if (nav?.view === "availability") {
    screen.page = "availability";
  } else if (nav?.view === "booking-links") {
    screen.page = "booking-links";
    if (nav?.bookingLinkId) screen.bookingLinkId = nav.bookingLinkId;
  } else if (nav?.view === "bookings") {
    screen.page = "bookings";
  } else if (nav?.view === "settings") {
    screen.page = "settings";
  }

  if (Object.keys(screen).length === 0) {
    return "No application state found. Is the app running?";
  }
  return JSON.stringify(screen, null, 2);
}

export default async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv) as Record<string, string>;
  const result = await run(args);

  try {
    const parsed = JSON.parse(result);
    const nav = parsed.navigation;
    const eventCount = parsed.events?.count ?? 0;

    console.error(
      `Current view: ${nav?.view ?? "calendar"}` +
        (nav?.date ? ` (date: ${nav.date})` : "") +
        (nav?.eventId ? ` (event: ${nav.eventId})` : "") +
        ` — ${eventCount} event(s) on screen`,
    );
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(result);
  }
}
