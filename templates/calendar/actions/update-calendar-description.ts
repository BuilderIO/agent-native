import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  setAccountDescription,
  setFeedDescription,
} from "../server/lib/calendar-descriptions.js";
import { getOwnedAccountEmails } from "../server/lib/google-calendar.js";
import {
  MAX_CALENDAR_DESCRIPTION_LENGTH,
  normalizeCalendarDescription,
} from "../shared/calendar-descriptions.js";

export default defineAction({
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    'Describe one of the user\'s connected Google accounts or subscribed calendar feeds, such as "Builder work; meetings with Steve go here", so agents know which one to use. list-events, list-google-calendars, list-external-calendars and the Google status return the description. An empty description clears it. Saves Agent-Native\'s own note only; Google Calendar is not changed.',
  schema: z
    .object({
      accountEmail: z
        .string()
        .email()
        .optional()
        .describe("Connected Google account to describe"),
      feedId: z
        .string()
        .min(1)
        .optional()
        .describe("id of a subscribed calendar feed, from list-external-calendars"),
      description: z
        .string()
        .max(MAX_CALENDAR_DESCRIPTION_LENGTH)
        .describe(
          "What the account or feed is for and what belongs on it; empty clears it",
        ),
    })
    .refine((args) => Boolean(args.accountEmail) !== Boolean(args.feedId), {
      message: "Set exactly one of accountEmail or feedId",
      path: ["accountEmail"],
    }),
  http: { method: "PUT" },
  run: async (args) => {
    const owner = getRequestUserEmail();
    if (!owner) throw new Error("no authenticated user");
    const description = normalizeCalendarDescription(args.description);

    if (args.accountEmail) {
      const target = args.accountEmail.trim().toLowerCase();
      const accountEmail = (await getOwnedAccountEmails(owner)).find(
        (email) => email.trim().toLowerCase() === target,
      );
      if (!accountEmail) {
        throw new Error(
          `${args.accountEmail} isn't one of your connected Google accounts`,
        );
      }
      await setAccountDescription(owner, accountEmail, description);
      return { accountEmail, description: description ?? null };
    }

    const feed = await setFeedDescription(owner, args.feedId!, description);
    if (!feed) throw new Error(`No calendar feed has the id ${args.feedId}`);
    return { feedId: feed.id, name: feed.name, description: description ?? null };
  },
});
