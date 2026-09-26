
import {
  decodeOAuthState,
  getAppUrl,
  logOAuthStateDecodeFailure,
  oauthErrorPage,
} from "@agent-native/core/server";
import { defineEventHandler, getQuery, type H3Event } from "h3";

import { handleGoogleCalendarCallback } from "../../../../lib/google-calendar-oauth.js";

export default defineEventHandler(async (event: H3Event) => {
  const state = decodeOAuthState(
    getQuery(event).state as string | undefined,
    getAppUrl(event, "/api/auth/google-calendar/callback"),
  );
  if (!state.ok) {
    logOAuthStateDecodeFailure(event, state.reason, "google_calendar");
    return oauthErrorPage(
      "Google Calendar connection failed: your sign-in link expired or is invalid. Please try again.",
    );
  }

  return handleGoogleCalendarCallback(event, state);
});
