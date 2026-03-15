import type { Request, Response } from "express";
import {
  getAuthUrl,
  exchangeCode,
  getAuthStatus,
  disconnect,
} from "../lib/google-auth.js";

function getOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

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
    const url = getAuthUrl(getOrigin(req));
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
    await exchangeCode(code, getOrigin(req));
    // Send a page that closes itself — the app polls for connection status
    res.send(`<!DOCTYPE html><html><body><script>
      window.close();
      // If window.close() is blocked, show a message
      document.body.innerHTML = '<p style="font-family:system-ui;text-align:center;margin-top:40vh">Connected! You can close this tab.</p>';
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

export function disconnectGoogle(_req: Request, res: Response): void {
  try {
    disconnect();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
