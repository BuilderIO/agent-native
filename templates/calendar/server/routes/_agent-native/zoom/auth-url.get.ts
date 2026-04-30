/**
 * Start the Zoom OAuth flow.
 *
 * Returns a JSON `{ url }` the client redirects to. State encodes the
 * current session owner so the callback can attribute the tokens
 * correctly.
 */
import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  getSession,
  getOrigin,
  encodeOAuthState,
  isElectron,
  DEV_MODE_USER_EMAIL,
} from "@agent-native/core/server";
import { getZoomAuthUrl, isZoomConfigured } from "../../../lib/zoom.js";

export default defineEventHandler(async (event: H3Event) => {
  if (!isZoomConfigured()) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "Zoom OAuth credentials are not configured. Set ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET.",
    };
  }
  const redirectUri =
    (getQuery(event).redirect_uri as string) ||
    `${getOrigin(event)}/_agent-native/zoom/callback`;
  const session = await getSession(event);
  const owner =
    session?.email && session.email !== DEV_MODE_USER_EMAIL
      ? session.email
      : undefined;
  const desktop = isElectron(event);
  const state = encodeOAuthState(redirectUri, owner, desktop, false, "zoom");
  const url = getZoomAuthUrl(redirectUri, state);
  return { url };
});
