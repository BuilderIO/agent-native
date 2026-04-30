import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";
import { formatDateRange } from "./helpers.js";

async function fetchEventsForRange(from: string, to: string): Promise<any[]> {
  try {
    const googleCalendar = await import("../server/lib/google-calendar.js");
    const email = getRequestUserEmail();
    if (!email || !(await googleCalendar.isConnected(email))) {
      return [];
    }
    const { events } = await googleCalendar.listEvents(from, to, email);
    return events;
  } catch {
    return [];
  }
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view, date range, and visible events. Always call this first before taking any action.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = navigation as any;

    if (nav?.view === "calendar" || !nav?.view) {
      const now = new Date();
      const viewDate = nav?.date ? new Date(nav.date) : now;

      const from = new Date(viewDate);
      from.setDate(from.getDate() - from.getDay());
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);

      const events = await fetchEventsForRange(
        from.toISOString(),
        to.toISOString(),
      );

      const compact = events.slice(0, 50).map((e: any) => {
        const videoLink =
          e.hangoutLink ||
          e.conferenceData?.entryPoints?.find(
            (ep: any) => ep.entryPointType === "video",
          )?.uri;
        return {
          id: e.id,
          title: e.title,
          start: e.start,
          end: e.end,
          location: e.location || undefined,
          allDay: e.allDay || undefined,
          attendeeCount: e.attendees?.length ?? 0,
          attendeeNames: e.attendees
            ?.filter((a: any) => !a.self)
            .slice(0, 8)
            .map((a: any) => a.displayName || a.email),
          videoLink: videoLink || undefined,
          responseStatus: e.responseStatus || undefined,
        };
      });

      screen.events = {
        from: from.toISOString(),
        to: to.toISOString(),
        count: compact.length,
        items: compact,
      };

      if (nav?.eventId) {
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
  },
});
