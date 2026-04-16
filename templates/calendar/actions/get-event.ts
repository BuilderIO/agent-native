import { defineAction } from "@agent-native/core";
import { z } from "zod";
import type { CalendarEvent } from "../shared/api.js";
import * as googleCalendar from "../server/lib/google-calendar.js";
import { calendarGetEvent } from "../server/lib/google-api.js";

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
  run: async (args) => {
    const email = process.env.AGENT_USER_EMAIL || "local@localhost";

    const rawId = args.id.startsWith("google-")
      ? args.id.slice("google-".length)
      : args.id;
    const calendarId = args.calendarId ?? "primary";

    const clients = await googleCalendar.getClients(email);
    if (clients.length === 0) {
      throw new Error(
        "Google Calendar not connected. Connect via Settings first.",
      );
    }

    for (const { email: acctEmail, accessToken } of clients) {
      try {
        const evt = await calendarGetEvent(accessToken, calendarId, rawId);

        const calEvent: CalendarEvent = {
          id: `google-${evt.id}`,
          title: evt.summary || "Untitled",
          description: evt.description || "",
          start: evt.start?.dateTime || evt.start?.date || "",
          end: evt.end?.dateTime || evt.end?.date || "",
          location: evt.location || "",
          allDay: !evt.start?.dateTime,
          source: "google",
          googleEventId: evt.id || undefined,
          accountEmail: acctEmail,
          attendees: evt.attendees?.map((a: any) => ({
            email: a.email,
            displayName: a.displayName || undefined,
            photoUrl: a.photoUrl || undefined,
            responseStatus: a.responseStatus || undefined,
            organizer: a.organizer || undefined,
            self: a.self || undefined,
          })),
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

    throw new Error(`Event not found: ${args.id}`);
  },
});
