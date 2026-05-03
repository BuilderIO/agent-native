/**
 * Minimal Google Calendar v3 client.
 *
 * Hand-rolled fetch-only — no `googleapis` SDK. We use this for two narrow
 * operations:
 *   1. Exchange / refresh OAuth tokens.
 *   2. List events for a connected calendar account.
 *
 * Tokens themselves live in `app_secrets` (see `connect-calendar.ts` /
 * `sync-calendars.ts`); this module never persists them.
 *
 * Endpoints (Google has kept these stable since 2014):
 *   Auth:    https://accounts.google.com/o/oauth2/v2/auth
 *   Token:   https://oauth2.googleapis.com/token
 *   Events:  https://www.googleapis.com/calendar/v3/calendars/{calId}/events
 *   Userinfo: https://www.googleapis.com/oauth2/v2/userinfo
 */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL =
  "https://www.googleapis.com/oauth2/v2/userinfo";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email?: boolean;
  name?: string;
  picture?: string;
}

export interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
      label?: string;
    }>;
  };
  updated?: string;
  recurringEventId?: string;
}

export interface ExchangeCodeArgs {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Exchange an authorization code for tokens. Throws on non-2xx. */
export async function exchangeCode(
  args: ExchangeCodeArgs,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/** Refresh an access token. Throws on non-2xx (caller decides whether to drop the row). */
export async function refreshAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/** Best-effort revoke. Returns true if Google returned 2xx, false otherwise. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch the user's basic profile so we can label the calendar account. */
export async function getUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google userinfo failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GoogleUserInfo;
}

export interface ListEventsArgs {
  accessToken: string;
  calendarId?: string; // defaults to "primary"
  timeMin?: string; // ISO
  timeMax?: string; // ISO
  maxResults?: number;
  singleEvents?: boolean;
  pageToken?: string;
}

export interface ListEventsResponse {
  items: CalendarEvent[];
  nextPageToken?: string;
}

/** List events on a calendar. Throws on non-2xx. */
export async function listEvents(
  args: ListEventsArgs,
): Promise<ListEventsResponse> {
  const calId = encodeURIComponent(args.calendarId ?? "primary");
  const params = new URLSearchParams();
  if (args.timeMin) params.set("timeMin", args.timeMin);
  if (args.timeMax) params.set("timeMax", args.timeMax);
  params.set("maxResults", String(args.maxResults ?? 100));
  params.set("singleEvents", args.singleEvents === false ? "false" : "true");
  params.set("orderBy", "startTime");
  if (args.pageToken) params.set("pageToken", args.pageToken);
  const url = `${GOOGLE_CALENDAR_API}/calendars/${calId}/events?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google calendar list failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    items?: CalendarEvent[];
    nextPageToken?: string;
  };
  return {
    items: json.items ?? [],
    nextPageToken: json.nextPageToken,
  };
}

/**
 * Pick the conferencing join URL from an event. Prefers Google Meet's
 * `hangoutLink`, then a `video` conferenceData entry point, then any
 * uri shaped like a known meeting platform.
 */
export function pickJoinUrl(event: CalendarEvent): string | undefined {
  if (event.hangoutLink) return event.hangoutLink;
  const eps = event.conferenceData?.entryPoints ?? [];
  const video = eps.find((e) => e.entryPointType === "video");
  if (video?.uri) return video.uri;
  for (const ep of eps) {
    if (
      ep.uri &&
      /(zoom\.us|meet\.google|teams\.microsoft|webex\.com)/i.test(ep.uri)
    ) {
      return ep.uri;
    }
  }
  // Fall back to scanning the description / location for a meeting URL.
  const haystack = `${event.description ?? ""}\n${event.location ?? ""}`;
  const m = haystack.match(
    /https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com)\/[^\s<>"]+/i,
  );
  return m?.[0];
}

/** Detect the conferencing platform from an event's join URL. */
export function detectPlatform(
  joinUrl: string | undefined,
): "zoom" | "meet" | "teams" | "webex" | "other" {
  if (!joinUrl) return "other";
  if (/meet\.google\.com/i.test(joinUrl)) return "meet";
  if (/zoom\.us/i.test(joinUrl)) return "zoom";
  if (/teams\.microsoft\.com/i.test(joinUrl)) return "teams";
  if (/webex\.com/i.test(joinUrl)) return "webex";
  return "other";
}
