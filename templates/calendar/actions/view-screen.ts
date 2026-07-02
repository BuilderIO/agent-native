import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { rowToBookingLink } from "../server/lib/booking-link-utils.js";
import type { CalendarEvent, CalendarEventDraft } from "../shared/api.js";
import {
  CALENDAR_VIEW_PREFERENCES_KEY,
  normalizeCalendarViewPreferences,
} from "../shared/calendar-view-preferences.js";
import { extractVideoLink } from "./event-action-helpers.js";
import { listCalendarEvents } from "./list-events.js";

function safeDraftId(id: unknown): string | null {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

async function fetchEventsForRange(
  from: string,
  to: string,
): Promise<{
  events: CalendarEvent[];
  errors: Array<{ email: string; error: string }>;
  googleConnected: boolean;
  range: { from: string; to: string; timezone: string; defaulted: boolean };
}> {
  try {
    return await listCalendarEvents({ from, to });
  } catch (error: any) {
    return {
      events: [],
      errors: [
        {
          email: getRequestUserEmail() ?? "current-user",
          error: error?.message || "Unable to load calendar events",
        },
      ],
      googleConnected: false,
      range: {
        from,
        to,
        timezone: "UTC",
        defaulted: false,
      },
    };
  }
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view, date range, and visible events. Always call this first before taking any action.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");
    const visualPreferences = normalizeCalendarViewPreferences(
      (await readAppState(CALENDAR_VIEW_PREFERENCES_KEY)) as any,
    );

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    screen.visualPreferences = visualPreferences;

    const nav = navigation as any;

    if (nav?.view === "calendar" || !nav?.view) {
      const now = new Date();
      const viewDate = nav?.date ? new Date(nav.date) : now;

      const from = new Date(viewDate);
      from.setDate(from.getDate() - from.getDay());
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);

      const eventResult = await fetchEventsForRange(
        from.toISOString(),
        to.toISOString(),
      );
      const { events } = eventResult;

      const compact = events.slice(0, 50).map((e: CalendarEvent) => {
        return {
          id: e.id,
          title: e.title,
          start: e.start,
          end: e.end,
          source: e.source,
          accountEmail: e.accountEmail || undefined,
          location: e.location || undefined,
          allDay: e.allDay || undefined,
          attendeeCount: e.attendees?.length ?? 0,
          attendeeNames: e.attendees
            ?.filter((a: any) => !a.self)
            .slice(0, 8)
            .map((a: any) => a.displayName || a.email),
          videoLink: extractVideoLink(e) || undefined,
          responseStatus: e.responseStatus || undefined,
        };
      });

      screen.events = {
        from: eventResult.range.from,
        to: eventResult.range.to,
        timezone: eventResult.range.timezone,
        googleConnected: eventResult.googleConnected,
        count: compact.length,
        items: compact,
        errors: eventResult.errors.length > 0 ? eventResult.errors : undefined,
      };

      if (!eventResult.googleConnected) {
        screen.calendarConnection = {
          googleConnected: false,
          message:
            "Google Calendar is not connected or no usable Google account was found. Connect or reconnect it from Settings.",
        };
      }

      if (nav?.eventId) {
        const match = events.find((e: any) => e.id === nav.eventId);
        if (match) screen.selectedEvent = match;
      }

      const eventDraftId = safeDraftId(nav?.eventDraftId);
      if (eventDraftId) {
        const draft = (await readAppState(
          `calendar-draft-${eventDraftId}`,
        )) as unknown as CalendarEventDraft | null;
        screen.eventDraft = draft ?? { id: eventDraftId, missing: true };
      }
    } else if (nav?.view === "availability") {
      screen.page = "availability";
    } else if (nav?.view === "booking-links") {
      screen.page = "booking-links";
      if (nav?.bookingLinkId) screen.bookingLinkId = nav.bookingLinkId;
      const rows = await getDb()
        .select()
        .from(schema.bookingLinks)
        .where(accessFilter(schema.bookingLinks, schema.bookingLinkShares));
      const links = rows.map(rowToBookingLink);
      screen.bookingLinks = links.slice(0, 50).map((link) => ({
        id: link.id,
        title: link.title,
        slug: link.slug,
        duration: link.duration,
        durations: link.durations,
        hosts: link.hosts,
        visibility: link.visibility,
        isActive: link.isActive,
      }));
      if (nav?.bookingLinkId) {
        screen.selectedBookingLink = links.find(
          (link) => link.id === nav.bookingLinkId,
        );
      }
    } else if (nav?.view === "bookings") {
      screen.page = "bookings";
    } else if (nav?.view === "settings") {
      screen.page = "settings";
      try {
        const zoom = await import("../server/lib/zoom.js");
        const email = getRequestUserEmail();
        screen.zoom = await zoom.getZoomStatus(email);
      } catch {
        screen.zoom = { connected: false, configured: false, accounts: [] };
      }
    } else if (nav?.view === "extensions") {
      screen.page = "extensions";
      if (nav?.extensionId) screen.extensionId = nav.extensionId;
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
