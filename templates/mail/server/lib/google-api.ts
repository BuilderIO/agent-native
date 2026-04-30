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
        // Include both the OAuth `error` code (e.g. `invalid_grant`,
        // `unauthorized_client`) and `error_description` so callers can
        // pattern-match on the canonical code — Google often returns a
        // generic description ("Unauthorized") that hides which permanent
        // failure we actually hit.
        const code = (data as any).error;
        const desc = (data as any).error_description;
        const detail =
          code && desc
            ? `${code}: ${desc}`
            : code || desc || res.statusText;
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
        // Same rationale as getToken: surface the OAuth `error` code so
        // isPermanentRefreshError can detect invalid_grant /
        // unauthorized_client / invalid_client and self-heal the row.
        const code = (data as any).error;
        const desc = (data as any).error_description;
        const detail =
          code && desc
            ? `${code}: ${desc}`
            : code || desc || res.statusText;
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

// ---------------------------------------------------------------------------
// Authenticated fetch helper
// ---------------------------------------------------------------------------

// Per-token circuit breaker. Gmail's per-user-per-minute quota is easy to trip
// on multi-account or multi-tab setups. When we hit a quota error, we pause
// all calls for this token briefly so the per-minute window can refill and
// subsequent requests don't pile on top of an already-exhausted quota.
const QUOTA_COOLDOWN_MS = 45_000;
const tokenCooldowns = new Map<string, number>();

function cooldownKey(accessToken: string): string {
  // Fingerprint the token so we don't keep the whole secret in memory keys.
  // Last 12 chars are high-entropy and stable for the token's lifetime.
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

function tripCooldown(accessToken: string) {
  tokenCooldowns.set(cooldownKey(accessToken), Date.now() + QUOTA_COOLDOWN_MS);
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

// ---------------------------------------------------------------------------
// Proactive per-token quota bucket
// ---------------------------------------------------------------------------
// Gmail's per-user quota is 250 units/second. We run a token bucket below
// that (240/s refill, 480 capacity) so a burst can briefly exceed the steady
// rate while the long-run average still lands under the cap. This sits in
// FRONT of the circuit breaker — the breaker only trips when Google actually
// returns a 429/403-quota; the bucket's job is to make that rare.
const BUCKET_REFILL_PER_SEC = 240;
const BUCKET_CAPACITY = 480;

// Cost table from https://developers.google.com/gmail/api/reference/quota.
// Most-specific patterns first — `estimateRequestCost` walks this in order.
const COST_TABLE: Array<[RegExp, number, RegExp?]> = [
  // Gmail — send (expensive)
  [/\/gmail\/v1\/users\/[^/]+\/messages\/send/, 100, /^POST$/i],
  // Gmail — watch / stop
  [/\/gmail\/v1\/users\/[^/]+\/watch/, 100, /^POST$/i],
  [/\/gmail\/v1\/users\/[^/]+\/stop/, 50, /^POST$/i],
  // Gmail — thread modify / trash / untrash
  [/\/gmail\/v1\/users\/[^/]+\/threads\/[^/]+\/modify/, 10, /^POST$/i],
  [
    /\/gmail\/v1\/users\/[^/]+\/threads\/[^/]+\/(?:trash|untrash)/,
    10,
    /^POST$/i,
  ],
  // Gmail — message modify / trash / untrash
  [/\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+\/modify/, 5, /^POST$/i],
  [
    /\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+\/(?:trash|untrash)/,
    5,
    /^POST$/i,
  ],
  // Gmail — attachments
  [
    /\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+\/attachments\/[^/]+/,
    5,
    /^GET$/i,
  ],
  // Gmail — history
  [/\/gmail\/v1\/users\/[^/]+\/history/, 2, /^GET$/i],
  // Gmail — labels (list + create share the same endpoint; same cost)
  [/\/gmail\/v1\/users\/[^/]+\/labels(?:\/|$|\?)/, 5],
  // Gmail — profile
  [/\/gmail\/v1\/users\/[^/]+\/profile/, 1, /^GET$/i],
  // Gmail — single thread get (before list pattern so it wins)
  [/\/gmail\/v1\/users\/[^/]+\/threads\/[^/]+(?:$|\?)/, 10, /^GET$/i],
  // Gmail — threads list
  [/\/gmail\/v1\/users\/[^/]+\/threads(?:\/|$|\?)/, 10, /^GET$/i],
  // Gmail — single message get
  [/\/gmail\/v1\/users\/[^/]+\/messages\/[^/]+(?:$|\?)/, 5, /^GET$/i],
  // Gmail — messages list
  [/\/gmail\/v1\/users\/[^/]+\/messages(?:\/|$|\?)/, 5, /^GET$/i],
];

export function estimateRequestCost(url: string, method: string): number {
  for (const [pattern, cost, methodPattern] of COST_TABLE) {
    if (methodPattern && !methodPattern.test(method)) continue;
    if (pattern.test(url)) return cost;
  }
  // Calendar / People / anything else — default to 5. Harmless since those
  // APIs have separate quotas; the bucket just adds a light global smoother.
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
  // Cap cost at capacity so a single too-big request doesn't deadlock —
  // we'll still effectively pay the full cost via the refill wait.
  const want = Math.min(cost, BUCKET_CAPACITY);
  while (true) {
    refillBucket(b);
    if (b.tokens >= want) {
      b.tokens -= want;
      return;
    }
    const deficit = want - b.tokens;
    const waitMs = Math.ceil((deficit / BUCKET_REFILL_PER_SEC) * 1000);
    await new Promise((r) => setTimeout(r, Math.max(waitMs, 10)));
  }
}

export async function googleFetch(
  url: string,
  accessToken: string,
  opts?: RequestInit,
): Promise<any> {
  // Short-circuit while the token is cooling down from a recent quota hit.
  // Surface as a quota error so callers can degrade gracefully instead of
  // hammering Google and deepening the rate-limit state.
  const remaining = isInCooldown(accessToken);
  if (remaining > 0) {
    throw new Error(
      `Google API error (429): Rate limit cooldown, retry in ${Math.ceil(remaining / 1000)}s`,
    );
  }

  const maxRetries = 3;

  // Pre-pay the bucket once per call; retries don't re-charge (Google didn't
  // actually complete the work, and we'd rather retry promptly than stack
  // waits on top of backoff).
  await acquireQuota(
    accessToken,
    estimateRequestCost(url, opts?.method || "GET"),
  );

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = new Headers(opts?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);

    const res = await fetch(url, { ...opts, headers });

    // 204 No Content — return null
    if (res.status === 204) return null;

    // Parse body early when we might need it for quota-error classification.
    // 503 has no body worth inspecting; short-circuit to the retry path.
    if (res.status === 503 && attempt < maxRetries) {
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const data = res.status !== 503 ? await res.json().catch(() => null) : null;

    // 429 or 403-with-quota-reason — retry a couple times with backoff, then
    // trip the per-token circuit breaker so subsequent requests fast-fail.
    if (!res.ok && isQuotaError(res.status, data) && attempt < maxRetries - 1) {
      const delay = Math.min(1500 * 2 ** attempt, 8000);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) {
      if (isQuotaError(res.status, data)) tripCooldown(accessToken);
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

export function gmailListHistory(
  accessToken: string,
  params: {
    startHistoryId: string;
    historyTypes?: string[];
    labelId?: string;
    maxResults?: number;
  },
) {
  // Gmail's users.history.list expects `historyTypes` as repeated query
  // params (e.g. ...&historyTypes=messageAdded&historyTypes=labelAdded),
  // not a single comma-joined value — the API returns 400 "Invalid value"
  // otherwise. URLSearchParams.append handles repetition.
  const sp = new URLSearchParams();
  sp.set("startHistoryId", params.startHistoryId);
  if (params.labelId) sp.set("labelId", params.labelId);
  if (params.maxResults !== undefined) {
    sp.set("maxResults", String(params.maxResults));
  }
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

// ---------------------------------------------------------------------------
// Gmail batch endpoint
// ---------------------------------------------------------------------------
// One HTTP round-trip for up to 100 messages.get calls. Huge win vs N serial
// requests but still counts as N*cost against per-user quota — so we pre-pay
// the bucket before firing, and caller can pre-pay further upstream using
// `acquireQuota(token, ids.length * 5)` if they want to pace batch calls.

const GMAIL_BATCH_URL = "https://gmail.googleapis.com/batch/gmail/v1";

export async function gmailBatchGetMessages(
  accessToken: string,
  ids: string[],
  format?: "full" | "metadata" | "minimal",
): Promise<Array<{ id: string; data: any | null; error?: string }>> {
  if (ids.length === 0) return [];

  // Gmail batch limit is 100; chunk and concatenate to stay under it.
  if (ids.length > 100) {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) {
      chunks.push(ids.slice(i, i + 100));
    }
    const results: Array<{ id: string; data: any | null; error?: string }> = [];
    for (const chunk of chunks) {
      const part = await gmailBatchGetMessages(accessToken, chunk, format);
      results.push(...part);
    }
    return results;
  }

  // Respect the circuit breaker like googleFetch does.
  const remaining = isInCooldown(accessToken);
  if (remaining > 0) {
    throw new Error(
      `Google API error (429): Rate limit cooldown, retry in ${Math.ceil(remaining / 1000)}s`,
    );
  }

  // Each messages.get is 5 units — pre-pay the whole batch so the bucket
  // sees real cost instead of a single cheap-looking request.
  await acquireQuota(accessToken, ids.length * 5);

  const boundary = `batch_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const CRLF = "\r\n";
  const formatQs = format ? `?format=${format}` : "";

  const parts: string[] = [];
  ids.forEach((id, i) => {
    parts.push(
      `--${boundary}${CRLF}` +
        `Content-Type: application/http${CRLF}` +
        `Content-ID: <part-${i}>${CRLF}${CRLF}` +
        `GET /gmail/v1/users/me/messages/${encodeURIComponent(id)}${formatQs}${CRLF}${CRLF}`,
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
    // Trip circuit breaker on quota errors just like googleFetch.
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* body is multipart or plain text — fine */
    }
    if (isQuotaError(res.status, parsed)) tripCooldown(accessToken);
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

  return parseBatchResponse(respText, respBoundary, ids);
}

function parseBatchResponse(
  text: string,
  boundary: string,
  ids: string[],
): Array<{ id: string; data: any | null; error?: string }> {
  const results: Array<{ id: string; data: any | null; error?: string }> =
    ids.map((id) => ({ id, data: null, error: "No response part" }));

  // Split on boundary. Parts can use --boundary with CRLF or LF endings;
  // we normalize by splitting on "--<boundary>" and trimming the trailing
  // "--" marker.
  const marker = `--${boundary}`;
  const rawParts = text.split(marker);
  // First element is preamble, last is "--\r\n" epilogue — both ignorable.
  for (const raw of rawParts) {
    const part = raw.replace(/^\r?\n/, "");
    if (!part || part.startsWith("--")) continue;

    // Split part headers from inner HTTP message on first blank line.
    const headerEnd = part.search(/\r?\n\r?\n/);
    if (headerEnd < 0) continue;
    const partHeaders = part.slice(0, headerEnd);
    const rest = part.slice(headerEnd).replace(/^\r?\n\r?\n/, "");

    // Pull Content-ID to map back to the original id slot.
    const cidMatch =
      partHeaders.match(/Content-ID:\s*<?response-part-(\d+)>?/i) ||
      partHeaders.match(/Content-ID:\s*<?part-(\d+)>?/i);
    const idx = cidMatch ? Number(cidMatch[1]) : -1;

    // Inside `rest`: status line, inner headers, blank line, body.
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
      results[slot] = { id: ids[slot], data: null, error: msg };
    }
  }

  return results;
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
