import { defineAction } from "@agent-native/core/action";
import { isValidTimezone } from "@agent-native/core/jobs/cron";
import { z } from "zod";

import { listContactMeetings } from "../server/lib/contact-meetings.js";

const meetingSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  url: z.string().optional(),
  accountEmail: z.string().optional(),
});

export default defineAction({
  description:
    "List the user's upcoming and past meetings with one person: events in the next 60 days, soonest first, and the last 90 days, newest first. Reads Agent-Native Calendar when the user has Google connected there, otherwise the Google Calendar of each account connected to Mail. Use it for 'when do I next meet Priya?' or 'when did we last talk?'. source says where the events came from; none means no calendar is connected, which is not the same as no meetings. calendar says whether Calendar was used, has no Google account (not_connected), or couldn't be reached (unavailable). failedAccounts lists accounts that couldn't be read, so the lists may be incomplete.",
  schema: z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .describe("The person's email address"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Max meetings in each list (default: 3)"),
    timeZone: z
      .string()
      .refine(isValidTimezone, "Unknown time zone")
      .optional()
      .describe(
        "The user's IANA time zone, so an all-day event stays upcoming until the end of its local day (default: UTC)",
      ),
  }),
  outputSchema: z.object({
    source: z.enum(["calendar", "mail", "none"]),
    calendar: z.enum(["connected", "not_connected", "unavailable"]),
    calendarUrl: z.string().optional(),
    upcoming: z.array(meetingSchema),
    recent: z.array(meetingSchema),
    failedAccounts: z.array(
      z.object({ accountEmail: z.string(), message: z.string() }),
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: "search",
  run: (args) =>
    listContactMeetings(args.email, args.limit ?? 3, args.timeZone),
});
