import crypto from "node:crypto";
import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  getHeader,
  setCookie,
  sendRedirect,
  type H3Event,
} from "h3";
import { addSession, getSession } from "@agent-native/core/server";
import {
  getAuthUrl,
  exchangeCode,
  getAuthStatus,
  disconnect,
} from "../lib/google-auth.js";

function getOrigin(event: H3Event): string {
  const host = getHeader(event, "x-forwarded-host") || getHeader(event, "host");
  const proto = getHeader(event, "x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

/** Detect requests from the Electron desktop app webview. */
function isElectron(event: H3Event): boolean {
  return /Electron/i.test(getHeader(event, "user-agent") || "");
}

/** Encode a redirect URI (and optional owner) into the OAuth state param so the callback can recover them across proxies and cookie-less flows (e.g. desktop app system browser). */
function encodeState(
  redirectUri: string,
  owner?: string,
  desktop?: boolean,
  addAccount?: boolean,
): string {
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload: Record<string, string | boolean> = {
    n: nonce,
    r: redirectUri,
  };
  if (owner) payload.o = owner;
  if (desktop) payload.d = true;
  if (addAccount) payload.a = true;
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** Recover the redirect URI, optional owner, and desktop flag from the state param. */
function decodeState(
  stateParam: string | undefined,
  fallbackUri: string,
): {
  redirectUri: string;
  owner?: string;
  desktop?: boolean;
  addAccount?: boolean;
} {
  if (stateParam) {
    try {
      const parsed = JSON.parse(
        Buffer.from(stateParam, "base64url").toString(),
      );
      return {
        redirectUri: parsed.r || fallbackUri,
        owner: parsed.o || undefined,
        desktop: !!parsed.d,
        addAccount: !!parsed.a,
      };
    } catch {}
  }
  return { redirectUri: fallbackUri };
}

/** HTML page shown after OAuth completes in the system browser (desktop app flow).
 *  When a session token is provided, redirects via the `agentnative://` deep link
 *  so the Electron app can inject the session cookie into its webview. */
function desktopSuccessPage(email?: string, sessionToken?: string): Response {
  const msg = email ? `Connected ${email}!` : "Connected!";
  // When we have a session token, redirect to the desktop app via deep link
  // (same mechanism mobile uses) so Electron can set the cookie in its webview.
  if (sessionToken) {
    const deepLink = `agentnative://oauth-complete?token=${sessionToken}`;
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px"><p style="font-size:16px">${msg}</p><a href=${JSON.stringify(deepLink)} style="display:inline-block;margin-top:8px;padding:10px 24px;background:#fff;color:#000;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Open Agent Native</a><p style="font-size:12px;color:#666;margin-top:4px">If the app didn\u2019t open automatically, click the button above.</p><script>window.location.href=${JSON.stringify(deepLink)}</script></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px"><p style="font-size:16px">${msg}</p><p style="font-size:13px;color:#888">You can close this tab and return to Agent Native.</p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const getGoogleAuthUrl = defineEventHandler(async (event: H3Event) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }
  try {
    const redirectUri =
      (getQuery(event).redirect_uri as string) ||
      `${getOrigin(event)}/api/google/callback`;
    // Pass current session owner through state so the callback can
    // associate the new account with the correct user even when the
    // callback runs in a different context (system browser, no cookies).
    const session = await getSession(event);
    const owner =
      session?.email && session.email !== "local@localhost"
        ? session.email
        : undefined;
    const state = encodeState(redirectUri, owner);
    const url = getAuthUrl(undefined, redirectUri, state);
    return { url };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
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

      const stateParam = query.state as string | undefined;
      const {
        redirectUri,
        owner: stateOwner,
        desktop,
        addAccount,
      } = decodeState(stateParam, `${getOrigin(event)}/api/google/callback`);

      // Determine the owner for this OAuth account:
      // - Dev mode ("local@localhost"): always use "local@localhost" so all
      //   accounts are grouped under the dev session.
      // - Production with existing session: use the existing session email as
      //   owner so this account is added alongside existing accounts.
      // - State owner (desktop/mobile flows): the session cookie isn't
      //   available in the system browser, so the owner is passed through
      //   the OAuth state parameter instead.
      // - Production without session (first login): owner defaults to the
      //   Google email itself (becomes both owner and session identity).
      const existingSession = await getSession(event);
      const isDevSession = existingSession?.email === "local@localhost";
      const hasProductionSession = existingSession?.email && !isDevSession;
      const owner = isDevSession
        ? "local@localhost"
        : hasProductionSession
          ? existingSession.email
          : stateOwner || undefined;
      const email = await exchangeCode(code, undefined, redirectUri, owner);

      // Only create a new session when there isn't one already AND this
      // is not an add-account flow.  When adding a secondary account the
      // user already has a session — the state owner carries their
      // identity through cookie-less contexts (e.g. system browser).
      // Creating a session here would switch the user's identity to the
      // new Google email, losing their settings/filters.
      let sessionToken: string | undefined;
      if (!hasProductionSession && !addAccount) {
        sessionToken = crypto.randomBytes(32).toString("hex");
        await addSession(sessionToken, email);
        setCookie(event, "an_session", sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 30, // 30 days
        });
      }

      // If this looks like a mobile request, redirect via the native app scheme
      // so Safari bounces back to the app instead of staying on the web page.
      // Pass the session token in the deep link so the app can inject it as a
      // cookie into its WebView (Safari and WKWebView have separate cookie jars).
      const ua = getHeader(event, "user-agent") || "";
      const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
      if (isMobile) {
        const deepLink = sessionToken
          ? `agentnative://oauth-complete?token=${sessionToken}`
          : `agentnative://oauth-complete`;
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connected</title></head><body style="background:#111;color:#aaa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Connected! Returning to app…</p><script>window.location.href=${JSON.stringify(deepLink)};setTimeout(function(){window.location.href="/"},1500)</script></body></html>`,
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }

      // Desktop: redirect via deep link so Electron can inject the session cookie
      if (desktop) return desktopSuccessPage(email, sessionToken);

      // Add-account web flow: show close-tab page (main tab polls for status)
      if (addAccount) {
        const safeEmail = JSON.stringify(email);
        return `<!DOCTYPE html><html><body><script>
          window.close();
          var p = document.createElement('p');
          p.style.cssText = 'font-family:system-ui;text-align:center;margin-top:40vh';
          p.textContent = 'Connected ' + ${safeEmail} + '! You can close this tab.';
          document.body.appendChild(p);
        </script></body></html>`;
      }

      // Web: redirect to app home
      return sendRedirect(event, "/");
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      const isPermission =
        msg.includes("Insufficient Permission") ||
        msg.includes("insufficient_scope");
      const userMessage = isPermission
        ? "This account wasn't granted the required permissions. Make sure you check all the permission boxes on the consent screen. If the app is in testing mode, add this email as a test user in Google Cloud Console."
        : `Connection failed: ${msg}`;
      return errorPage(userMessage);
    }
  },
);

function errorPage(message: string): string {
  return `<!DOCTYPE html><html><body>
    <div style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
      <p style="font-size:15px;color:#e55">${message}</p>
      <p style="margin-top:16px;font-size:13px;color:#888"><a href="/" style="color:#888">Back to login</a></p>
    </div>
  </body></html>`;
}

export const getGoogleAddAccountUrl = defineEventHandler(
  async (event: H3Event) => {
    const session = await getSession(event);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Must be logged in to add an account" };
    }
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      setResponseStatus(event, 422);
      return {
        error: "missing_credentials",
        message:
          "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      };
    }
    try {
      // Use the MAIN callback URL so only one redirect URI needs to be
      // registered in Google Cloud Console.  The `addAccount` flag in the
      // state tells the callback not to create a new session.
      const redirectUri =
        (getQuery(event).redirect_uri as string) ||
        `${getOrigin(event)}/api/google/callback`;
      const state = encodeState(redirectUri, session.email);
      const url = getAuthUrl(undefined, redirectUri, state);
      return { url };
    } catch (error: any) {
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  },
);

export const handleGoogleAddAccountCallback = defineEventHandler(
  async (event: H3Event) => {
    try {
      const session = await getSession(event);
      const query = getQuery(event);
      const stateParam = query.state as string | undefined;
      const {
        redirectUri,
        owner: stateOwner,
        desktop,
      } = decodeState(
        stateParam,
        `${getOrigin(event)}/api/google/add-account/callback`,
      );

      // Use session cookie if available, otherwise fall back to the owner
      // encoded in the OAuth state (for cookie-less flows like desktop app
      // opening the system browser for OAuth).
      const ownerEmail = session?.email || stateOwner;
      if (!ownerEmail) {
        return errorPage("Session expired. Please log in again.");
      }

      const code = query.code as string;
      if (!code) {
        setResponseStatus(event, 400);
        return errorPage("Missing authorization code.");
      }

      // Exchange code, passing the logged-in user as the owner
      const addedEmail = await exchangeCode(
        code,
        undefined,
        redirectUri,
        ownerEmail,
      );

      // Do NOT create a new session — user stays logged in
      if (desktop) return desktopSuccessPage(addedEmail);

      // Return a close-tab page (UI opens this in a new tab and polls for status)
      const safeEmail = JSON.stringify(addedEmail);
      return `<!DOCTYPE html><html><body><script>
        window.close();
        var p = document.createElement('p');
        p.style.cssText = 'font-family:system-ui;text-align:center;margin-top:40vh';
        p.textContent = 'Connected ' + ${safeEmail} + '! You can close this tab.';
        document.body.appendChild(p);
      </script></body></html>`;
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      const isPermission =
        msg.includes("Insufficient Permission") ||
        msg.includes("insufficient_scope");
      const userMessage = isPermission
        ? "This account wasn't granted the required permissions. Make sure you check all the permission boxes on the consent screen. If the app is in testing mode, add this email as a test user in Google Cloud Console."
        : `Failed to add account: ${msg}`;
      return errorPage(userMessage);
    }
  },
);

export const getGoogleStatus = defineEventHandler(async (event: H3Event) => {
  try {
    const session = await getSession(event);
    const status = await getAuthStatus(session?.email);
    return status;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const disconnectGoogle = defineEventHandler(async (event: H3Event) => {
  try {
    const session = await getSession(event);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Not authenticated" };
    }
    const body = await readBody(event);
    const targetEmail = body?.email as string | undefined;
    if (!targetEmail) {
      setResponseStatus(event, 400);
      return { error: "email is required" };
    }
    // Verify the target account is owned by the logged-in user
    const owned = await getAuthStatus(session.email);
    const isOwned = owned.accounts.some((a) => a.email === targetEmail);
    if (!isOwned) {
      setResponseStatus(event, 403);
      return { error: "Cannot disconnect an account you don't own" };
    }
    await disconnect(targetEmail);
    return { success: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
