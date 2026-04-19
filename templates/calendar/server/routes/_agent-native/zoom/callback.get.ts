/**
 * Zoom OAuth callback.
 *
 * Zoom redirects the browser here with `?code=...&state=...` after the
 * user grants consent. We exchange the code for tokens and persist them
 * in core's `oauth_tokens` (provider="zoom_video", account_id=zoom user
 * id, owner=session email).
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
  decodeOAuthState,
  resolveOAuthOwner,
  oauthErrorPage,
  oauthCallbackResponse,
} from "@agent-native/core/server";
import { exchangeZoomCode } from "../../../lib/zoom.js";

export default defineEventHandler(async (event: H3Event) => {
  try {
    const query = getQuery(event);
    const code = query.code as string | undefined;
    if (!code) {
      setResponseStatus(event, 400);
      return oauthErrorPage("Missing authorization code");
    }

    const {
      redirectUri,
      owner: stateOwner,
      desktop,
    } = decodeOAuthState(
      query.state as string | undefined,
      `${getOrigin(event)}/_agent-native/zoom/callback`,
    );

    const { owner } = await resolveOAuthOwner(event, stateOwner);
    const session = await getSession(event);
    const ownerEmail = owner ?? session?.email ?? "local@localhost";

    const { email } = await exchangeZoomCode(code, redirectUri, ownerEmail);

    return oauthCallbackResponse(event, email ?? ownerEmail, {
      desktop,
      addAccount: true,
    });
  } catch (err: any) {
    return oauthErrorPage(
      `Zoom connection failed: ${err?.message ?? "Unknown error"}`,
    );
  }
});
