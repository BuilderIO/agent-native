import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  getHeader,
  type H3Event,
} from "h3";
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

// Track the redirect URI used for auth so the callback can match it
let lastRedirectUri: string | undefined;

export const getGoogleAuthUrl = defineEventHandler((event: H3Event) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    setResponseStatus(event, 422);
    return {
      error: "missing_credentials",
      message:
        "Google OAuth credentials are not configured. Add your Client ID and Secret in Settings.",
    };
  }
  try {
    const redirectUri =
      (getQuery(event).redirect_uri as string) ||
      `${getOrigin(event)}/api/google/callback`;
    lastRedirectUri = redirectUri;
    const url = getAuthUrl(undefined, redirectUri);
    return { url };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const handleGoogleCallback = defineEventHandler(
  async (event: H3Event) => {
    try {
      const code = getQuery(event).code as string;
      if (!code) {
        setResponseStatus(event, 400);
        return { error: "Missing authorization code" };
      }
      // Use the same redirect URI that was used to generate the auth URL
      const redirectUri =
        lastRedirectUri || `${getOrigin(event)}/api/google/callback`;
      const email = await exchangeCode(code, undefined, redirectUri);
      const safeEmail = JSON.stringify(email);
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
        : `Connection failed: ${msg}`;
      return `<!DOCTYPE html><html><body>
      <div style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
        <p style="font-size:15px;color:#e55">${userMessage}</p>
        <p style="margin-top:16px;font-size:13px;color:#888">You can close this tab and try again.</p>
      </div>
    </body></html>`;
    }
  },
);

export const getGoogleStatus = defineEventHandler(async (event: H3Event) => {
  try {
    const status = await getAuthStatus();
    return status;
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const disconnectGoogle = defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event);
    const email = body?.email as string | undefined;
    await disconnect(email);
    return { success: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
