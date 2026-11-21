import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  accountDescriptionFor,
  getAccountDescriptions,
} from "../server/lib/calendar-descriptions.js";
import { listGoogleCalendars } from "../server/lib/google-calendar.js";

export default defineAction({
  mcpTool: "search",
  description:
    "Discover Google Calendar sources available through every connected account. Source keys are opaque and must be passed back to list-events; names and roles in client requests are never trusted. accountDescription says what the user uses that account for.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const [result, descriptions] = await Promise.all([
      listGoogleCalendars(ownerEmail),
      getAccountDescriptions(ownerEmail),
    ]);
    return {
      ...result,
      calendars: result.calendars.map((calendar) => {
        const accountDescription = accountDescriptionFor(
          descriptions,
          calendar.accountEmail,
        );
        return accountDescription
          ? { ...calendar, accountDescription }
          : calendar;
      }),
    };
  },
});
