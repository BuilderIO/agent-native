import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  isElectron,
  getOrigin,
  encodeOAuthState,
  decodeOAuthState,
  createOAuthSession,
  oauthCallbackResponse,
  oauthErrorPage,
} from "@agent-native/core/server";

const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export const getGoogleAuthUrl = defineEventHandler((event: H3Event) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }
  const redirectUri =
    (getQuery(event).redirect_uri as string) ||
    `${getOrigin(event)}/_agent-native/google/callback`;
  const desktop = isElectron(event);
  const state = encodeOAuthState(
    redirectUri,
    undefined,
    desktop,
    false,
    "slides",
  );
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "online",
    prompt: "select_account",
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
});

export const handleGoogleCallback = defineEventHandler(
  async (event: H3Event) => {
    try {
      const query = getQuery(event);
      const code = query.code as string;
      if (!code) {
        setResponseStatus(event, 400);
        return { error: "Missing authorization code" };
      }

      const { redirectUri, desktop } = decodeOAuthState(
        query.state as string | undefined,
        `${getOrigin(event)}/_agent-native/google/callback`,
      );

      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok) {
        throw new Error(
          tokens.error_description || tokens.error || "Token exchange failed",
        );
      }

      // Get user info
      const userRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      const user = await userRes.json();
      const email = user.email as string;
      if (!email) throw new Error("Could not get email from Google");

      // Create session
      const { sessionToken } = await createOAuthSession(event, email, {
        hasProductionSession: false,
        desktop,
      });

      // Return platform-appropriate response
      return oauthCallbackResponse(event, email, {
        sessionToken,
        desktop,
      });
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      return oauthErrorPage(`Connection failed: ${msg}`);
    }
  },
);
