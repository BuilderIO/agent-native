import crypto from "node:crypto";
import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  getHeader,
  setCookie,
  getCookie,
  deleteCookie,
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
    // Generate a state token for CSRF protection and store redirect URI
    // in a short-lived httpOnly cookie (serverless-safe, no in-memory Map)
    const state = crypto.randomBytes(16).toString("hex");
    setCookie(event, `oauth_state_${state}`, redirectUri, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/google/callback",
      maxAge: 600, // 10 minutes
    });
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

      // Enforce state parameter for CSRF protection
      if (!state) {
        setResponseStatus(event, 400);
        return errorPage(
          "Missing OAuth state parameter. Please try signing in again.",
        );
      }
      const cookieName = `oauth_state_${state}`;
      const redirectUri = getCookie(event, cookieName);
      if (!redirectUri) {
        setResponseStatus(event, 400);
        return errorPage(
          "Invalid or expired OAuth state. Please try signing in again.",
        );
      }
      // Clean up the state cookie
      deleteCookie(event, cookieName, { path: "/api/google/callback" });

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
