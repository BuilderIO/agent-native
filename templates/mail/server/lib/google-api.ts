import {
  acquireGmailQuota,
  GmailQuotaAccountUnavailableError,
  GmailQuotaCooldownError,
  markGmailQuotaSuccess,
  tripGmailQuotaCooldown,
  type GmailQuotaLane,
} from "./gmail-quota.js";

export { GmailQuotaCooldownError } from "./gmail-quota.js";
export { registerGmailAccountToken } from "./gmail-quota.js";

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
      let data: any;
      try {
        data = await res.json();
      } catch (error) {
        if (res.ok) throw error;
      }
      if (!res.ok) {
        const code = data?.error;
        const desc = data?.error_description;
        const detail =
          code && desc ? `${code}: ${desc}` : code || desc || res.statusText;
        const error = new Error(`OAuth token refresh failed: ${detail}`);
        Object.assign(error, { status: res.status });
        throw error;
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

const QUOTA_COOLDOWN_MS = 1_000;

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

const COST_TABLE: Array<[RegExp, number, RegExp?]> = [
  [/\/messages\/send(?:\?|$)/, 100, /^POST$/i],
  [/\/watch(?:\?|$)/, 100, /^POST$/i],
  [/\/stop(?:\?|$)/, 50, /^POST$/i],
  [/\/messages\/batchModify(?:\?|$)/, 50, /^POST$/i],
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
  [/\/history(?:\?|$)/, 2, /^GET$/i],
  [/\/labels(?:\?|$)/, 1, /^GET$/i],
  [/\/labels\/[^/?]+(?:\?|$)/, 1, /^GET$/i],
  [/\/gmail\/v1\/users\/[^/]+\/settings\/filters(?:\/|$|\?)/, 5],
  [/\/profile(?:\?|$)/, 1, /^GET$/i],
  [/\/threads\/[^/?]+(?:\?|$)/, 40, /^GET$/i],
  [/\/threads(?:\?|$)/, 10, /^GET$/i],
  [/\/messages\/[^/?]+(?:\?|$)/, 20, /^GET$/i],
  [/\/messages(?:\?|$)/, 5, /^GET$/i],
  [/\/messages\/[^/?]+\/attachments\/[^/?]+(?:\?|$)/, 5, /^GET$/i],
];

export function estimateRequestCost(url: string, method: string): number {
  for (const [pattern, cost, methodPattern] of COST_TABLE) {
    if (methodPattern && !methodPattern.test(method)) continue;
    if (pattern.test(url)) return cost;
  }
  return 5;
}

function waitWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

type GoogleFetchOptions = RequestInit & {
  onRequestStart?: () => Promise<void>;
  onRequestCancelled?: () => Promise<void>;
};

function makeGoogleRequestAggregateError(
  errors: Iterable<unknown>,
  message: string,
): Error {
  const NativeAggregateError = (
    globalThis as unknown as {
      AggregateError: new (errors: Iterable<unknown>, message: string) => Error;
    }
  ).AggregateError;
  return new NativeAggregateError(errors, message);
}

async function markSuccessfulGmailRequest(
  accessToken: string,
  clearCooldown: boolean,
): Promise<void> {
  try {
    await markGmailQuotaSuccess(accessToken, clearCooldown);
  } catch (error) {
    console.warn(
      "[gmail-quota] Failed to clear cooldown after a successful request:",
      error,
    );
  }
}

export async function googleFetch(
  url: string,
  accessToken: string,
  opts?: GoogleFetchOptions,
  lane: GmailQuotaLane = "interactive",
  allowUnregisteredProfile = false,
): Promise<any> {
  const { onRequestStart, onRequestCancelled, ...requestOptions } = opts ?? {};
  const signal = requestOptions.signal ?? undefined;
  signal?.throwIfAborted();
  const maxRetries = 3;
  const method = requestOptions.method?.toUpperCase() ?? "GET";
  const canRetry = method === "GET" || method === "HEAD";
  const gmailRequest = url.includes("gmail.googleapis.com");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    signal?.throwIfAborted();
    let clearCooldownAfterSuccess = false;
    if (gmailRequest) {
      try {
        clearCooldownAfterSuccess = await acquireGmailQuota(
          accessToken,
          estimateRequestCost(url, method),
          lane,
        );
      } catch (error) {
        const profileBootstrap =
          allowUnregisteredProfile &&
          url.endsWith("/profile") &&
          error instanceof GmailQuotaAccountUnavailableError;
        if (!profileBootstrap) throw error;
      }
      signal?.throwIfAborted();
    }

    if (onRequestStart) {
      await onRequestStart();
      if (signal?.aborted) {
        try {
          await onRequestCancelled?.();
        } catch (releaseError) {
          throw makeGoogleRequestAggregateError(
            [signal.reason, releaseError],
            "Google request was cancelled before dispatch and its claim could not be released.",
          );
        }
        signal.throwIfAborted();
      }
    }

    const headers = new Headers(requestOptions.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    const res = await fetch(url, { ...requestOptions, headers });

    if (res.status === 204) {
      if (gmailRequest) {
        await markSuccessfulGmailRequest(
          accessToken,
          clearCooldownAfterSuccess,
        );
      }
      return null;
    }

    if (
      canRetry &&
      (res.status === 500 || res.status === 502 || res.status === 503) &&
      attempt < maxRetries
    ) {
      await waitWithSignal(Math.min(1000 * 2 ** attempt, 8000), signal);
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
      let effectiveCooldownMs = cooldownMs;
      try {
        effectiveCooldownMs = await tripGmailQuotaCooldown(
          accessToken,
          cooldownMs,
        );
      } catch (error) {
        if (!(error instanceof GmailQuotaAccountUnavailableError)) throw error;
      }
      throw new GmailQuotaCooldownError(effectiveCooldownMs);
    }

    if (!res.ok) {
      const msg =
        (data as any)?.error?.message ||
        (data as any)?.error_description ||
        res.statusText;
      throw new Error(`Google API error (${res.status}): ${msg}`);
    }

    if (gmailRequest) {
      await markSuccessfulGmailRequest(accessToken, clearCooldownAfterSuccess);
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

export function gmailGetProfile(
  accessToken: string,
  lane: GmailQuotaLane = "interactive",
  allowUnregisteredProfile = false,
  signal?: AbortSignal,
) {
  return googleFetch(
    `${GMAIL_BASE}/profile`,
    accessToken,
    { signal },
    lane,
    allowUnregisteredProfile,
  );
}

export function gmailListMessages(
  accessToken: string,
  params: { q?: string; maxResults?: number; pageToken?: string } = {},
  lane: GmailQuotaLane = "interactive",
  signal?: AbortSignal,
) {
  return googleFetch(
    `${GMAIL_BASE}/messages${qs(params)}`,
    accessToken,
    { signal },
    lane,
  );
}

export function gmailListThreads(
  accessToken: string,
  params: { q?: string; maxResults?: number; pageToken?: string } = {},
  lane: GmailQuotaLane = "interactive",
) {
  return googleFetch(
    `${GMAIL_BASE}/threads${qs(params)}`,
    accessToken,
    undefined,
    lane,
  );
}

export function gmailGetMessage(
  accessToken: string,
  id: string,
  format?: "full" | "metadata" | "minimal",
  lane: GmailQuotaLane = "interactive",
  signal?: AbortSignal,
) {
  return googleFetch(
    `${GMAIL_BASE}/messages/${id}${qs({ format })}`,
    accessToken,
    { signal },
    lane,
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
  lane: GmailQuotaLane = "interactive",
  signal?: AbortSignal,
) {
  return googleFetch(
    `${GMAIL_BASE}/messages/${id}/modify`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
      signal,
    },
    lane,
  );
}

export function gmailModifyThread(
  accessToken: string,
  threadId: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
  signal?: AbortSignal,
) {
  return googleFetch(`${GMAIL_BASE}/threads/${threadId}/modify`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
    signal,
  });
}

export function gmailTrashMessage(
  accessToken: string,
  id: string,
  lane: GmailQuotaLane = "interactive",
  signal?: AbortSignal,
) {
  return googleFetch(
    `${GMAIL_BASE}/messages/${id}/trash`,
    accessToken,
    { method: "POST", signal },
    lane,
  );
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
  lane: GmailQuotaLane = "interactive",
  signal?: AbortSignal,
) {
  return googleFetch(
    `${GMAIL_BASE}/threads/${id}${metadataQs(format, metadataHeaders)}`,
    accessToken,
    { signal },
    lane,
  );
}

export function gmailListLabels(
  accessToken: string,
  lane: GmailQuotaLane = "interactive",
  signal?: AbortSignal,
) {
  return googleFetch(`${GMAIL_BASE}/labels`, accessToken, { signal }, lane);
}

export function gmailCreateLabel(
  accessToken: string,
  name: string,
  opts?: {
    labelListVisibility?: string;
    messageListVisibility?: string;
  },
  lane: GmailQuotaLane = "interactive",
  signal?: AbortSignal,
) {
  return googleFetch(
    `${GMAIL_BASE}/labels`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        labelListVisibility: opts?.labelListVisibility ?? "labelShow",
        messageListVisibility: opts?.messageListVisibility ?? "show",
      }),
      signal,
    },
    lane,
  );
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
  lane: GmailQuotaLane = "interactive",
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams();
  sp.set("startHistoryId", params.startHistoryId);
  if (params.labelId) sp.set("labelId", params.labelId);
  if (params.maxResults !== undefined) {
    sp.set("maxResults", String(params.maxResults));
  }
  if (params.pageToken) sp.set("pageToken", params.pageToken);
  for (const t of params.historyTypes || []) sp.append("historyTypes", t);
  return googleFetch(
    `${GMAIL_BASE}/history?${sp.toString()}`,
    accessToken,
    { signal },
    lane,
  );
}

export function gmailWatch(
  accessToken: string,
  topicName: string,
  opts?: {
    labelIds?: string[];
    labelFilterBehavior?: "include" | "exclude";
    signal?: AbortSignal;
  },
): Promise<{ historyId: string; expiration: string }> {
  return googleFetch(`${GMAIL_BASE}/watch`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topicName,
      labelIds: opts?.labelIds ?? ["INBOX"],
      labelFilterBehavior: opts?.labelFilterBehavior ?? "include",
    }),
    signal: opts?.signal,
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
  lane: GmailQuotaLane,
  signal?: AbortSignal,
): Promise<Array<{ id: string; data: any; error?: string }>> {
  signal?.throwIfAborted();
  if (ids.length === 0) return [];

  const maxIdsPerBatch = 50;
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
        lane,
        signal,
      );
      results.push(...part);
    }
    return results;
  }

  const clearCooldownAfterSuccess = await acquireGmailQuota(
    accessToken,
    ids.length * costPerItem,
    lane,
  );
  signal?.throwIfAborted();

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
    signal,
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
      const effectiveCooldownMs = await tripGmailQuotaCooldown(
        accessToken,
        cooldownMs,
      );
      throw new GmailQuotaCooldownError(effectiveCooldownMs);
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
    const cooldownMs = await tripGmailQuotaCooldown(
      accessToken,
      QUOTA_COOLDOWN_MS,
    );
    throw new GmailQuotaCooldownError(cooldownMs);
  }
  await markSuccessfulGmailRequest(accessToken, clearCooldownAfterSuccess);
  return parsed;
}

export async function gmailBatchGetMessages(
  accessToken: string,
  ids: string[],
  format?: "full" | "metadata" | "minimal",
  lane: GmailQuotaLane = "interactive",
  signal?: AbortSignal,
): Promise<Array<{ id: string; data: any; error?: string }>> {
  const formatQs = format ? `?format=${format}` : "";
  return gmailBatchGet(
    accessToken,
    ids,
    20,
    (id) => `/gmail/v1/users/me/messages/${encodeURIComponent(id)}${formatQs}`,
    lane,
    signal,
  );
}

export async function gmailBatchGetThreads(
  accessToken: string,
  ids: string[],
  format?: "full" | "metadata" | "minimal",
  metadataHeaders?: string[],
  lane: GmailQuotaLane = "interactive",
): Promise<Array<{ id: string; data: any; error?: string }>> {
  const query = metadataQs(format, metadataHeaders);
  return gmailBatchGet(
    accessToken,
    ids,
    40,
    (id) => `/gmail/v1/users/me/threads/${encodeURIComponent(id)}${query}`,
    lane,
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
