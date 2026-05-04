/**
 * connect-calendar
 *
 * Returns the Google Calendar OAuth URL for the frontend to open in a
 * popup or new tab. The actual flow is handled by the Nitro routes at
 * `/_agent-native/google/auth-url?calendar=1` (initiate) and
 * `/_agent-native/google/callback` (token exchange + storage).
 *
 * Usage:
 *   pnpm action connect-calendar
 *
 * The agent / UI receives `{ url }` and opens it.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_CALENDAR_SCOPES,
} from "../server/lib/google-calendar-client.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export default defineAction({
  description:
    "Get the OAuth URL to connect a Google Calendar account. Open the returned URL in a popup or new tab — the callback persists tokens in app_secrets.",
  schema: z.object({
    provider: z.enum(["google"]).default("google"),
    /** Optional same-origin path to return the user to after success. */
    returnUrl: z.string().optional(),
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

    // The route mints signed state and uses the standard framework callback
    // path so the local Google OAuth client only needs one registered URI:
    // http://localhost:<port>/_agent-native/google/callback.
    const params = new URLSearchParams({ calendar: "1" });
    if (args.returnUrl) params.set("return", args.returnUrl);
    const url = `/_agent-native/google/auth-url?${params.toString()}`;

    return {
      provider: args.provider,
      url,
      // Surface the scopes for UX disclosure.
      scopes: GOOGLE_CALENDAR_SCOPES,
      authBaseUrl: GOOGLE_AUTH_URL,
    };
  },
});
