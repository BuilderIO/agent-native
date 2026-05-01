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
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  getSession,
  getOrigin,
  decodeOAuthState,
  resolveOAuthOwner,
  oauthErrorPage,
} from "@agent-native/core/server";
import { exchangeZoomCode } from "../../../lib/zoom.js";

function zoomConnectedPage(email: string): string {
  const safeEmail = JSON.stringify(email);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Zoom Connected</title>
  </head>
  <body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px">
    <p id="message" style="font-size:16px"></p>
    <p style="font-size:13px;color:#888">Returning you to Calendar...</p>
    <script>
      var email = ${safeEmail};
      document.getElementById("message").textContent = "Connected " + email + "!";
      var payload = { type: "agent-native:zoom-connected" };
      try {
        if (window.opener) window.opener.postMessage(payload, window.location.origin);
      } catch (_) {}
      try {
        new BroadcastChannel("agent-native-zoom-oauth").postMessage(payload);
      } catch (_) {}
      setTimeout(function () {
        window.close();
      }, 350);
    </script>
  </body>
</html>`;
}

export default defineEventHandler(async (event: H3Event) => {
  try {
    const query = getQuery(event);
    const code = query.code as string | undefined;
    if (!code) {
      setResponseStatus(event, 400);
      return oauthErrorPage("Missing authorization code");
    }

    const { redirectUri, owner: stateOwner } = decodeOAuthState(
      query.state as string | undefined,
      `${getOrigin(event)}/_agent-native/zoom/callback`,
    );

    const { owner } = await resolveOAuthOwner(event, stateOwner);
    const session = await getSession(event);
    const ownerEmail = owner ?? session?.email;
    if (!ownerEmail) {
      setResponseStatus(event, 401);
      return oauthErrorPage("Unauthenticated — please sign in and retry.");
    }

    const { email } = await exchangeZoomCode(code, redirectUri, ownerEmail);

    setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
    return zoomConnectedPage(email ?? ownerEmail);
  } catch (err: any) {
    return oauthErrorPage(
      `Zoom connection failed: ${err?.message ?? "Unknown error"}`,
    );
  }
});
