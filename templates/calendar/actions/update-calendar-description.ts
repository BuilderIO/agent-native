import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  setAccountDescription,
  setFeedDescription,
} from "../server/lib/calendar-descriptions.js";
import { getConnectedAccounts } from "../server/lib/google-calendar.js";
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
    "Describe one of the user's connected Google accounts or subscribed calendar feeds, such as \"Work meetings and team 1:1s go here\", so agents know which one to use. list-events, list-google-calendars, list-external-calendars and the Google status return the description. An empty description clears it. Saves Agent-Native's own note only; Google Calendar is not changed.",
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
        .describe(
          "id of a subscribed calendar feed, from list-external-calendars",
        ),
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
  outputSchema: z.union([
    z.object({
      accountEmail: z.string(),
      description: z.string().nullable(),
    }),
    z.object({
      feedId: z.string(),
      name: z.string(),
      description: z.string().nullable(),
    }),
  ]),
  http: { method: "PUT" },
  run: async ({ accountEmail, feedId, description: text }) => {
    const owner = getRequestUserEmail();
    if (!owner) {
      fail("no authenticated user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const description = normalizeCalendarDescription(text);

    if (accountEmail) {
      const target = accountEmail.trim().toLowerCase();
      const owned = (await getConnectedAccounts(owner)).find(
        (email) => email.trim().toLowerCase() === target,
      );
      if (!owned) {
        fail(`${accountEmail} isn't one of your connected Google accounts`, {
          errorCode: "calendar_account_not_connected",
          statusCode: 404,
        });
      }
      await setAccountDescription(owner, owned, description);
      return { accountEmail: owned, description: description ?? null };
    }

    if (!feedId) {
      fail("Set exactly one of accountEmail or feedId", {
        errorCode: "calendar_description_target_missing",
      });
    }
    const feed = await setFeedDescription(owner, feedId, description);
    if (!feed) {
      fail(`No calendar feed has the id ${feedId}`, {
        errorCode: "calendar_feed_not_found",
        statusCode: 404,
      });
    }
    return {
      feedId: feed.id,
      name: feed.name,
      description: description ?? null,
    };
  },
});
