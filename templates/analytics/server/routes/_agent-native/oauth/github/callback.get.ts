import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import {
  decodeOAuthState,
  getOrigin,
  getSession,
  oauthErrorPage,
  resolveOAuthOwner,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import {
  exchangeGitHubOAuthCode,
  fetchGitHubViewer,
  saveGitHubOAuthToken,
} from "../../../../lib/github-oauth.js";

function githubConnectedPage(login: string): string {
  const safeLogin = JSON.stringify(login);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>GitHub Connected</title>
  </head>
  <body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px">
    <p id="message" style="font-size:16px"></p>
    <p style="font-size:13px;color:#888">Returning you to Analytics...</p>
    <script>
      var login = ${safeLogin};
      document.getElementById("message").textContent = "Connected GitHub" + (login ? " as " + login : "") + "!";
      var payload = { type: "agent-native:github-connected" };
      try {
        if (window.opener) window.opener.postMessage(payload, window.location.origin);
      } catch (_) {}
      try {
        new BroadcastChannel("agent-native-github-oauth").postMessage(payload);
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
    const githubError = query.error as string | undefined;
    if (githubError) {
      const description =
        (query.error_description as string | undefined) || githubError;
      return oauthErrorPage(`GitHub connection failed: ${description}`);
    }

    const code = query.code as string | undefined;
    if (!code) {
      setResponseStatus(event, 400);
      return oauthErrorPage("Missing authorization code.");
    }

    const state = decodeOAuthState(
      query.state as string | undefined,
      `${getOrigin(event)}/_agent-native/oauth/github/callback`,
    );
    const { owner } = await resolveOAuthOwner(event, state.owner);
    const session = await getSession(event);
    const ownerEmail = owner ?? session?.email;
    if (!ownerEmail) {
      setResponseStatus(event, 401);
      return oauthErrorPage("Session expired. Please sign in and retry.");
    }

    const { accessToken, scopes } = await exchangeGitHubOAuthCode(
      code,
      state.redirectUri,
    );
    const viewer = await fetchGitHubViewer(accessToken);
    const org = await getOrgContext(event).catch(() => null);
    await saveGitHubOAuthToken(
      accessToken,
      {
        userEmail: ownerEmail,
        orgId: org?.orgId ?? session?.orgId ?? null,
      },
      viewer,
      scopes,
    );

    setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
    return githubConnectedPage(viewer?.login ?? "");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return oauthErrorPage(message);
  }
});
