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
} from "../lib/google-calendar.js";

function getOrigin(event: H3Event): string {
  const host = getHeader(event, "x-forwarded-host") || getHeader(event, "host");
  const proto = getHeader(event, "x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

/** Detect requests from the Electron desktop app webview. */
function isElectron(event: H3Event): boolean {
  return /Electron/i.test(getHeader(event, "user-agent") || "");
}

function errorPage(message: string): string {
  return `<!DOCTYPE html><html><body>
    <div style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
      <p style="font-size:15px;color:#e55">${message}</p>
      <p style="margin-top:16px;font-size:13px;color:#888"><a href="/" style="color:#888">Back to login</a></p>
    </div>
  </body></html>`;
}

/** HTML page shown after OAuth completes in the system browser (desktop app flow). */
function desktopSuccessPage(email?: string): Response {
  const msg = email ? `Connected ${email}!` : "Connected!";
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px"><p style="font-size:16px">${msg}</p><p style="font-size:13px;color:#888">You can close this tab and return to Agent Native.</p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** Encode a redirect URI (and optional owner) into the OAuth state param so the callback can recover them across proxies and cookie-less flows (e.g. desktop app system browser). */
function encodeState(
  redirectUri: string,
  owner?: string,
  desktop?: boolean,
): string {
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload: Record<string, string | boolean> = {
    n: nonce,
    r: redirectUri,
  };
  if (owner) payload.o = owner;
  if (desktop) payload.d = true;
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** Recover the redirect URI and optional owner from the state param. */
function decodeState(
  stateParam: string | undefined,
  fallbackUri: string,
): { redirectUri: string; owner?: string; desktop?: boolean } {
  if (stateParam) {
    try {
      const parsed = JSON.parse(
        Buffer.from(stateParam, "base64url").toString(),
      );
      return {
        redirectUri: parsed.r || fallbackUri,
        owner: parsed.o || undefined,
        desktop: !!parsed.d,
      };
    } catch {}
  }
  return { redirectUri: fallbackUri };
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
    const query = getQuery(event);
    const redirectUri =
      (query.redirect_uri as string) ||
      `${getOrigin(event)}/api/google/callback`;
    const session = await getSession(event);
    const owner =
      session?.email && session.email !== "local@localhost"
        ? session.email
        : undefined;
    const state = encodeState(redirectUri, owner, isElectron(event));
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
      const stateParam = query.state as string | undefined;
      if (!code) {
        setResponseStatus(event, 400);
        return { error: "Missing authorization code" };
      }

      const {
        redirectUri,
        owner: stateOwner,
        desktop,
      } = decodeState(stateParam, `${getOrigin(event)}/api/google/callback`);
      const existingSession = await getSession(event);
      const isDevSession = existingSession?.email === "local@localhost";
      const hasProductionSession = existingSession?.email && !isDevSession;
      const owner = isDevSession
        ? "local@localhost"
        : hasProductionSession
          ? existingSession.email
          : stateOwner || undefined;
      const email = await exchangeCode(code, undefined, redirectUri, owner);

      // Create a session tied to this Google email
      const sessionToken = crypto.randomBytes(32).toString("hex");
      await addSession(sessionToken, email);
      setCookie(event, "an_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });

      // If this looks like a mobile request, redirect via the native app scheme.
      // Pass the session token in the deep link so the app can inject it as a
      // cookie into its WebView (Safari and WKWebView have separate cookie jars).
      const ua = getHeader(event, "user-agent") || "";
      const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
      if (isMobile) {
        const deepLink = `agentnative://oauth-complete?token=${sessionToken}`;
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connected</title></head><body style="background:#111;color:#aaa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Connected! Returning to app…</p><script>window.location.href=${JSON.stringify(deepLink)};setTimeout(function(){window.location.href="/"},1500)</script></body></html>`,
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }

      if (desktop) return desktopSuccessPage(email);
      return sendRedirect(event, "/");
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      const isPermission =
        msg.includes("Insufficient Permission") ||
        msg.includes("insufficient_scope");
      const userMessage = isPermission
        ? "This account wasn't granted the required permissions. Make sure you check all the permission boxes on the consent screen."
        : `Connection failed: ${msg}`;
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
      const query = getQuery(event);
      const redirectUri =
        (query.redirect_uri as string) ||
        `${getOrigin(event)}/api/google/add-account/callback`;
      const state = encodeState(redirectUri, session.email, isElectron(event));
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

      const ownerEmail = session?.email || stateOwner;
      if (!ownerEmail) {
        return errorPage("Session expired. Please log in again.");
      }

      const code = query.code as string;
      if (!code) {
        setResponseStatus(event, 400);
        return errorPage("Missing authorization code.");
      }

      const addedEmail = await exchangeCode(
        code,
        undefined,
        redirectUri,
        ownerEmail,
      );

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
        ? "This account wasn't granted the required permissions. Make sure you check all the permission boxes on the consent screen."
        : `Failed to add account: ${msg}`;
      return errorPage(userMessage);
    }
  },
);

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
