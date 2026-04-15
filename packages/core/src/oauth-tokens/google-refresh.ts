/**
 * Proactive Google OAuth token refresh.
 *
 * Templates already refresh tokens reactively in their `getValidAccessToken`
 * helpers — but that only runs when an action makes an API call. If the user
 * is idle for an hour, the next call pays the refresh latency, and any error
 * surfaces as a user-facing failure.
 *
 * This module scans the `oauth_tokens` table on a timer and refreshes any
 * token that's within `expiryBufferMs` of expiring. Templates opt in via a
 * server plugin (see `templates/mail/server/plugins/oauth-refresh.ts`).
 */

import { listOAuthAccounts, saveOAuthTokens } from "./store.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleTokens {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

interface RefreshResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

async function refreshOne(refreshToken: string): Promise<RefreshResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/SECRET not set");
  }
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = (data.error_description ||
      data.error ||
      res.statusText) as string;
    throw new Error(err);
  }
  return data as unknown as RefreshResponse;
}

/**
 * Scan all stored Google tokens and refresh any expiring within `bufferMs`.
 * Errors per-account are logged and swallowed so one bad token doesn't block
 * the rest.
 */
export async function refreshExpiringGoogleTokens(
  opts: {
    bufferMs?: number;
  } = {},
): Promise<void> {
  const bufferMs = opts.bufferMs ?? 15 * 60 * 1000;
  let accounts: Awaited<ReturnType<typeof listOAuthAccounts>>;
  try {
    accounts = await listOAuthAccounts("google");
  } catch (err) {
    console.error("[google-refresh] failed to list accounts:", err);
    return;
  }
  const now = Date.now();
  for (const acct of accounts) {
    const tokens = acct.tokens as GoogleTokens;
    if (!tokens?.refresh_token) continue;
    if (tokens.expiry_date && tokens.expiry_date > now + bufferMs) continue;
    try {
      const refreshed = await refreshOne(tokens.refresh_token);
      const merged: GoogleTokens = {
        ...tokens,
        access_token: refreshed.access_token,
        expiry_date: now + refreshed.expires_in * 1000,
        token_type: refreshed.token_type,
        scope: refreshed.scope ?? tokens.scope,
      };
      await saveOAuthTokens(
        "google",
        acct.accountId,
        merged as unknown as Record<string, unknown>,
      );
    } catch (err) {
      // Common case: invalid_grant when the user revoked access or changed
      // their Google password. Leave the row in place so the UI shows the
      // account and the user can re-OAuth — don't auto-delete.
      console.warn(
        `[google-refresh] refresh failed for ${acct.accountId}:`,
        (err as Error).message,
      );
    }
  }
}

let _started = false;
let _timer: ReturnType<typeof setInterval> | undefined;

/**
 * Start the refresh loop. Idempotent — calling more than once is a no-op,
 * so multiple plugins/templates loading this in the same process are safe.
 */
export function startGoogleTokenRefreshLoop(
  opts: {
    /** How often to scan. Default: 20 minutes. */
    intervalMs?: number;
    /** Refresh tokens expiring within this window. Default: 15 minutes. */
    bufferMs?: number;
  } = {},
): void {
  if (_started) return;
  _started = true;
  const intervalMs = opts.intervalMs ?? 20 * 60 * 1000;
  const bufferMs = opts.bufferMs ?? 15 * 60 * 1000;

  // Kick off an initial pass shortly after startup (not immediately — the DB
  // may still be initializing).
  const initialTimer = setTimeout(() => {
    refreshExpiringGoogleTokens({ bufferMs }).catch((err) => {
      console.error("[google-refresh] initial pass failed:", err);
    });
  }, 30_000);

  _timer = setInterval(() => {
    refreshExpiringGoogleTokens({ bufferMs }).catch((err) => {
      console.error("[google-refresh] interval pass failed:", err);
    });
  }, intervalMs);

  // Don't let either timer keep the process alive on its own.
  if (
    typeof initialTimer === "object" &&
    initialTimer &&
    "unref" in initialTimer
  ) {
    (initialTimer as { unref: () => void }).unref();
  }
  if (typeof _timer === "object" && _timer && "unref" in _timer) {
    (_timer as { unref: () => void }).unref();
  }
}
