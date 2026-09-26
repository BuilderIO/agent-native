
import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  GOOGLE_AUTH_URL,
  GOOGLE_CALENDAR_SCOPES,
} from "../server/lib/google-calendar-client.js";

export default defineAction({
  description:
    "Get the OAuth URL to connect a Google Calendar account. Open the returned URL in a popup or new tab — the callback persists tokens in app_secrets.",
  schema: z.object({
    provider: z.enum(["google"]).default("google"),
    returnUrl: z.string().optional(),
    flowId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .optional(),
    calendarAccountId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,128}$/)
      .optional(),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "GOOGLE_CLIENT_ID is not set. Ask the user to configure Google Calendar OAuth credentials in settings.",
      );
    }
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error(
        "Not authenticated — sign in before connecting a calendar.",
      );
    }

    const params = new URLSearchParams({ calendar: "1", redirect: "1" });
    if (args.returnUrl) params.set("return", args.returnUrl);
    if (args.flowId) params.set("flow_id", args.flowId);
    if (args.calendarAccountId)
      params.set("oauth_target_id", args.calendarAccountId);
    const url = `/_agent-native/google/auth-url?${params.toString()}`;

    return {
      provider: args.provider,
      url,
      scopes: GOOGLE_CALENDAR_SCOPES,
      authBaseUrl: GOOGLE_AUTH_URL,
    };
  },
});
