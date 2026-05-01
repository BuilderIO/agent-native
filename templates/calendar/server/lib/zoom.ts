/**
 * Zoom integration for the calendar template.
 *
 * Wraps the scheduling package's `createZoomProvider` with the token-
 * storage plumbing this template uses (core's `oauth_tokens`). Each
 * user's Zoom account is stored as a distinct row keyed by the Zoom user
 * id returned from /users/me, with `owner = <user_email>`.
 *
 * - `getZoomAuthUrl` — start the OAuth flow
 * - `exchangeZoomCode` — callback handler; stores tokens
 * - `getZoomStatus` — used by the UI to render the Connect Zoom banner
 * - `createZoomMeeting` — called from the booking route to create a
 *   real Zoom meeting for a new booking
 */
import { nanoid } from "nanoid";
import {
  getOAuthTokens,
  saveOAuthTokens,
  listOAuthAccountsByOwner,
  deleteOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { createZoomProvider } from "@agent-native/scheduling/server/providers";

const PROVIDER = "zoom_video";
const SCOPES = [
  "meeting:write:meeting",
  "meeting:read:meeting",
  "user:read:user",
  "user:read:email",
];

function getZoomCreds() {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function isZoomConfigured(): boolean {
  return getZoomCreds() != null;
}

export function getZoomAuthUrl(redirectUri: string, state: string) {
  const creds = getZoomCreds();
  if (!creds) throw new Error("Zoom OAuth not configured");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    state,
    scope: SCOPES.join(" "),
  });
  return `https://zoom.us/oauth/authorize?${params}`;
}

/**
 * Exchange an authorization code for Zoom tokens. Stores them in
 * `oauth_tokens(provider="zoom_video", account_id=<zoom_user_id>, owner=<ownerEmail>)`.
 */
export async function exchangeZoomCode(
  code: string,
  redirectUri: string,
  ownerEmail: string,
): Promise<{ accountId: string; email?: string; displayName?: string }> {
  const creds = getZoomCreds();
  if (!creds) throw new Error("Zoom OAuth not configured");

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString(
    "base64",
  );
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Zoom token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  // Identify the user via /users/me so we can key the token row by zoom
  // user id (so a user can connect + re-connect without duplicates).
  const whoRes = await fetch("https://api.zoom.us/v2/users/me", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  let zoomUserId = `zoom_${nanoid()}`;
  let email: string | undefined;
  let displayName: string | undefined;
  if (whoRes.ok) {
    const who = (await whoRes.json()) as {
      id?: string;
      email?: string;
      first_name?: string;
      last_name?: string;
    };
    if (who.id) zoomUserId = who.id;
    email = who.email;
    if (who.first_name || who.last_name) {
      displayName = [who.first_name, who.last_name].filter(Boolean).join(" ");
    }
  }

  await saveOAuthTokens(
    PROVIDER,
    zoomUserId,
    {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      displayName,
      email,
    },
    ownerEmail,
  );

  return { accountId: zoomUserId, email, displayName };
}

/**
 * Returns `{ connected: true, accounts: [...] }` when the user has at
 * least one Zoom account linked.
 */
export async function getZoomStatus(ownerEmail?: string | null) {
  const configured = isZoomConfigured();
  if (!configured) {
    return { connected: false, accounts: [], configured: false };
  }
  if (!ownerEmail) {
    return { connected: false, accounts: [], configured: true };
  }
  const accounts = await listOAuthAccountsByOwner(PROVIDER, ownerEmail);
  return {
    connected: accounts.length > 0,
    configured: true,
    accounts: accounts.map((a) => ({
      id: a.accountId,
      email: (a.tokens as any)?.email as string | undefined,
      displayName:
        a.displayName ?? ((a.tokens as any)?.displayName as string | undefined),
    })),
  };
}

export async function disconnectZoom(ownerEmail: string) {
  const accounts = await listOAuthAccountsByOwner(PROVIDER, ownerEmail);
  for (const a of accounts) await deleteOAuthTokens(PROVIDER, a.accountId);
}

/**
 * Create a Zoom meeting for a new booking. Picks the first Zoom account
 * owned by the host. Returns undefined if the host has no connected Zoom.
 */
export async function createZoomMeeting(opts: {
  hostEmail: string;
  title: string;
  startTime: string; // ISO
  endTime: string; // ISO
  timezone: string;
}): Promise<{ meetingUrl: string; meetingId: string } | undefined> {
  const accounts = await listOAuthAccountsByOwner(PROVIDER, opts.hostEmail);
  if (accounts.length === 0) return undefined;
  const creds = getZoomCreds();
  if (!creds) return undefined;

  const provider = createZoomProvider({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    getAccessToken: (credentialId) => resolveAccessToken(credentialId),
    updateTokens: async (credentialId, tokens) => {
      const existing = (await getOAuthTokens(PROVIDER, credentialId)) ?? {};
      await saveOAuthTokens(PROVIDER, credentialId, {
        ...existing,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? (existing as any).refreshToken,
        expiresAt: tokens.expiresAt?.getTime(),
      });
    },
  });

  const credentialId = accounts[0].accountId;
  const result = await provider.createMeeting({
    credentialId,
    booking: {
      uid: nanoid(),
      title: opts.title,
      description: "",
      startTime: opts.startTime,
      endTime: opts.endTime,
      timezone: opts.timezone,
      hostEmail: opts.hostEmail,
      attendees: [],
      iCalUid: nanoid(),
      iCalSequence: 0,
    } as any,
  });
  return { meetingUrl: result.meetingUrl, meetingId: result.meetingId };
}

/**
 * Resolve a fresh access token for a Zoom credential, refreshing it if it's
 * expired (or near-expiry). Persists the refreshed tokens back to oauth_tokens.
 */
async function resolveAccessToken(credentialId: string): Promise<string> {
  const record: any = await getOAuthTokens(PROVIDER, credentialId);
  if (!record?.accessToken) {
    throw new Error("Zoom credential missing access token");
  }
  const expiresAt: number | undefined = record.expiresAt;
  const stillFresh =
    typeof expiresAt === "number" && expiresAt > Date.now() + 60_000;
  if (stillFresh) return record.accessToken;
  if (!record.refreshToken) return record.accessToken;

  const creds = getZoomCreds();
  if (!creds) return record.accessToken;
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString(
    "base64",
  );
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: record.refreshToken,
  });
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) return record.accessToken;
  const next = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  await saveOAuthTokens(PROVIDER, credentialId, {
    ...record,
    accessToken: next.access_token,
    refreshToken: next.refresh_token ?? record.refreshToken,
    expiresAt: Date.now() + (next.expires_in ?? 3600) * 1000,
  });
  return next.access_token;
}
