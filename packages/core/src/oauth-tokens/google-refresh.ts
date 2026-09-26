import { resolveGoogleProviderCredentialCandidates } from "../server/google-oauth-credentials.js";
import { startIntervalJob } from "../server/interval-job.js";
import { listOAuthAccounts, saveOAuthTokens } from "./store.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_REQUEST_TIMEOUT_MS = 15_000;

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
  const credentialCandidates = resolveGoogleProviderCredentialCandidates();
  if (!credentialCandidates.length) {
    throw new Error("GOOGLE_CLIENT_ID/SECRET not set");
  }

  let data: Record<string, unknown> | null = null;
  let lastStatusText = "refresh failed";
  for (const credentials of credentialCandidates) {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(REFRESH_REQUEST_TIMEOUT_MS),
    });
    lastStatusText = res.statusText;
    data = (await res.json()) as Record<string, unknown>;
    if (res.ok) return data as unknown as RefreshResponse;
    if (
      data.error !== "invalid_grant" &&
      data.error !== "unauthorized_client" &&
      data.error !== "invalid_client"
    ) {
      break;
    }
  }

  if (data) {
    const err = (data.error_description ||
      data.error ||
      lastStatusText) as string;
    throw new Error(err);
  }
  throw new Error(lastStatusText);
}

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
      console.warn(
        `[google-refresh] refresh failed for ${acct.accountId}:`,
        (err as Error).message,
      );
    }
  }
}

let _started = false;

export function startGoogleTokenRefreshLoop(
  opts: {
    intervalMs?: number;
    bufferMs?: number;
  } = {},
): void {
  if (_started) return;
  _started = true;

  if (process.env.NODE_ENV !== "production") {
    return;
  }
  const intervalMs = opts.intervalMs ?? 20 * 60 * 1000;
  const bufferMs = opts.bufferMs ?? 15 * 60 * 1000;

  const startupTimer = setTimeout(() => {
    startIntervalJob(() => refreshExpiringGoogleTokens({ bufferMs }), {
      intervalMs,
      onError: (err) => {
        console.error("[google-refresh] refresh pass failed:", err);
      },
    });
  }, 30_000);
  startupTimer.unref?.();
}
