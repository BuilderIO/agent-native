import {
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  encodeOAuthState,
  getSession,
  isElectron,
  resolveOAuthRedirectUri,
  safeReturnPath,
} from "@agent-native/core/server";
import {
  CLIPS_GOOGLE_OAUTH_APP_ID,
} from "../../../lib/google-calendar-oauth.js";
import {
  GOOGLE_AUTH_URL,
  GOOGLE_CALENDAR_SCOPES,
} from "../../../lib/google-calendar-client.js";

const GOOGLE_IDENTITY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export default defineEventHandler(async (event: H3Event) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }

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
      q.calendar === "1" ||
      q.calendar === "true" ||
      q.product === "calendar";

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
      client_id: clientId,
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
    if (q.redirect === "1") return sendRedirect(event, url, 302);
    return { url };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err?.message ?? "Unknown error" };
  }
});
