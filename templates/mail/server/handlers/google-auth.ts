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

// Track redirect URIs by OAuth state parameter for multi-user safety
const pendingRedirects = new Map<string, string>();

export const getGoogleAuthUrl = defineEventHandler((event: H3Event) => {
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
    // Generate a state token to track the redirect URI
    const state = crypto.randomBytes(16).toString("hex");
    pendingRedirects.set(state, redirectUri);
    // Clean up old entries (keep last 100)
    if (pendingRedirects.size > 100) {
      const first = pendingRedirects.keys().next().value;
      if (first) pendingRedirects.delete(first);
    }
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
      const state = query.state as string | undefined;
      if (!code) {
        setResponseStatus(event, 400);
        return { error: "Missing authorization code" };
      }
      // Look up the redirect URI from the state parameter
      let redirectUri: string;
      if (state && pendingRedirects.has(state)) {
        redirectUri = pendingRedirects.get(state)!;
        pendingRedirects.delete(state);
      } else {
        redirectUri = `${getOrigin(event)}/api/google/callback`;
      }
      const email = await exchangeCode(code, undefined, redirectUri);

      // Create a session tied to this Google email
      const sessionToken = crypto.randomBytes(32).toString("hex");
      await addSession(sessionToken, email);
      setCookie(event, "an_session", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });

      // Redirect to app home
      return sendRedirect(event, "/");
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      const isPermission =
        msg.includes("Insufficient Permission") ||
        msg.includes("insufficient_scope");
      const userMessage = isPermission
        ? "This account wasn't granted the required permissions. Make sure you check all the permission boxes on the consent screen. If the app is in testing mode, add this email as a test user in Google Cloud Console."
        : `Connection failed: ${msg}`;
      return `<!DOCTYPE html><html><body>
      <div style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
        <p style="font-size:15px;color:#e55">${userMessage}</p>
        <p style="margin-top:16px;font-size:13px;color:#888"><a href="/" style="color:#888">Back to login</a></p>
      </div>
    </body></html>`;
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
    const body = await readBody(event);
    // Only allow disconnecting the logged-in user's own account
    const email = body?.email as string | undefined;
    if (email && session?.email && email !== session.email) {
      setResponseStatus(event, 403);
      return { error: "Cannot disconnect another user's account" };
    }
    await disconnect(email || session?.email);
    return { success: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
