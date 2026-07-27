import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  calendarGetEvent,
  calendarPatchEvent,
} from "../server/lib/google-api.js";
import { isConnected } from "../server/lib/google-auth.js";
import type { UserSettings } from "../shared/types.js";
import { getAccessTokens } from "./helpers.js";

const responseSchema = z.enum(["accepted", "declined", "tentative"]);

export default defineAction({
  description:
    "Respond to a Google Calendar invite from Mail by accepting, declining, or marking tentative.",
  schema: z.object({
    eventId: z.string().describe("Google Calendar event id"),
    response: responseSchema.describe(
      "Invite response: accepted, declined, or tentative",
    ),
    calendarId: z
      .string()
      .optional()
      .describe("Calendar id, defaults to primary"),
    accountEmail: z
      .string()
      .optional()
      .describe("Connected Google account email, when known"),
  }),
  run: async ({ eventId, response, calendarId, accountEmail }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    if (!(await isConnected(ownerEmail))) {
      throw new Error("No Google account connected.");
    }

    const accounts = await getAccessTokens();
    const targetAccounts = accountEmail
      ? accounts.filter(
          (account) =>
            account.email.toLowerCase() === accountEmail.toLowerCase(),
        )
      : accounts;
    if (targetAccounts.length === 0) {
      throw new Error(
        accountEmail
          ? `Google account ${accountEmail} is not connected.`
          : "No Google account connected.",
      );
    }

    const settings = (await getUserSetting(ownerEmail, "mail-settings")) as
      | Partial<UserSettings>
      | undefined;
    const calId = calendarId || "primary";
    const errors: string[] = [];

    for (const account of targetAccounts) {
      try {
        const calEvent = await calendarGetEvent(
          account.accessToken,
          calId,
          eventId,
        );
        if (!calEvent) continue;

        const attendeeEmail = (
          settings?.email ||
          account.email ||
          ownerEmail
        ).toLowerCase();
        const attendees = Array.isArray(calEvent.attendees)
          ? [...calEvent.attendees]
          : [];
        let found = false;
        for (const attendee of attendees) {
          if (
            attendee?.email?.toLowerCase() === attendeeEmail ||
            attendee?.self
          ) {
            attendee.responseStatus = response;
            found = true;
            break;
          }
        }
        if (!found) {
          attendees.push({
            email: attendeeEmail,
            responseStatus: response,
            self: true,
          });
        }

        await calendarPatchEvent(
          account.accessToken,
          calId,
          eventId,
          { attendees },
          "all",
        );
        await writeAppState("refresh-signal", {
          ts: Date.now(),
          source: "calendar-rsvp",
        });
        return {
          ok: true,
          eventId,
          calendarId: calId,
          response,
          accountEmail: account.email,
        };
      } catch (err: any) {
        errors.push(
          `${account.email}: ${err?.message || "Calendar API error"}`,
        );
      }
    }

    throw new Error(`Could not update calendar invite. ${errors.join("; ")}`);
  },
});
