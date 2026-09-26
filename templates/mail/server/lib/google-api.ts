
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PEOPLE_BASE = "https://people.googleapis.com/v1";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";


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
        throw new Error(`OAuth token refresh failed: ${detail}`);
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


const QUOTA_COOLDOWN_MS = 90_000;
const QUOTA_COOLDOWN_MAX_MS = 300_000;
const tokenCooldowns = new Map<string, number>();

function cooldownKey(accessToken: string): string {
  return accessToken.slice(-12);
}

function isInCooldown(accessToken: string): number {
  const until = tokenCooldowns.get(cooldownKey(accessToken));
  if (!until) return 0;
  if (until <= Date.now()) {
    tokenCooldowns.delete(cooldownKey(accessToken));
    return 0;
  }
  return until - Date.now();
}

function tripCooldown(
  accessToken: string,
  cooldownMs = QUOTA_COOLDOWN_MS,
): number {
  const effectiveCooldownMs = Math.min(
    Math.max(cooldownMs, QUOTA_COOLDOWN_MS),
    QUOTA_COOLDOWN_MAX_MS,
  );
  tokenCooldowns.set(
    cooldownKey(accessToken),
    Date.now() + effectiveCooldownMs,
  );
  return effectiveCooldownMs;
}

function isQuotaError(status: number, data: any): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const errors = data?.error?.errors;
  if (Array.isArray(errors)) {
    for (const e of errors) {
      const reason = e?.reason || "";
      if (
        reason === "rateLimitExceeded" ||
        reason === "userRateLimitExceeded" ||
        reason === "quotaExceeded"
      ) {
        return true;
      }
    }
  }
  const msg: string = data?.error?.message || "";
  return /quota|rate limit/i.test(msg);
}

function isQuotaErrorText(text: string | undefined): boolean {
  return (
    !!text &&
    /\b(?:429|quota|rate limit|rateLimitExceeded|userRateLimitExceeded)\b/i.test(
      text,
    )
  );
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

function quotaCooldownMessage(cooldownMs = QUOTA_COOLDOWN_MS): string {
  const seconds = Math.ceil(cooldownMs / 1000);
  return `Email service is briefly busy and will be ready again in about ${seconds}s. Ask the user for the missing info if you need it now, or try again in a moment.`;
}

export class GmailQuotaCooldownError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "GmailQuotaCooldownError";
    this.retryAfterMs = retryAfterMs;
  }
}

const BUCKET_REFILL_PER_SEC = 150;
const BUCKET_CAPACITY = 150;
const MAX_BATCH_QUOTA_COST = 150;

const COST_TABLE: Array<[RegExp, number, RegExp?]> = [
  [/\/gmail\/v1\/users\/[^/]+\/messages\/send/, 100, /^POST$/i],
  [/\/gmail\/v1\/users\/[^/]+\/watch/, 100, /^POST$/i],
  [/\/gmail\/v1\/users\/[^/]+\/stop/, 50, /^POST$/i],
  [/\/gmail\/v1\/users\/[^/]+\/threads\/[^/]+\/modify/, 10, /^POST$/i],
  [
    /\/gmail\/v1\/users\/[^/]+\/threads\/[^/]+\/(?:trash|untrash)/,
    10,
    /^POST$/i,
  ],
  [/\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+\/modify/, 5, /^POST$/i],
  [
    /\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+\/(?:trash|untrash)/,
    5,
    /^POST$/i,
  ],
  [
    /\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+\/attachments\/[^/]+/,
    5,
    /^GET$/i,
  ],
  [/\/gmail\/v1\/users\/[^/]+\/history/, 2, /^GET$/i],
  [/\/gmail\/v1\/users\/[^/]+\/labels(?:\/|$|\?)/, 5],
  [/\/gmail\/v1\/users\/[^/]+\/settings\/filters(?:\/|$|\?)/, 5],
  [/\/gmail\/v1\/users\/[^/]+\/profile/, 1, /^GET$/i],
  [/\/gmail\/v1\/users\/[^/]+\/threads\/[^/]+(?:$|\?)/, 10, /^GET$/i],
  [/\/gmail\/v1\/users\/[^/]+\/threads(?:\/|$|\?)/, 10, /^GET$/i],
  [/\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+(?:$|\?)/, 5, /^GET$/i],
  [/\/gmail\/v1\/users\/[^/]+\/messages(?:\/|$|\?)/, 5, /^GET$/i],
];

export function estimateRequestCost(url: string, method: string): number {
  for (const [pattern, cost, methodPattern] of COST_TABLE) {
    if (methodPattern && !methodPattern.test(method)) continue;
    if (pattern.test(url)) return cost;
  }
  return 5;
}

type Bucket = { tokens: number; lastRefill: number };
const tokenBuckets = new Map<string, Bucket>();

function getBucket(accessToken: string): Bucket {
  const key = cooldownKey(accessToken);
  let b = tokenBuckets.get(key);
  if (!b) {
    b = { tokens: BUCKET_CAPACITY, lastRefill: Date.now() };
    tokenBuckets.set(key, b);
  }
  return b;
}

function refillBucket(b: Bucket): void {
  const now = Date.now();
  const elapsed = (now - b.lastRefill) / 1000;
  if (elapsed > 0) {
    b.tokens = Math.min(
      BUCKET_CAPACITY,
      b.tokens + elapsed * BUCKET_REFILL_PER_SEC,
    );
    b.lastRefill = now;
  }
}

export async function acquireQuota(
  accessToken: string,
  cost: number,
): Promise<void> {
  const b = getBucket(accessToken);
  let remaining = Math.max(0, cost);
  while (remaining > 0) {
    const want = Math.min(remaining, BUCKET_CAPACITY);
    while (true) {
      refillBucket(b);
      if (b.tokens >= want) {
        b.tokens -= want;
        remaining -= want;
        break;
      }
      const deficit = want - b.tokens;
      const waitMs = Math.ceil((deficit / BUCKET_REFILL_PER_SEC) * 1000);
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 10)));
    }
  }
}

export async function googleFetch(
  url: string,
  accessToken: string,
  opts?: RequestInit,
): Promise<any> {
  const remaining = isInCooldown(accessToken);
  if (remaining > 0) {
    throw new GmailQuotaCooldownError(
      quotaCooldownMessage(remaining),
      remaining,
    );
  }

  const maxRetries = 3;
  const method = opts?.method?.toUpperCase() ?? "GET";
  const canRetry = method === "GET" || method === "HEAD";

  await acquireQuota(
    accessToken,
    estimateRequestCost(url, opts?.method || "GET"),
  );

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = new Headers(opts?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);

    const res = await fetch(url, { ...opts, headers });

    if (res.status === 204) return null;

    if (
      canRetry &&
      (res.status === 500 || res.status === 502 || res.status === 503) &&
      attempt < maxRetries
    ) {
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const rawBody = await res.text();
    let data: any;
    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = undefined;
      }
    }

    if (!res.ok && isQuotaError(res.status, data)) {
      const cooldownMs = parseRetryAfterMs(res.headers) ?? QUOTA_COOLDOWN_MS;
      const effectiveCooldownMs = tripCooldown(accessToken, cooldownMs);
      throw new GmailQuotaCooldownError(
        quotaCooldownMessage(effectiveCooldownMs),
        effectiveCooldownMs,
      );
    }

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


function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v));
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

export function gmailListThreads(
  accessToken: string,
  params: { q?: string; maxResults?: number; pageToken?: string } = {},
) {
  return googleFetch(`${GMAIL_BASE}/threads${qs(params)}`, accessToken);
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

export function gmailModifyThread(
  accessToken: string,
  threadId: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
) {
  return googleFetch(`${GMAIL_BASE}/threads/${threadId}/modify`, accessToken, {
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

export function gmailTrashThread(accessToken: string, threadId: string) {
  return googleFetch(`${GMAIL_BASE}/threads/${threadId}/trash`, accessToken, {
    method: "POST",
  });
}

export function gmailUntrashMessage(accessToken: string, id: string) {
  return googleFetch(`${GMAIL_BASE}/messages/${id}/untrash`, accessToken, {
    method: "POST",
  });
}

export function gmailUntrashThread(accessToken: string, threadId: string) {
  return googleFetch(`${GMAIL_BASE}/threads/${threadId}/untrash`, accessToken, {
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

function metadataQs(format?: string, metadataHeaders?: string[]): string {
  const sp = new URLSearchParams();
  if (format) sp.set("format", format);
  for (const h of metadataHeaders || []) sp.append("metadataHeaders", h);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function gmailGetThread(
  accessToken: string,
  id: string,
  format?: string,
  metadataHeaders?: string[],
) {
  return googleFetch(
    `${GMAIL_BASE}/threads/${id}${metadataQs(format, metadataHeaders)}`,
    accessToken,
  );
}

export function gmailListLabels(accessToken: string) {
  return googleFetch(`${GMAIL_BASE}/labels`, accessToken);
}

export function gmailCreateLabel(
  accessToken: string,
  name: string,
  opts?: {
    labelListVisibility?: string;
    messageListVisibility?: string;
  },
) {
  return googleFetch(`${GMAIL_BASE}/labels`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      labelListVisibility: opts?.labelListVisibility ?? "labelShow",
      messageListVisibility: opts?.messageListVisibility ?? "show",
    }),
  });
}

export type GmailFilterCriteria = {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: "smaller" | "larger" | "unspecified";
};

export type GmailFilterAction = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
};

export type GmailFilter = {
  id?: string;
  criteria?: GmailFilterCriteria;
  action?: GmailFilterAction;
};

export function gmailListFilters(
  accessToken: string,
): Promise<{ filter?: GmailFilter[] }> {
  return googleFetch(`${GMAIL_BASE}/settings/filters`, accessToken);
}

export function gmailGetFilter(
  accessToken: string,
  id: string,
): Promise<GmailFilter> {
  return googleFetch(
    `${GMAIL_BASE}/settings/filters/${encodeURIComponent(id)}`,
    accessToken,
  );
}

export function gmailCreateFilter(
  accessToken: string,
  filter: Pick<GmailFilter, "criteria" | "action">,
): Promise<GmailFilter> {
  return googleFetch(`${GMAIL_BASE}/settings/filters`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filter),
  });
}

export function gmailDeleteFilter(
  accessToken: string,
  id: string,
): Promise<null> {
  return googleFetch(
    `${GMAIL_BASE}/settings/filters/${encodeURIComponent(id)}`,
    accessToken,
    { method: "DELETE" },
  );
}

export function gmailListHistory(
  accessToken: string,
  params: {
    startHistoryId: string;
    historyTypes?: string[];
    labelId?: string;
    maxResults?: number;
    pageToken?: string;
  },
) {
  const sp = new URLSearchParams();
  sp.set("startHistoryId", params.startHistoryId);
  if (params.labelId) sp.set("labelId", params.labelId);
  if (params.maxResults !== undefined) {
    sp.set("maxResults", String(params.maxResults));
  }
  if (params.pageToken) sp.set("pageToken", params.pageToken);
  for (const t of params.historyTypes || []) sp.append("historyTypes", t);
  return googleFetch(`${GMAIL_BASE}/history?${sp.toString()}`, accessToken);
}

export function gmailWatch(
  accessToken: string,
  topicName: string,
  opts?: { labelIds?: string[]; labelFilterBehavior?: "include" | "exclude" },
): Promise<{ historyId: string; expiration: string }> {
  return googleFetch(`${GMAIL_BASE}/watch`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topicName,
      labelIds: opts?.labelIds ?? ["INBOX"],
      labelFilterBehavior: opts?.labelFilterBehavior ?? "include",
    }),
  });
}

export function gmailStopWatch(accessToken: string): Promise<null> {
  return googleFetch(`${GMAIL_BASE}/stop`, accessToken, { method: "POST" });
}


const GMAIL_BATCH_URL = "https://gmail.googleapis.com/batch/gmail/v1";

async function gmailBatchGet(
  accessToken: string,
  ids: string[],
  costPerItem: number,
  buildPath: (id: string) => string,
): Promise<Array<{ id: string; data: any; error?: string }>> {
  if (ids.length === 0) return [];

  const maxIdsPerBatch = Math.max(
    1,
    Math.min(100, Math.floor(MAX_BATCH_QUOTA_COST / costPerItem)),
  );
  if (ids.length > maxIdsPerBatch) {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += maxIdsPerBatch) {
      chunks.push(ids.slice(i, i + maxIdsPerBatch));
    }
    const results: Array<{ id: string; data: any; error?: string }> = [];
    for (const chunk of chunks) {
      const part = await gmailBatchGet(
        accessToken,
        chunk,
        costPerItem,
        buildPath,
      );
      results.push(...part);
    }
    return results;
  }

  const remaining = isInCooldown(accessToken);
  if (remaining > 0) {
    throw new GmailQuotaCooldownError(
      quotaCooldownMessage(remaining),
      remaining,
    );
  }

  // Pre-pay the whole batch so the token bucket sees real cost instead of a
  await acquireQuota(accessToken, ids.length * costPerItem);

  const boundary = `batch_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const CRLF = "\r\n";

  const parts: string[] = [];
  ids.forEach((id, i) => {
    parts.push(
      `--${boundary}${CRLF}` +
        `Content-Type: application/http${CRLF}` +
        `Content-ID: <part-${i}>${CRLF}${CRLF}` +
        `GET ${buildPath(id)}${CRLF}${CRLF}`,
    );
  });
  parts.push(`--${boundary}--${CRLF}`);
  const body = parts.join("");

  const res = await fetch(GMAIL_BATCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* body is multipart or plain text — fine */
    }
    if (isQuotaError(res.status, parsed)) {
      const cooldownMs = parseRetryAfterMs(res.headers) ?? QUOTA_COOLDOWN_MS;
      const effectiveCooldownMs = tripCooldown(accessToken, cooldownMs);
      throw new GmailQuotaCooldownError(
        quotaCooldownMessage(effectiveCooldownMs),
        effectiveCooldownMs,
      );
    }
    throw new Error(
      `Google API error (${res.status}): Gmail batch failed: ${text || res.statusText}`,
    );
  }

  const ct = res.headers.get("content-type") || "";
  const m = ct.match(/boundary=([^;]+)/i);
  const respBoundary = m?.[1]?.trim().replace(/^"|"$/g, "");
  const respText = await res.text();

  if (!respBoundary) {
    throw new Error(
      `Google API error: Gmail batch response missing boundary (Content-Type: ${ct})`,
    );
  }

  const parsed = parseBatchResponse(respText, respBoundary, ids);
  const quotaPart = parsed.find((part) => isQuotaErrorText(part.error));
  if (quotaPart) {
    tripCooldown(accessToken);
    throw new GmailQuotaCooldownError(
      quotaCooldownMessage(),
      QUOTA_COOLDOWN_MS,
    );
  }
  return parsed;
}

export async function gmailBatchGetMessages(
  accessToken: string,
  ids: string[],
  format?: "full" | "metadata" | "minimal",
): Promise<Array<{ id: string; data: any; error?: string }>> {
  const formatQs = format ? `?format=${format}` : "";
  return gmailBatchGet(
    accessToken,
    ids,
    5,
    (id) => `/gmail/v1/users/me/messages/${encodeURIComponent(id)}${formatQs}`,
  );
}

export async function gmailBatchGetThreads(
  accessToken: string,
  ids: string[],
  format?: "full" | "metadata" | "minimal",
  metadataHeaders?: string[],
): Promise<Array<{ id: string; data: any; error?: string }>> {
  const query = metadataQs(format, metadataHeaders);
  return gmailBatchGet(
    accessToken,
    ids,
    10,
    (id) => `/gmail/v1/users/me/threads/${encodeURIComponent(id)}${query}`,
  );
}

function parseBatchResponse(
  text: string,
  boundary: string,
  ids: string[],
): Array<{ id: string; data: any; error?: string }> {
  const results: Array<{ id: string; data: any; error?: string }> = ids.map(
    (id) => ({ id, data: null, error: "No response part" }),
  );

  const marker = `--${boundary}`;
  const rawParts = text.split(marker);
  for (const raw of rawParts) {
    const part = raw.replace(/^\r?\n/, "");
    if (!part || part.startsWith("--")) continue;

    const headerEnd = part.search(/\r?\n\r?\n/);
    if (headerEnd < 0) continue;
    const partHeaders = part.slice(0, headerEnd);
    const rest = part.slice(headerEnd).replace(/^\r?\n\r?\n/, "");

    const cidMatch =
      partHeaders.match(/Content-ID:\s*<?response-part-(\d+)>?/i) ||
      partHeaders.match(/Content-ID:\s*<?part-(\d+)>?/i);
    const idx = cidMatch ? Number(cidMatch[1]) : -1;

    const statusMatch = rest.match(/^HTTP\/[\d.]+\s+(\d+)/);
    const status = statusMatch ? Number(statusMatch[1]) : 0;

    const innerHeaderEnd = rest.search(/\r?\n\r?\n/);
    const innerBody =
      innerHeaderEnd >= 0
        ? rest
            .slice(innerHeaderEnd)
            .replace(/^\r?\n\r?\n/, "")
            .trimEnd()
        : "";

    const slot =
      idx >= 0 && idx < ids.length
        ? idx
        : results.findIndex((r) => r.error === "No response part");
    if (slot < 0 || slot >= ids.length) continue;

    if (!statusMatch) {
      results[slot] = {
        id: ids[slot],
        data: null,
        error: "Missing status line in batch part",
      };
      continue;
    }

    let parsed: any = null;
    if (innerBody) {
      try {
        parsed = JSON.parse(innerBody);
      } catch (e: any) {
        results[slot] = {
          id: ids[slot],
          data: null,
          error: `Failed to parse JSON: ${e?.message || String(e)}`,
        };
        continue;
      }
    }

    if (status >= 200 && status < 300) {
      results[slot] = { id: ids[slot], data: parsed };
    } else {
      const msg =
        parsed?.error?.message || parsed?.error_description || `HTTP ${status}`;
      results[slot] = {
        id: ids[slot],
        data: null,
        error: `HTTP ${status}: ${msg}`,
      };
    }
  }

  return results;
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
