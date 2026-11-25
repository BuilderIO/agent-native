const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PEOPLE_BASE = "https://people.googleapis.com/v1";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_REQUEST_TIMEOUT_MS = 30_000;

function googleRequestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

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
        signal: googleRequestSignal(),
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
        const code = (data as any).error;
        const desc = (data as any).error_description;
        const detail =
          code && desc ? `${code}: ${desc}` : code || desc || res.statusText;
        throw new Error(`OAuth token exchange failed: ${detail}`);
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
        signal: googleRequestSignal(),
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = (data as any).error;
        const desc = (data as any).error_description;
        const detail =
          code && desc ? `${code}: ${desc}` : code || desc || res.statusText;
        throw new GoogleApiError(
          res.status,
          `OAuth token refresh failed: ${detail}`,
          typeof code === "string" ? code : undefined,
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

export class GoogleApiError extends Error {
  readonly status: number;
  readonly reason: string | undefined;

  constructor(status: number, message: string, reason?: string) {
    super(`Google API error (${status}): ${message}`);
    this.name = "GoogleApiError";
    this.status = status;
    this.reason = reason;
  }
}

function googleApiErrorFromData(
  status: number,
  data: unknown,
  fallback: string,
): GoogleApiError {
  const failure = data as {
    error?: { message?: unknown; errors?: Array<{ reason?: unknown }> };
  } | null;
  const message = failure?.error?.message;
  const reason = failure?.error?.errors?.[0]?.reason;
  return new GoogleApiError(
    status,
    typeof message === "string" ? message : fallback,
    typeof reason === "string" ? reason : undefined,
  );
}

export function isGoogleNotFoundError(error: unknown): boolean {
  return (
    (error instanceof GoogleApiError && error.status === 404) ||
    (error instanceof Error && /^Google API error \(404\):/.test(error.message))
  );
}

export function isGooglePreconditionFailedError(error: unknown): boolean {
  return (
    (error instanceof GoogleApiError && error.status === 412) ||
    (error instanceof Error && /^Google API error \(412\):/.test(error.message))
  );
}

export function isGoogleRequestRejectedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status =
    error instanceof GoogleApiError
      ? error.status
      : Number(/^Google API error \((\d{3})\):/.exec(error.message)?.[1]);
  return status >= 400 && status < 500 && status !== 408;
}

export function isGoogleEventAbsentError(error: unknown): boolean {
  return (
    isGoogleNotFoundError(error) ||
    (error instanceof GoogleApiError && error.status === 410) ||
    (error instanceof Error && /^Google API error \(410\):/.test(error.message))
  );
}

export async function googleFetch(
  url: string,
  accessToken: string,
  opts?: RequestInit,
): Promise<any> {
  const headers = new Headers(opts?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);

  const res = await fetch(url, {
    ...opts,
    headers,
    signal: googleRequestSignal(opts?.signal ?? undefined),
  });

  if (res.status === 204) return null;

  const data = await res.json().catch((error: unknown) => {
    if (!res.ok) throw new GoogleApiError(res.status, res.statusText);
    throw error;
  });

  if (!res.ok) {
    const msg =
      (data as any)?.error?.message ||
      (data as any)?.error_description ||
      res.statusText;
    const reason = (
      data as { error?: { errors?: Array<{ reason?: unknown }> } } | null
    )?.error?.errors?.[0]?.reason;
    throw new GoogleApiError(
      res.status,
      msg,
      typeof reason === "string" ? reason : undefined,
    );
  }

  return data;
}

function qs(
  params: Record<
    string,
    string | number | boolean | Array<string | number | boolean> | undefined
  >,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) sp.append(k, String(item));
    } else {
      sp.set(k, String(v));
    }
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

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

export function calendarGetEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  signal?: AbortSignal,
) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${qs({ supportsAttachments: true })}`,
    accessToken,
    { signal },
  );
}

interface EventWriteParams {
  sendUpdates?: string | undefined;
  conferenceDataVersion?: number | undefined;
  supportsAttachments?: boolean | undefined;
  ifMatch?: string | undefined;
}

function eventWrite(
  method: "PATCH" | "PUT",
  params: EventWriteParams | undefined,
) {
  const { ifMatch, ...query } = params ?? {};
  return {
    query: qs(query),
    init: {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(ifMatch ? { "If-Match": ifMatch } : {}),
      },
    },
  };
}

export function calendarPatchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: any,
  params?: EventWriteParams,
  signal?: AbortSignal,
) {
  const { query, init } = eventWrite("PATCH", params);
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${query}`,
    accessToken,
    { ...init, body: JSON.stringify(body), ...(signal ? { signal } : {}) },
  );
}

export type CalendarEventListParams = {
  timeMin?: string;
  timeMax?: string;
  q?: string;
  singleEvents?: boolean;
  showDeleted?: boolean;
  orderBy?: string;
  maxResults?: number;
  pageToken?: string | undefined;
  eventTypes?: string[];
  syncToken?: string;
};

export function calendarListEvents(
  accessToken: string,
  calendarId: string,
  params: CalendarEventListParams = {},
  signal?: AbortSignal,
) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events${qs({ ...params, supportsAttachments: true })}`,
    accessToken,
    { signal },
  );
}

export async function calendarBatchListEvents(
  accessToken: string,
  requests: Array<{ calendarId: string; params: CalendarEventListParams }>,
): Promise<Array<PromiseSettledResult<unknown>>> {
  if (requests.length === 0) return [];
  if (requests.length > 100)
    throw new Error("Too many calendar reads in one batch");
  const boundary = `batch_${crypto.randomUUID()}`;
  const body =
    requests
      .map(
        ({ calendarId, params }, index) =>
          `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <${index}>\r\n\r\nGET /calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${qs({ ...params, supportsAttachments: true })} HTTP/1.1\r\n\r\n`,
      )
      .join("") + `--${boundary}--\r\n`;
  const response = await fetch("https://www.googleapis.com/batch/calendar/v3", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    body,
    signal: googleRequestSignal(),
  });
  const raw = await response.text();
  if (!response.ok) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new GoogleApiError(
        response.status,
        response.statusText || "Calendar batch failed",
      );
    }
    throw googleApiErrorFromData(
      response.status,
      data,
      response.statusText || "Calendar batch failed",
    );
  }
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(
    response.headers.get("content-type") ?? "",
  );
  const responseBoundary = match?.[1] ?? match?.[2];
  if (!responseBoundary)
    throw new Error("Calendar batch response has no boundary");
  const parts = raw
    .split(`--${responseBoundary}`)
    .slice(1)
    .filter((part) => !part.startsWith("--") && part.trim());
  if (parts.length !== requests.length)
    throw new Error("Calendar batch response is incomplete");
  return parts.map((part, index): PromiseSettledResult<unknown> => {
    const headerEnd = part.indexOf("\r\n\r\n");
    const responseId = /^Content-ID:\s*<?response-(\d+)>?\s*$/im.exec(
      part.slice(0, headerEnd),
    )?.[1];
    if (responseId === undefined || Number(responseId) !== index)
      throw new Error("Calendar batch response does not match its requests");
    const message = headerEnd < 0 ? "" : part.slice(headerEnd + 4);
    const bodyStart = message.indexOf("\r\n\r\n");
    const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/i.exec(message)?.[1];
    if (!status || bodyStart < 0)
      throw new Error("Invalid calendar batch response");
    const code = Number(status);
    const content = message.slice(bodyStart + 4).trim();
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (error) {
      if (code < 400) throw error;
      return {
        status: "rejected",
        reason: new GoogleApiError(code, "Calendar read failed"),
      };
    }
    if (code >= 400) {
      return {
        status: "rejected",
        reason: googleApiErrorFromData(code, data, "Calendar read failed"),
      };
    }
    return { status: "fulfilled", value: data };
  });
}

export function calendarListCalendars(
  accessToken: string,
  params: { maxResults?: number; pageToken?: string } = {},
) {
  return googleFetch(
    `${CALENDAR_BASE}/users/me/calendarList${qs(params)}`,
    accessToken,
  );
}

export function calendarGetCalendar(accessToken: string, calendarId: string) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}`,
    accessToken,
  );
}

export function calendarFreeBusy(
  accessToken: string,
  body: {
    timeMin: string;
    timeMax: string;
    timeZone?: string;
    items: Array<{ id: string }>;
  },
) {
  return googleFetch(`${CALENDAR_BASE}/freeBusy`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function calendarInsertEvent(
  accessToken: string,
  calendarId: string,
  body: any,
  params?: {
    conferenceDataVersion?: number;
    sendUpdates?: string;
    supportsAttachments?: boolean;
  },
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
  params?: EventWriteParams,
) {
  const { query, init } = eventWrite("PUT", params);
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${query}`,
    accessToken,
    { ...init, body: JSON.stringify(body) },
  );
}

export function calendarDeleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  sendUpdates?: string,
  ifMatch?: string,
) {
  return googleFetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${qs({ sendUpdates })}`,
    accessToken,
    {
      method: "DELETE",
      ...(ifMatch ? { headers: { "If-Match": ifMatch } } : {}),
    },
  );
}

export function oauth2GetUserInfo(accessToken: string) {
  return googleFetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    accessToken,
  );
}
