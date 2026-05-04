import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  createOAuthSession,
  decodeOAuthState,
  getAppUrl,
  oauthCallbackResponse,
  oauthErrorPage,
  resolveOAuthOwner,
  setDesktopExchange,
  type OAuthStatePayload,
} from "@agent-native/core/server";
import {
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
} from "../../../lib/google-calendar-client.js";
import {
  handleGoogleCalendarCallback,
  isCalendarConnectState,
} from "../../../lib/google-calendar-oauth.js";

async function handleGoogleSignInCallback(
  event: H3Event,
  state: OAuthStatePayload,
) {
  const desktop = state.desktop;
  const flowId = state.flowId;

  try {
    const query = getQuery(event);
    const googleError = query.error as string | undefined;
    if (googleError) {
      const errorDesc =
        (query.error_description as string | undefined) || googleError;
      const isPermission =
        googleError === "access_denied" ||
        errorDesc.includes("Insufficient Permission");
      const userMessage = isPermission
        ? "Access was denied. If the app is in testing mode, add this email as a test user in Google Cloud Console."
        : `Connection failed: ${errorDesc}`;
      return oauthErrorPage(userMessage);
    }

    const code = query.code as string | undefined;
    if (!code) {
      setResponseStatus(event, 400);
      return { error: "Missing authorization code" };
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return oauthErrorPage(
        "Google OAuth is not configured (missing client id/secret).",
      );
    }

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: state.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(
        tokens.error_description || tokens.error || "Token exchange failed",
      );
    }

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();
    const email = user.email as string | undefined;
    if (!email) throw new Error("Could not get email from Google");
    if (user.verified_email !== true) {
      throw new Error(
        "Google account email is not verified. Please verify your email with Google and try again.",
      );
    }

    const { hasProductionSession } = await resolveOAuthOwner(
      event,
      state.owner,
    );
    const { sessionToken } = await createOAuthSession(event, email, {
      hasProductionSession,
      desktop,
    });

    if (flowId && sessionToken) {
      setDesktopExchange(flowId, sessionToken, email);
    }

    return oauthCallbackResponse(event, email, {
      sessionToken,
      desktop,
      returnUrl: state.returnUrl,
      flowId,
      appName: "Clips",
    });
  } catch (err: any) {
    return oauthErrorPage(
      `Connection failed: ${err?.message ?? "Unknown error"}`,
    );
  }
}

export default defineEventHandler(async (event: H3Event) => {
  const state = decodeOAuthState(
    getQuery(event).state as string | undefined,
    getAppUrl(event, "/_agent-native/google/callback"),
  );

  if (isCalendarConnectState(state)) {
    return handleGoogleCalendarCallback(event, state);
  }

  return handleGoogleSignInCallback(event, state);
});
