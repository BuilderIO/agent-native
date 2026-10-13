import {
  getSession,
  resolveOAuthRedirectUri,
  encodeOAuthState,
  isElectron,
} from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import { getZoomAuthUrl, isZoomConfigured } from "../../../lib/zoom.js";

const OAUTH_STATE_APP_ID = process.env.APP_NAME || "calendar";

function oauthRedirectResponse(url: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

export default defineEventHandler(async (event: H3Event) => {
  if (!isZoomConfigured()) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "Zoom OAuth credentials are not configured. Set ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET.",
    };
  }
  const redirectUri = resolveOAuthRedirectUri(
    event,
    "/_agent-native/zoom/callback",
  );
  if (!redirectUri) {
    setResponseStatus(event, 400);
    return {
      error: "invalid_redirect_uri",
      message: "redirect_uri must stay on this app's _agent-native routes.",
    };
  }
  const session = await getSession(event);
  const owner = session?.email;
  const desktop = isElectron(event);
  const state = encodeOAuthState({
    redirectUri,
    owner,
    desktop,
    app: OAUTH_STATE_APP_ID,
  });
  const url = getZoomAuthUrl(redirectUri, state);
  if (getQuery(event).redirect === "1") {
    return oauthRedirectResponse(url);
  }
  return { url };
});
