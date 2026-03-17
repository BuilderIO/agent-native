import type { Request, Response } from "express";
import {
  getAuthUrl,
  exchangeCode,
  getAuthStatus,
  disconnect,
} from "../lib/google-auth.js";

function getOrigin(req: Request): string {
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${req.protocol}://${host}`;
}

// Track the redirect URI used for auth so the callback can match it
let lastRedirectUri: string | undefined;

export function getGoogleAuthUrl(req: Request, res: Response): void {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(422).json({
      error: "missing_credentials",
      message:
        "Google OAuth credentials are not configured. Add your Client ID and Secret in Settings.",
    });
    return;
  }
  try {
    const redirectUri =
      (req.query.redirect_uri as string) ||
      `${getOrigin(req)}/api/google/callback`;
    lastRedirectUri = redirectUri;
    const url = getAuthUrl(undefined, redirectUri);
    res.json({ url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function handleGoogleCallback(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const code = req.query.code as string;
    if (!code) {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }
    // Use the same redirect URI that was used to generate the auth URL
    const redirectUri =
      lastRedirectUri || `${getOrigin(req)}/api/google/callback`;
    const email = await exchangeCode(code, undefined, redirectUri);
    const safeEmail = JSON.stringify(email);
    res.send(`<!DOCTYPE html><html><body><script>
      window.close();
      var p = document.createElement('p');
      p.style.cssText = 'font-family:system-ui;text-align:center;margin-top:40vh';
      p.textContent = 'Connected ' + ${safeEmail} + '! You can close this tab.';
      document.body.appendChild(p);
    </script></body></html>`);
  } catch (error: any) {
    const msg = error.message || "Unknown error";
    const isPermission =
      msg.includes("Insufficient Permission") ||
      msg.includes("insufficient_scope");
    const userMessage = isPermission
      ? "This account wasn't granted the required permissions. Make sure you check all the permission boxes on the consent screen. If the app is in testing mode, add this email as a test user in Google Cloud Console."
      : `Connection failed: ${msg}`;
    res.send(`<!DOCTYPE html><html><body>
      <div style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
        <p style="font-size:15px;color:#e55">${userMessage}</p>
        <p style="margin-top:16px;font-size:13px;color:#888">You can close this tab and try again.</p>
      </div>
    </body></html>`);
  }
}

export async function getGoogleStatus(
  _req: Request,
  res: Response,
): Promise<void> {
  try {
    const status = await getAuthStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export function disconnectGoogle(req: Request, res: Response): void {
  try {
    const email = req.body?.email as string | undefined;
    disconnect(email);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
