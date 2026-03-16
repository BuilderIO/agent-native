import type { Request, Response } from "express";
import {
  getAuthUrl,
  exchangeCode,
  getAuthStatus,
  disconnect,
} from "../lib/google-calendar.js";

function getOrigin(req: Request): string {
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${req.protocol}://${host}`;
}

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
    res.status(500).json({ error: error.message });
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
