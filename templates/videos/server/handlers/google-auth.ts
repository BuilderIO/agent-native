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

/** Detect requests from the Electron desktop app webview. */
function isElectron(event: H3Event): boolean {
  return /Electron/i.test(getHeader(event, "user-agent") || "");
}

function encodeState(redirectUri: string, desktop?: boolean): string {
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload: Record<string, string | boolean> = {
    n: nonce,
    r: redirectUri,
  };
  if (desktop) payload.d = true;
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeState(
  stateParam: string | undefined,
  fallback: string,
): { redirectUri: string; desktop?: boolean } {
  if (stateParam) {
    try {
      const parsed = JSON.parse(
        Buffer.from(stateParam, "base64url").toString(),
      );
      return {
        redirectUri: parsed.r || fallback,
        desktop: !!parsed.d,
      };
    } catch {}
  }
  return { redirectUri: fallback };
}

/** HTML page shown after OAuth completes in the system browser (desktop app flow).
 *  When a session token is provided, redirects via the `agentnative://` deep link
 *  so the Electron app can inject the session cookie into its webview. */
function desktopSuccessPage(email?: string, sessionToken?: string): Response {
  const msg = email ? `Connected ${email}!` : "Connected!";
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

      const { redirectUri, desktop } = decodeState(
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

      if (desktop) return desktopSuccessPage(email, sessionToken);
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
