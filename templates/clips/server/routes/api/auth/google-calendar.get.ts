/**
 * GET /api/auth/google-calendar
 *
 * Initiates the Google Calendar OAuth flow. By default 302-redirects to
 * Google — that's what a popup or direct browser nav expects. Pass
 * `?json=1` to instead return a JSON `{ url }` payload (used internally
 * by the `connect-calendar` action when the caller wants the URL without
 * a redirect).
 *
 * Token storage policy: tokens are NEVER stored on this row. The callback
 * persists access + refresh tokens in `app_secrets` (per-user scope) and
 * writes the secret-key references onto the `calendar_accounts` row.
 *
 * Reuses framework OAuth helpers (HMAC-signed state, redirect_uri allow-
 * list) from `@agent-native/core/server`.
 */

import {
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  getSession,
  isElectron,
  encodeOAuthState,
  resolveOAuthRedirectUri,
  safeReturnPath,
} from "@agent-native/core/server";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_CALENDAR_SCOPES,
} from "../../../lib/google-calendar-client.js";

export default defineEventHandler(async (event: H3Event) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment, or paste them in the agent settings.",
    };
  }

  try {
    const q = getQuery(event);
    // Use the framework's redirect-uri allowlist helper, defaulting to the
    // calendar callback path. This blocks open-redirect / cross-host abuse.
    const redirectUri = resolveOAuthRedirectUri(
      event,
      "/api/auth/google-calendar/callback",
    );
    if (!redirectUri) {
      setResponseStatus(event, 400);
      return {
        error: "invalid_redirect_uri",
        message:
          "redirect_uri must stay on this app's _agent-native or /api routes.",
      };
    }

    const session = await getSession(event);
    const owner = session?.email;
    if (!owner) {
      setResponseStatus(event, 401);
      return {
        error: "not_authenticated",
        message: "Sign in before connecting a calendar.",
      };
    }

    const desktop =
      isElectron(event) || q.desktop === "1" || q.desktop === "true";
    const requestedReturn =
      typeof q.return === "string" ? safeReturnPath(q.return) : "/";
    const returnUrl = requestedReturn !== "/" ? requestedReturn : undefined;

    const state = encodeOAuthState({
      redirectUri,
      owner,
      desktop,
      addAccount: false,
      app: "clips-calendar",
      returnUrl,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      // We need a refresh token, so always force prompt=consent — Google only
      // hands back refresh_token on the FIRST consent unless we re-prompt.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      state,
    });
    const url = `${GOOGLE_AUTH_URL}?${params.toString()}`;

    // Default: 302 redirect — the natural behavior for a browser hitting
    // this route (popup, direct nav, etc.). Only return JSON when the
    // caller explicitly wants the URL string.
    if (q.json === "1") return { url };
    return sendRedirect(event, url, 302);
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err?.message ?? "Unknown error" };
  }
});
