import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  getHeader,
  sendRedirect,
  type H3Event,
} from "h3";
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
    const query = getQuery(event);
    const redirectUri =
      (query.redirect_uri as string) ||
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
      const query = getQuery(event);
      const code = query.code as string;
      if (!code) {
        setResponseStatus(event, 400);
        return { error: "Missing authorization code" };
      }
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
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  },
);

export const getGoogleStatus = defineEventHandler(async (_event: H3Event) => {
  try {
    const status = await getAuthStatus();
    return status;
  } catch (error: any) {
    setResponseStatus(_event, 500);
    return { error: error.message };
  }
});

export const disconnectGoogle = defineEventHandler(async (event: H3Event) => {
  try {
    const body = await readBody(event);
    const email = body?.email as string | undefined;
    disconnect(email);
    return { success: true };
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
