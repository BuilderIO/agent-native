/**
 * Backwards-compatible Google Calendar OAuth callback.
 *
 * New auth URLs use the framework-standard `/_agent-native/google/callback`
 * path so local Google OAuth credentials do not need a Clips-only `/api`
 * redirect URI. Keep this route for any in-flight or externally configured
 * legacy flows.
 */

import { defineEventHandler, getQuery, type H3Event } from "h3";
import { decodeOAuthState, getAppUrl } from "@agent-native/core/server";
import { handleGoogleCalendarCallback } from "../../../../lib/google-calendar-oauth.js";

export default defineEventHandler(async (event: H3Event) => {
  const state = decodeOAuthState(
    getQuery(event).state as string | undefined,
    getAppUrl(event, "/api/auth/google-calendar/callback"),
  );

  return handleGoogleCalendarCallback(event, state);
});
