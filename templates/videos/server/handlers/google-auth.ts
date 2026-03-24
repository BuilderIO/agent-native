import crypto from "node:crypto";
import {
  defineEventHandler,
  getQuery,
  getHeader,
  setResponseStatus,
  setCookie,
  sendRedirect,
  type H3Event,
} from "h3";
import { addSession } from "@agent-native/core/server";

function getOrigin(event: H3Event): string {
  const host = getHeader(event, "x-forwarded-host") || getHeader(event, "host");
  const proto = getHeader(event, "x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

function encodeState(redirectUri: string): string {
  const nonce = crypto.randomBytes(8).toString("hex");
  return Buffer.from(JSON.stringify({ n: nonce, r: redirectUri })).toString(
    "base64url",
  );
}

function decodeRedirectUri(
  stateParam: string | undefined,
  fallback: string,
): string {
  if (stateParam) {
    try {
      const parsed = JSON.parse(
        Buffer.from(stateParam, "base64url").toString(),
      );
      if (parsed.r) return parsed.r;
    } catch {}
  }
  return fallback;
}

const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

export const getGoogleAuthUrl = defineEventHandler((event: H3Event) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }
  const redirectUri =
    (getQuery(event).redirect_uri as string) ||
    `${getOrigin(event)}/api/google/callback`;
  const state = encodeState(redirectUri);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "online",
    prompt: "select_account",
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
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

      const redirectUri = decodeRedirectUri(
        stateParam,
        `${getOrigin(event)}/api/google/callback`,
      );

      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokenRes.ok) {
        throw new Error(
          tokens.error_description || tokens.error || "Token exchange failed",
        );
      }

      // Get user info
      const userRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      const user = await userRes.json();
      const email = user.email as string;
      if (!email) throw new Error("Could not get email from Google");

      // Create session
      const sessionToken = crypto.randomBytes(32).toString("hex");
      await addSession(sessionToken, email);
      setCookie(event, "an_session", sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });

      return sendRedirect(event, "/");
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      return `<!DOCTYPE html><html><body>
        <div style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
          <p style="font-size:15px;color:#e55">${msg}</p>
          <p style="margin-top:16px;font-size:13px;color:#888"><a href="/" style="color:#888">Back to login</a></p>
        </div>
      </body></html>`;
    }
  },
);
