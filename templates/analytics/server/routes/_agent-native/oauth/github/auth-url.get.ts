import {
  encodeOAuthState,
  getSession,
  isElectron,
  resolveOAuthRedirectUri,
} from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  sendRedirect,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  getGitHubOAuthAuthUrl,
  isGitHubOAuthConfigured,
} from "../../../../lib/github-oauth.js";

const OAUTH_STATE_APP_ID = process.env.APP_NAME || "analytics";

export default defineEventHandler(async (event: H3Event) => {
  if (!isGitHubOAuthConfigured()) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "GitHub OAuth credentials are not configured. Set GITHUB_INTEGRATION_CLIENT_ID and GITHUB_INTEGRATION_CLIENT_SECRET.",
    };
  }

  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Sign in before connecting GitHub." };
  }

  const redirectUri = resolveOAuthRedirectUri(
    event,
    "/_agent-native/oauth/github/callback",
  );
  if (!redirectUri) {
    setResponseStatus(event, 400);
    return {
      error: "invalid_redirect_uri",
      message: "redirect_uri must stay on this app's _agent-native routes.",
    };
  }

  const state = encodeOAuthState({
    redirectUri,
    owner: session.email,
    desktop: isElectron(event),
    app: OAUTH_STATE_APP_ID,
  });
  const url = getGitHubOAuthAuthUrl(redirectUri, state);
  if (getQuery(event).redirect === "1") {
    return sendRedirect(event, url, 302);
  }
  return { url };
});
