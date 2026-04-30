/**
 * Zoom OAuth callback.
 *
 * Zoom redirects the browser here with `?code=...&state=...` after the
 * user grants consent. We exchange the code for tokens via the scheduling
 * package's `completeVideoOAuth`, which:
 *   1. Creates a `scheduling_credentials` row for the user
 *   2. Writes access/refresh tokens into core's `oauth_tokens` (keyed on
 *      `credentialId`) via the provider's `updateTokens` callback wired in
 *      `server/plugins/scheduling.ts`
 *   3. Fills in the credential row's `external_email` + `display_name`
 *
 * Framework convention: this path is `/_agent-native/oauth/zoom/callback`.
 */
import {
  defineEventHandler,
  getQuery,
  type H3Event,
  setResponseStatus,
} from "h3";
import { getOrigin, getSession } from "@agent-native/core/server";
import { completeVideoOAuth } from "@agent-native/scheduling/server";

export default defineEventHandler(async (event: H3Event) => {
  try {
    const query = getQuery(event);
    const code = query.code as string | undefined;
    if (!code) {
      setResponseStatus(event, 400);
      return errorPage("Missing authorization code");
    }

    const session = await getSession(event);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return errorPage("Unauthenticated — please sign in and retry.");
    }
    const userEmail = session.email;
    const redirectUri = `${getOrigin(event)}/_agent-native/oauth/zoom/callback`;

    await completeVideoOAuth({
      kind: "zoom_video",
      userEmail,
      code,
      redirectUri,
    });

    // Redirect back to the Integrations page so the user sees the new
    // "Installed" chip.
    setResponseStatus(event, 302);
    event.node.res.setHeader("Location", "/apps");
    return "";
  } catch (err: any) {
    return errorPage(`Zoom connection failed: ${err.message ?? err}`);
  }
});

function errorPage(message: string): Response {
  return new Response(
    `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
      <p style="font-size:15px;color:#e55">${escapeHtml(message)}</p>
      <p style="margin-top:16px;font-size:13px;color:#888"><a href="/apps" style="color:#888">Back to integrations</a></p>
    </body></html>`,
    { status: 400, headers: { "content-type": "text/html" } },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
