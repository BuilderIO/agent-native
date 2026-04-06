// Lightweight, fetch-based Google API client for Cloudflare Workers compatibility.
// Replaces the heavyweight `googleapis` npm package with pure fetch calls.

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PEOPLE_BASE = "https://people.googleapis.com/v1";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// ---------------------------------------------------------------------------
// OAuth2 helpers
// ---------------------------------------------------------------------------

export function createOAuth2Client(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
) {
  return {
    generateAuthUrl(opts: {
      scope: string[];
      access_type: string;
      prompt?: string;
      state?: string;
    }): string {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: opts.scope.join(" "),
        access_type: opts.access_type,
      });
      if (opts.prompt) params.set("prompt", opts.prompt);
      if (opts.state) params.set("state", opts.state);
      return `${OAUTH_AUTH_URL}?${params.toString()}`;
    },

    async getToken(code: string) {
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          `OAuth token exchange failed: ${(data as any).error_description || (data as any).error || res.statusText}`,
        );
      }
      const typed = data as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        token_type: string;
        scope: string;
      };
      return {
        ...typed,
        expiry_date: Date.now() + typed.expires_in * 1000,
      };
    },

    async refreshToken(refreshToken: string) {
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          `OAuth token refresh failed: ${(data as any).error_description || (data as any).error || res.statusText}`,
        );
      }
      const typed = data as {
        access_token: string;
        expires_in: number;
        token_type: string;
        scope: string;
      };
      return {
        ...typed,
        expiry_date: Date.now() + typed.expires_in * 1000,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Authenticated fetch helper
// ---------------------------------------------------------------------------

export async function googleFetch(
  url: string,
  accessToken: string,
  opts?: RequestInit,
): Promise<any> {
  const headers = new Headers(opts?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);

  const res = await fetch(url, { ...opts, headers });

  // 204 No Content — return null
  if (res.status === 204) return null;

  const data = await res.json();

  if (!res.ok) {
    const msg =
      (data as any)?.error?.message ||
      (data as any)?.error_description ||
      res.statusText;
    throw new Error(`Google API error (${res.status}): ${msg}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// URL builder helpers
// ---------------------------------------------------------------------------

function qs(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v));
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

// ---------------------------------------------------------------------------
// Gmail API
// ---------------------------------------------------------------------------

export function gmailGetProfile(accessToken: string) {
  return googleFetch(`${GMAIL_BASE}/profile`, accessToken);
}

export function gmailListMessages(
  accessToken: string,
  params: { q?: string; maxResults?: number; pageToken?: string } = {},
) {
  return googleFetch(`${GMAIL_BASE}/messages${qs(params)}`, accessToken);
}

export function gmailGetMessage(
  accessToken: string,
  id: string,
  format?: "full" | "metadata" | "minimal",
) {
  return googleFetch(
    `${GMAIL_BASE}/messages/${id}${qs({ format })}`,
    accessToken,
  );
}

export function gmailSendMessage(
  accessToken: string,
  raw: string,
  threadId?: string,
) {
  const payload: Record<string, string> = { raw };
  if (threadId) payload.threadId = threadId;
  return googleFetch(`${GMAIL_BASE}/messages/send`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function gmailModifyMessage(
  accessToken: string,
  id: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
) {
  return googleFetch(`${GMAIL_BASE}/messages/${id}/modify`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}

export function gmailTrashMessage(accessToken: string, id: string) {
  return googleFetch(`${GMAIL_BASE}/messages/${id}/trash`, accessToken, {
    method: "POST",
  });
}

export function gmailGetAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
) {
  return googleFetch(
    `${GMAIL_BASE}/messages/${messageId}/attachments/${attachmentId}`,
    accessToken,
  );
}

export function gmailGetThread(
  accessToken: string,
  id: string,
  format?: string,
) {
  return googleFetch(
    `${GMAIL_BASE}/threads/${id}${qs({ format })}`,
    accessToken,
  );
}

export function gmailListLabels(accessToken: string) {
  return googleFetch(`${GMAIL_BASE}/labels`, accessToken);
}

// ---------------------------------------------------------------------------
// People API
// ---------------------------------------------------------------------------

export function peopleGetProfile(accessToken: string, personFields: string) {
  return googleFetch(
    `${PEOPLE_BASE}/people/me${qs({ personFields })}`,
    accessToken,
  );
}

export function peopleListConnections(
  accessToken: string,
  params: {
    pageSize?: number;
    personFields?: string;
    pageToken?: string;
  } = {},
) {
  return googleFetch(
    `${PEOPLE_BASE}/people/me/connections${qs(params)}`,
    accessToken,
  );
}

export function peopleListOtherContacts(
  accessToken: string,
  params: {
    pageSize?: number;
    readMask?: string;
    pageToken?: string;
  } = {},
) {
  return googleFetch(`${PEOPLE_BASE}/otherContacts${qs(params)}`, accessToken);
}

export function peopleSearchDirectoryPeople(
  accessToken: string,
  query: string,
  params: {
    pageSize?: number;
    readMask?: string;
  } = {},
) {
  return googleFetch(
    `${PEOPLE_BASE}/people:searchDirectoryPeople${qs({
      query,
      readMask: params.readMask ?? "names,emailAddresses,photos",
      sources: "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
      pageSize: params.pageSize ?? 20,
    })}`,
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// Calendar API
// ---------------------------------------------------------------------------

export function calendarGetEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
  );
}

export function calendarPatchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: any,
  sendUpdates?: string,
) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${qs({ sendUpdates })}`,
    accessToken,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function calendarListEvents(
  accessToken: string,
  calendarId: string,
  params: {
    timeMin?: string;
    timeMax?: string;
    singleEvents?: boolean;
    orderBy?: string;
    maxResults?: number;
  } = {},
) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events${qs(params)}`,
    accessToken,
  );
}

export function calendarInsertEvent(
  accessToken: string,
  calendarId: string,
  body: any,
  params?: { conferenceDataVersion?: number },
) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events${qs(params ?? {})}`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function calendarUpdateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: any,
) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export function calendarDeleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  sendUpdates?: string,
) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${qs({ sendUpdates })}`,
    accessToken,
    { method: "DELETE" },
  );
}

// ---------------------------------------------------------------------------
// OAuth2 Userinfo
// ---------------------------------------------------------------------------

export function oauth2GetUserInfo(accessToken: string) {
  return googleFetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    accessToken,
  );
}
