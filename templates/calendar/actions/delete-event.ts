import { defineAction } from "@agent-native/core";
import { z } from "zod";
import * as googleCalendar from "../server/lib/google-calendar.js";
import {
  cliBoolean,
  normalizeGoogleEventId,
  requireActionUserEmail,
  resolveOwnedAccountEmail,
} from "./event-action-helpers.js";

export default defineAction({
  description:
    "Delete or remove a Google Calendar event. For recurring events, choose just this instance, all events in the series, or this and following events.",
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
    scope: z
      .enum(["single", "all", "thisAndFollowing"])
      .optional()
      .default("single")
      .describe("Recurring-event delete scope"),
    sendUpdates: z
      .enum(["all", "none"])
      .optional()
      .default("none")
      .describe("Whether Google should notify attendees"),
    removeOnly: cliBoolean
      .optional()
      .describe(
        "Use true when the user is not the organizer and wants to remove/decline the event from their calendar.",
      ),
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
    const options = {
      scope: args.scope,
      sendUpdates: args.sendUpdates,
    };

    if (args.removeOnly) {
      await googleCalendar.removeEventFromCalendar(
        googleEventId,
        accountEmail,
        options,
      );
    } else {
      await googleCalendar.deleteEvent(googleEventId, accountEmail, options);
    }

    return {
      success: true,
      id: `google-${googleEventId}`,
      accountEmail,
      scope: args.scope,
      removedOnly: args.removeOnly ?? false,
    };
  },
});
