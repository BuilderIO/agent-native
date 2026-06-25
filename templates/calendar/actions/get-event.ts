import { defineAction } from "@agent-native/core";
import { getRequestUserEmail, buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { calendarGetEvent } from "../server/lib/google-api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import type { CalendarEvent } from "../shared/api.js";
import { getGoogleEventColorHex } from "../shared/google-event-colors.js";

export default defineAction({
  description: "Fetch a single Google Calendar event by id",
  schema: z.object({
    id: z
      .string()
      .describe(
        'Google Calendar event id. Accepts the prefixed form ("google-<id>") or the raw Google event id.',
      ),
    calendarId: z
      .string()
      .optional()
      .default("primary")
      .describe('Calendar id — defaults to "primary"'),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const evt = result as { id?: string; start?: string; error?: string };
    if (evt.error || !evt.id) return null;
    const date =
      typeof evt.start === "string" && evt.start
        ? evt.start.slice(0, 10)
        : undefined;
    return {
      url: buildDeepLink({
        app: "calendar",
        view: "calendar",
        params: { eventId: evt.id, date },
      }),
      label: "Open event in Calendar",
      view: "calendar",
    };
  },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");

    const rawId = args.id.startsWith("google-")
      ? args.id.slice("google-".length)
      : args.id;
    const calendarId = args.calendarId ?? "primary";

    const clients = await googleCalendar.getClients(email);
    if (clients.length === 0) {
      return {
        error: "Google Calendar not connected. Connect via Settings first.",
      };
    }

    for (const { email: acctEmail, accessToken } of clients) {
      try {
        const evt = await calendarGetEvent(accessToken, calendarId, rawId);
        const selfAttendee = evt.attendees?.find((a: any) => a.self === true);

        const calEvent: CalendarEvent = {
          id: `google-${evt.id}`,
          title: evt.summary || "Untitled",
          description: evt.description || "",
          start: evt.start?.dateTime || evt.start?.date || "",
          end: evt.end?.dateTime || evt.end?.date || "",
          startTimeZone: evt.start?.timeZone || undefined,
          endTimeZone: evt.end?.timeZone || undefined,
          location: evt.location || "",
          allDay: !evt.start?.dateTime,
          source: "google",
          googleEventId: evt.id || undefined,
          htmlLink: evt.htmlLink || undefined,
          accountEmail: acctEmail,
          responseStatus: selfAttendee?.responseStatus || undefined,
          transparency: evt.transparency || undefined,
          colorId: evt.colorId || undefined,
          color: getGoogleEventColorHex(evt.colorId),
          eventType: evt.eventType || "default",
          attendees: evt.attendees?.map((a: any) => ({
            email: a.email,
            displayName: a.displayName || undefined,
            photoUrl: a.photoUrl || undefined,
            comment: a.comment || undefined,
            responseStatus: a.responseStatus || undefined,
            organizer: a.organizer || undefined,
            self: a.self || undefined,
          })),
          remindersUseDefault: evt.reminders?.useDefault ?? true,
          reminders: evt.reminders?.overrides?.map((r: any) => ({
            method: r.method,
            minutes: r.minutes,
          })),
          recurrence: evt.recurrence || undefined,
          recurringEventId: evt.recurringEventId || undefined,
          hangoutLink: evt.hangoutLink || undefined,
          conferenceData: evt.conferenceData
            ? {
                entryPoints: evt.conferenceData.entryPoints?.map((ep: any) => ({
                  entryPointType: ep.entryPointType,
                  uri: ep.uri,
                  label: ep.label || undefined,
                  pin: ep.pin || undefined,
                  passcode: ep.passcode || undefined,
                })),
                conferenceSolution: evt.conferenceData.conferenceSolution
                  ? {
                      name: evt.conferenceData.conferenceSolution.name,
                      iconUri:
                        evt.conferenceData.conferenceSolution.iconUri ||
                        undefined,
                    }
                  : undefined,
              }
            : undefined,
          attachments: evt.attachments?.map((a: any) => ({
            fileUrl: a.fileUrl,
            title: a.title || "Untitled",
            mimeType: a.mimeType || undefined,
            iconLink: a.iconLink || undefined,
            fileId: a.fileId || undefined,
          })),
          visibility: evt.visibility || undefined,
          status: evt.status || undefined,
          outOfOfficeProperties: evt.outOfOfficeProperties || undefined,
          focusTimeProperties: evt.focusTimeProperties || undefined,
          workingLocationProperties: evt.workingLocationProperties || undefined,
          organizer: evt.organizer
            ? {
                email: evt.organizer.email,
                displayName: evt.organizer.displayName || undefined,
                self: evt.organizer.self || undefined,
              }
            : undefined,
          createdAt: evt.created || new Date().toISOString(),
          updatedAt: evt.updated || new Date().toISOString(),
        };

        return calEvent;
      } catch {
        // Try next account
        continue;
      }
    }

    return { error: `Event not found: ${args.id}` };
  },
});
