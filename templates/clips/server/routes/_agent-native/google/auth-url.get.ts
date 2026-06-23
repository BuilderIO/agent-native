import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  encodeOAuthState,
  getSession,
  isElectron,
  resolveGoogleSignInCredentials,
  resolveOAuthRedirectUri,
  safeReturnPath,
} from "@agent-native/core/server";
import { CLIPS_GOOGLE_OAUTH_APP_ID } from "../../../lib/google-calendar-oauth.js";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_CALENDAR_SCOPES,
} from "../../../lib/google-calendar-client.js";

const GOOGLE_IDENTITY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function oauthRedirectResponse(url: string) {
  // h3 v2 sendRedirect returns an object the framework shim can stringify as
  // "[object Object]" in production auth-url popups. Native Response stays a
  // real 302 across the stack.
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

export default defineEventHandler(async (event: H3Event) => {
  try {
    const q = getQuery(event);
    const redirectUri = resolveOAuthRedirectUri(event);
    if (!redirectUri) {
      setResponseStatus(event, 400);
      return {
        error: "invalid_redirect_uri",
        message: "redirect_uri must stay on this app's _agent-native routes.",
      };
    }

    const session = await getSession(event);
    const owner = session?.email;
    const desktop =
      isElectron(event) || q.desktop === "1" || q.desktop === "true";
    const flowId =
      desktop && typeof q.flow_id === "string" ? q.flow_id : undefined;
    const requestedReturn =
      typeof q.return === "string" ? safeReturnPath(q.return) : "/";
    const returnUrl = requestedReturn !== "/" ? requestedReturn : undefined;
    const calendarConnect =
      q.calendar === "1" || q.calendar === "true" || q.product === "calendar";
    const credentials = calendarConnect
      ? process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }
        : null
      : resolveGoogleSignInCredentials();
    if (!credentials) {
      setResponseStatus(event, 422);
      return {
        error: "missing_credentials",
        message: calendarConnect
          ? "Google Calendar OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
          : "Google sign-in credentials are not configured. Set GOOGLE_SIGN_IN_CLIENT_ID and GOOGLE_SIGN_IN_CLIENT_SECRET.",
      };
    }

    if (calendarConnect && !owner) {
      setResponseStatus(event, 401);
      return {
        error: "not_authenticated",
        message: "Sign in before connecting a calendar.",
      };
    }

    const state = encodeOAuthState({
      redirectUri,
      owner,
      desktop,
      addAccount: calendarConnect,
      app: CLIPS_GOOGLE_OAUTH_APP_ID,
      returnUrl,
      flowId: calendarConnect ? undefined : flowId,
    });

    const params = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
    });

    if (calendarConnect) {
      params.set("access_type", "offline");
      params.set("prompt", "consent");
      params.set("include_granted_scopes", "true");
      params.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
    } else {
      params.set("access_type", "online");
      params.set("prompt", "select_account");
      params.set("scope", GOOGLE_IDENTITY_SCOPES.join(" "));
    }

    const url = `${GOOGLE_AUTH_URL}?${params.toString()}`;
    if (q.redirect === "1") return oauthRedirectResponse(url);
    return { url };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err?.message ?? "Unknown error" };
  }
});
