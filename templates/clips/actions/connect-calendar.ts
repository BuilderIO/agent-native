/**
 * connect-calendar
 *
 * Returns the Google Calendar OAuth URL for the frontend to open in a
 * popup or new tab. The actual flow is handled by the Nitro routes at
 * `/api/auth/google-calendar` (initiate) and
 * `/api/auth/google-calendar/callback` (token exchange + storage).
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

    // We construct the entry-point URL on the client side; the redirect
    // handshake (signed state, redirect-uri allowlist) happens inside the
    // Nitro route at /api/auth/google-calendar. Action consumers just hit
    // that route; we return its path as a relative URL so the frontend can
    // open it in a popup with `window.open`.
    const params = new URLSearchParams();
    if (args.returnUrl) params.set("return", args.returnUrl);
    const url = `/api/auth/google-calendar${params.toString() ? `?${params.toString()}` : ""}`;

    return {
      provider: args.provider,
      url,
      // Surface the scopes for UX disclosure.
      scopes: GOOGLE_CALENDAR_SCOPES,
      authBaseUrl: GOOGLE_AUTH_URL,
    };
  },
});
