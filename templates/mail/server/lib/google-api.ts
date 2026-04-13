// Lightweight, fetch-based Google API client for Cloudflare Workers compatibility.
// Replaces the heavyweight `googleapis` npm package with pure fetch calls.

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PEOPLE_BASE = "https://people.googleapis.com/v1";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * An auth credential for Google API calls. Either:
 *   - a raw access token (string) — direct path, user owns the OAuth client
 *   - a proxy target — Builder-managed OAuth, tokens resolved server-side at
 *     `ai-services.builder.io/google/*` using BUILDER_PRIVATE_KEY
 *
 * Every gmail/people/calendar function accepts either form — the function
 * picks the right base URL + headers via `apiUrl()` and `authHeaders()`.
 */
export interface GoogleProxyTarget {
  __googleProxy: "builder";
  /** Proxy origin + path, e.g. "https://ai-services.builder.io/google" */
  baseUrl: string;
  /** Headers to attach to every proxied request (Authorization + X-Google-Account) */
  headers: Record<string, string>;
}

export type GoogleAuth = string | GoogleProxyTarget;

function isProxyTarget(auth: GoogleAuth): auth is GoogleProxyTarget {
  return (
    typeof auth === "object" &&
    auth !== null &&
    (auth as GoogleProxyTarget).__googleProxy === "builder"
  );
}

function apiUrl(
  auth: GoogleAuth,
  api: "gmail" | "people" | "calendar",
  path: string,
): string {
  if (isProxyTarget(auth)) {
    const prefix =
      api === "gmail"
        ? "/gmail/v1/users/me"
        : api === "people"
          ? "/people/v1"
          : "/calendar/v3";
    return `${auth.baseUrl}${prefix}${path}`;
  }
  const base =
    api === "gmail"
      ? GMAIL_BASE
      : api === "people"
        ? PEOPLE_BASE
        : CALENDAR_BASE;
  return `${base}${path}`;
}

function authHeaders(auth: GoogleAuth): Record<string, string> {
  if (isProxyTarget(auth)) return { ...auth.headers };
  return { Authorization: `Bearer ${auth}` };
}

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
  auth: GoogleAuth,
  opts?: RequestInit,
): Promise<any> {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = new Headers(opts?.headers);
    for (const [k, v] of Object.entries(authHeaders(auth))) {
      headers.set(k, v);
    }

    const res = await fetch(url, { ...opts, headers });

    // 204 No Content — return null
    if (res.status === 204) return null;

    // 429 Too Many Requests or 503 — retry with exponential backoff
    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

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
}

// ---------------------------------------------------------------------------
// URL builder helpers
// ---------------------------------------------------------------------------

function qs(params: Record<string, string | number | undefined>): string {
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

export function gmailGetProfile(auth: GoogleAuth) {
  return googleFetch(apiUrl(auth, "gmail", "/profile"), auth);
}

export function gmailListMessages(
  auth: GoogleAuth,
  params: { q?: string; maxResults?: number; pageToken?: string } = {},
) {
  return googleFetch(apiUrl(auth, "gmail", `/messages${qs(params)}`), auth);
}

export function gmailGetMessage(
  auth: GoogleAuth,
  id: string,
  format?: "full" | "metadata" | "minimal",
) {
  return googleFetch(
    apiUrl(auth, "gmail", `/messages/${id}${qs({ format })}`),
    auth,
  );
}

export function gmailSendMessage(
  auth: GoogleAuth,
  raw: string,
  threadId?: string,
) {
  const payload: Record<string, string> = { raw };
  if (threadId) payload.threadId = threadId;
  return googleFetch(apiUrl(auth, "gmail", "/messages/send"), auth, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function gmailModifyMessage(
  auth: GoogleAuth,
  id: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
) {
  return googleFetch(apiUrl(auth, "gmail", `/messages/${id}/modify`), auth, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}

export function gmailModifyThread(
  auth: GoogleAuth,
  threadId: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
) {
  return googleFetch(
    apiUrl(auth, "gmail", `/threads/${threadId}/modify`),
    auth,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    },
  );
}

export function gmailTrashMessage(auth: GoogleAuth, id: string) {
  return googleFetch(apiUrl(auth, "gmail", `/messages/${id}/trash`), auth, {
    method: "POST",
  });
}

export function gmailTrashThread(auth: GoogleAuth, threadId: string) {
  return googleFetch(
    apiUrl(auth, "gmail", `/threads/${threadId}/trash`),
    auth,
    {
      method: "POST",
    },
  );
}

export function gmailUntrashMessage(auth: GoogleAuth, id: string) {
  return googleFetch(apiUrl(auth, "gmail", `/messages/${id}/untrash`), auth, {
    method: "POST",
  });
}

export function gmailUntrashThread(auth: GoogleAuth, threadId: string) {
  return googleFetch(
    apiUrl(auth, "gmail", `/threads/${threadId}/untrash`),
    auth,
    { method: "POST" },
  );
}

export function gmailGetAttachment(
  auth: GoogleAuth,
  messageId: string,
  attachmentId: string,
) {
  return googleFetch(
    apiUrl(auth, "gmail", `/messages/${messageId}/attachments/${attachmentId}`),
    auth,
  );
}

export function gmailGetThread(auth: GoogleAuth, id: string, format?: string) {
  return googleFetch(
    apiUrl(auth, "gmail", `/threads/${id}${qs({ format })}`),
    auth,
  );
}

export function gmailListLabels(auth: GoogleAuth) {
  return googleFetch(apiUrl(auth, "gmail", "/labels"), auth);
}

export function gmailCreateLabel(
  auth: GoogleAuth,
  name: string,
  opts?: {
    labelListVisibility?: string;
    messageListVisibility?: string;
  },
) {
  return googleFetch(apiUrl(auth, "gmail", "/labels"), auth, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      labelListVisibility: opts?.labelListVisibility ?? "labelShow",
      messageListVisibility: opts?.messageListVisibility ?? "show",
    }),
  });
}

export function gmailListHistory(
  auth: GoogleAuth,
  params: {
    startHistoryId: string;
    historyTypes?: string[];
    labelId?: string;
    maxResults?: number;
  },
) {
  const queryParams: Record<string, string | number | undefined> = {
    startHistoryId: params.startHistoryId,
    labelId: params.labelId,
    maxResults: params.maxResults,
  };
  if (params.historyTypes?.length) {
    queryParams.historyTypes = params.historyTypes.join(",");
  }
  return googleFetch(apiUrl(auth, "gmail", `/history${qs(queryParams)}`), auth);
}

// ---------------------------------------------------------------------------
// People API
// ---------------------------------------------------------------------------

export function peopleGetProfile(auth: GoogleAuth, personFields: string) {
  return googleFetch(
    apiUrl(auth, "people", `/people/me${qs({ personFields })}`),
    auth,
  );
}

export function peopleListConnections(
  auth: GoogleAuth,
  params: {
    pageSize?: number;
    personFields?: string;
    pageToken?: string;
  } = {},
) {
  return googleFetch(
    apiUrl(auth, "people", `/people/me/connections${qs(params)}`),
    auth,
  );
}

export function peopleListOtherContacts(
  auth: GoogleAuth,
  params: {
    pageSize?: number;
    readMask?: string;
    pageToken?: string;
  } = {},
) {
  return googleFetch(
    apiUrl(auth, "people", `/otherContacts${qs(params)}`),
    auth,
  );
}

// ---------------------------------------------------------------------------
// Calendar API
// ---------------------------------------------------------------------------

export function calendarGetEvent(
  auth: GoogleAuth,
  calendarId: string,
  eventId: string,
) {
  return googleFetch(
    apiUrl(
      auth,
      "calendar",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    ),
    auth,
  );
}

export function calendarPatchEvent(
  auth: GoogleAuth,
  calendarId: string,
  eventId: string,
  body: any,
  sendUpdates?: string,
) {
  return googleFetch(
    apiUrl(
      auth,
      "calendar",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${qs({ sendUpdates })}`,
    ),
    auth,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
