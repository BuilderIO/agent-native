import { defineAction } from "@agent-native/core";
import { z } from "zod";
import * as googleCalendar from "../server/lib/google-calendar.js";
import {
  normalizeGoogleEventId,
  requireActionUserEmail,
  resolveOwnedAccountEmail,
} from "./event-action-helpers.js";

export default defineAction({
  description:
    "RSVP to a Google Calendar event as accepted, declined, or tentative. Use this when the user asks to accept, decline, or maybe a meeting invitation.",
  schema: z.object({
    id: z
      .string()
      .describe('Google Calendar event id, with or without "google-" prefix'),
    accountEmail: z
      .string()
      .optional()
      .describe(
        "Connected Google account email from list-events/search-events",
      ),
    status: z
      .enum(["accepted", "declined", "tentative"])
      .describe("The RSVP response to set"),
    scope: z
      .enum(["single", "all", "thisAndFollowing"])
      .optional()
      .default("single")
      .describe("For recurring events, which instances to update"),
    sendUpdates: z
      .enum(["all", "none"])
      .optional()
      .describe("Whether Google should notify attendees"),
  }),
  run: async (args) => {
    const ownerEmail = requireActionUserEmail();
    if (!(await googleCalendar.isConnected(ownerEmail))) {
      throw new Error(
        "Google Calendar not connected. Connect via Settings first.",
      );
    }

    const googleEventId = normalizeGoogleEventId(args.id);
    const accountEmail = await resolveOwnedAccountEmail(
      args.accountEmail,
      ownerEmail,
    );

    await googleCalendar.rsvpEvent(
      googleEventId,
      args.status,
      accountEmail,
      args.scope,
      args.sendUpdates,
    );

    return {
      success: true,
      id: `google-${googleEventId}`,
      accountEmail,
      status: args.status,
      scope: args.scope,
    };
  },
});
