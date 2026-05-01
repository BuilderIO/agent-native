import {
  createOAuth2Client,
  gmailGetProfile,
  gmailGetMessage,
  gmailGetThread,
  gmailListMessages,
  gmailListThreads,
  gmailBatchGetMessages,
  gmailBatchGetThreads,
  gmailListHistory,
  gmailListLabels,
  gmailWatch,
  gmailStopWatch,
  peopleGetProfile,
} from "./google-api.js";
import {
  getOAuthTokens,
  saveOAuthTokens,
  deleteOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
  hasOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { isOAuthConnected, getOAuthAccounts } from "@agent-native/core/server";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

function getOAuth2Credentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Get a valid access token for the given stored tokens, refreshing if expired.
 * Returns the (possibly refreshed) access token and updates stored tokens if refreshed.
 */
/**
 * Permanent OAuth refresh failures Google can return. When we hit one of
 * these, the refresh_token is dead — keeping the row around makes
 * `getAuthStatus` lie ("connected": true) and `listEmails` silently return
 * an empty list (no clients, no surfaced errors). Drop the row so the UI
 * shows the "Connect Google" banner instead of an empty inbox.
 *
 * Causes we've seen:
 * - `invalid_grant`: user revoked access, password changed, or token aged out
 * - `unauthorized_client`: the app's GOOGLE_CLIENT_ID was rotated in env;
 *   tokens issued by the old client cannot be refreshed by the new one
 * - `invalid_client`: client_id/secret mismatch
 */
const PERMANENT_REFRESH_ERRORS = [
  "invalid_grant",
  "unauthorized_client",
  "invalid_client",
];

function isPermanentRefreshError(message: string): boolean {
  const m = message.toLowerCase();
  return PERMANENT_REFRESH_ERRORS.some((code) => m.includes(code));
}

async function getValidAccessToken(
  accountId: string,
  tokens: GoogleTokens,
  owner?: string,
): Promise<string> {
  // If token is not expired (with 5-minute buffer), return it directly
  if (
    tokens.expiry_date &&
    tokens.access_token &&
    Date.now() < tokens.expiry_date - 5 * 60 * 1000
  ) {
    return tokens.access_token;
  }

  // Token is expired or about to expire — refresh it
  if (!tokens.refresh_token) {
    // No refresh_token means we can never recover this account; drop it so
    // the UI prompts a reconnect instead of showing a permanently-broken row.
    await deleteOAuthTokens("google", accountId);
    throw new Error(
      `No refresh token available for ${accountId} — please reconnect.`,
    );
  }

  const { clientId, clientSecret } = getOAuth2Credentials();
  const redirectUri = "http://localhost:8080/_agent-native/google/callback";
  const oauth2 = createOAuth2Client(clientId, clientSecret, redirectUri);
  let refreshed;
  try {
    refreshed = await oauth2.refreshToken(tokens.refresh_token);
  } catch (err: any) {
    if (isPermanentRefreshError(err?.message || "")) {
      // Drop the dead row so isOAuthConnected returns false and the UI
      // surfaces the connect banner instead of an empty-inbox illusion.
      await deleteOAuthTokens("google", accountId);
      throw err;
    }
    // Transient failure (network hiccup, 5xx, timeout). If the existing
    // token hasn't actually expired yet — we only entered this path
    // because we're inside the 5-minute pre-expiry buffer — fall back to
    // it so a flaky moment doesn't 502 the inbox.
    if (
      tokens.access_token &&
      tokens.expiry_date &&
      Date.now() < tokens.expiry_date
    ) {
      return tokens.access_token;
    }
    throw err;
  }

  const updatedTokens: GoogleTokens = {
    ...tokens,
    access_token: refreshed.access_token,
    expiry_date: Date.now() + refreshed.expires_in * 1000,
    token_type: refreshed.token_type,
    scope: refreshed.scope,
  };

  await saveOAuthTokens(
    "google",
    accountId,
    updatedTokens as unknown as Record<string, unknown>,
    owner,
  );

  return refreshed.access_token;
}

export function getAuthUrl(
  origin?: string,
  redirectUri?: string,
  state?: string,
): string {
  const { clientId, clientSecret } = getOAuth2Credentials();
  const uri =
    redirectUri ||
    (origin
      ? `${origin}/_agent-native/google/callback`
      : "http://localhost:8080/_agent-native/google/callback");
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

function getWatchTopic(): string | null {
  return process.env.GMAIL_WATCH_TOPIC || null;
}

// Start a Gmail watch for the given access token. No-op when
// GMAIL_WATCH_TOPIC env is unset (push isn't configured for this deploy).
export async function startWatch(
  accessToken: string,
): Promise<{ historyId: string; expiration: string } | null> {
  const topic = getWatchTopic();
  if (!topic) return null;
  try {
    const res = await gmailWatch(accessToken, topic, {
      labelIds: ["INBOX"],
      labelFilterBehavior: "include",
    });
    return res;
  } catch (err: any) {
    console.warn(`[gmail-watch] start failed: ${err.message}`);
    return null;
  }
}

export async function stopWatch(accessToken: string): Promise<void> {
  if (!getWatchTopic()) return;
  try {
    await gmailStopWatch(accessToken);
  } catch (err: any) {
    console.warn(`[gmail-watch] stop failed: ${err.message}`);
  }
}

export async function exchangeCode(
  code: string,
  origin?: string,
  redirectUri?: string,
  owner?: string,
): Promise<string> {
  const { clientId, clientSecret } = getOAuth2Credentials();
  const uri =
    redirectUri ||
    (origin
      ? `${origin}/_agent-native/google/callback`
      : "http://localhost:8080/_agent-native/google/callback");
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri);
  const tokenResponse = await oauth2.getToken(code);

  const tokens: GoogleTokens = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expiry_date: Date.now() + tokenResponse.expires_in * 1000,
    token_type: tokenResponse.token_type,
    scope: tokenResponse.scope,
  };

  // Determine the email address for this account
  const profile = await gmailGetProfile(tokens.access_token);
  const email = profile.emailAddress;
  if (!email) throw new Error("Google returned no email address");

  await saveOAuthTokens(
    "google",
    email,
    tokens as unknown as Record<string, unknown>,
    owner ?? email,
  );

  try {
    await startWatch(tokens.access_token);
  } catch (err: any) {
    console.warn(`[gmail-watch] start after OAuth failed: ${err.message}`);
  }

  return email;
}

export async function getClient(
  email: string | undefined,
): Promise<{ accessToken: string; email: string } | null> {
  if (!email) return null;
  const accounts = await listOAuthAccountsByOwner("google", email);
  if (accounts.length === 0) return null;

  const account = accounts.find((a) => a.accountId === email) ?? accounts[0];

  const tokens = account.tokens as unknown as GoogleTokens;
  if (!tokens) return null;

  const accountId = account.accountId;
  const accessToken = await getValidAccessToken(accountId, tokens, email);

  return { accessToken, email: accountId };
}

/**
 * Look up an OAuth client by accountId regardless of ownership.
 *
 * `getClient()` filters by owner, which works for a user's primary account
 * (where `owner === accountId`) but returns null for added secondary accounts
 * (where `owner` is the primary email). Background jobs that iterate
 * `listOAuthAccounts("google")` — notably Gmail watch renewal — need to
 * refresh tokens for every stored account, not just the primary of each
 * owner. This helper scans all accounts and uses the stored `owner` (falling
 * back to `accountId`) when persisting refreshed tokens.
 */
export async function getClientForAccount(
  accountId: string,
): Promise<{ accessToken: string; email: string } | null> {
  const all = await listOAuthAccounts("google");
  const account = all.find((a) => a.accountId === accountId);
  if (!account) return null;
  return getClientFromAccount(account);
}

/**
 * Same as getClientForAccount but takes a pre-fetched account object to
 * avoid re-calling listOAuthAccounts. Use this inside loops that already
 * have the accounts list loaded (watch renewal, bootstrap).
 */
export async function getClientFromAccount(account: {
  accountId: string;
  owner?: string;
  tokens: Record<string, unknown>;
}): Promise<{ accessToken: string; email: string } | null> {
  const tokens = account.tokens as unknown as GoogleTokens;
  if (!tokens) return null;

  const ownerForRefresh = account.owner ?? account.accountId;
  const accessToken = await getValidAccessToken(
    account.accountId,
    tokens,
    ownerForRefresh,
  );
  return { accessToken, email: account.accountId };
}

/**
 * Get OAuth credentials. When `forEmail` is provided, returns only that
 * user's credentials (multi-user mode). Otherwise returns an empty array.
 *
 * Refresh failures are swallowed per-account — the signature preserves
 * the "empty array means no usable client" contract that existing
 * callers (search-emails, view-screen, list-emails) rely on for graceful
 * "no Google account connected" fallbacks. Callers that need to surface
 * "all your tokens are dead" to the UI should use `getClientsWithErrors`
 * directly, which is already wired into `listGmailMessagesUncached`.
 */
export async function getClients(
  forEmail?: string,
): Promise<
  Array<{ email: string; accessToken: string; refreshToken: string }>
> {
  const { clients } = await getClientsWithErrors(forEmail);
  return clients;
}

/**
 * Same as `getClients`, but also returns per-account refresh errors so
 * callers can distinguish "no accounts connected" (empty errors) from
 * "all accounts failed to refresh" (errors populated). The mail list
 * handler uses this to return a 502 with the underlying reason instead
 * of silently rendering an empty inbox.
 */
export async function getClientsWithErrors(forEmail?: string): Promise<{
  clients: Array<{ email: string; accessToken: string; refreshToken: string }>;
  errors: Array<{ email: string; error: string }>;
}> {
  if (!forEmail) return { clients: [], errors: [] };
  const accounts = await listOAuthAccountsByOwner("google", forEmail);

  const clients: Array<{
    email: string;
    accessToken: string;
    refreshToken: string;
  }> = [];
  const errors: Array<{ email: string; error: string }> = [];

  for (const account of accounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    if (!tokens) continue;

    const accountId = account.accountId;
    // Preserve the stored owner on token refresh to avoid ownership conflicts
    const ownerForRefresh: string =
      forEmail ??
      ("owner" in account && typeof account.owner === "string"
        ? account.owner
        : undefined) ??
      accountId;

    try {
      const accessToken = await getValidAccessToken(
        accountId,
        tokens,
        ownerForRefresh,
      );

      clients.push({
        email: accountId,
        accessToken,
        refreshToken: tokens.refresh_token || "",
      });
    } catch (err: any) {
      errors.push({
        email: accountId,
        error: err?.message || "Unknown refresh error",
      });
    }
  }

  return { clients, errors };
}

/**
 * Check if a Google account is connected. When `forEmail` is provided,
 * checks only that specific account.
 */
export async function isConnected(forEmail?: string): Promise<boolean> {
  return isOAuthConnected("google", forEmail);
}

export async function getConnectedAccounts(
  forEmail?: string,
): Promise<string[]> {
  if (!forEmail) return [];
  const accounts = await listOAuthAccountsByOwner("google", forEmail);
  return accounts.map((a) => a.accountId);
}

export interface GoogleAuthStatus {
  connected: boolean;
  accounts: Array<{ email: string; expiresAt?: string; photoUrl?: string }>;
}

/**
 * Get the OAuth status. When `forEmail` is provided, only returns
 * status for that specific account (multi-user mode).
 */
export async function getAuthStatus(
  forEmail?: string,
): Promise<GoogleAuthStatus> {
  const oauthAccounts = await getOAuthAccounts("google", forEmail);

  if (oauthAccounts.length === 0) {
    return { connected: false, accounts: [] };
  }

  const accounts: Array<{
    email: string;
    expiresAt?: string;
    photoUrl?: string;
  }> = [];
  for (const account of oauthAccounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    if (!tokens) continue;
    const email = account.accountId;
    let photoUrl: string | undefined;
    try {
      const accessToken = await getValidAccessToken(email, tokens);
      const profile = await peopleGetProfile(accessToken, "photos");
      photoUrl = profile.photos?.[0]?.url ?? undefined;
    } catch {}
    accounts.push({
      email,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
      photoUrl,
    });
  }

  return {
    connected: accounts.length > 0,
    accounts,
  };
}

export async function disconnect(email?: string): Promise<void> {
  if (email) {
    try {
      const client = await getClient(email);
      if (client) await stopWatch(client.accessToken);
    } catch {
      // Tokens may already be revoked — skip stopping the watch.
    }
    await deleteOAuthTokens("google", email);
  } else {
    await deleteOAuthTokens("google");
  }
}

// Short-TTL cache + in-flight coalescing for multi-account list fetches.
// A single list call is 255 quota units (1 messages.list + 50 messages.get),
// and the client refetch cadence plus multi-tab use can easily fire three or
// four identical requests within a second. This layer absorbs those.
type ListResult = {
  messages: any[];
  errors: Array<{ email: string; error: string }>;
  nextPageTokens?: Record<string, string>;
  resultSizeEstimate?: number;
};

type ListMode = "messages" | "threads";

type ListOptions = {
  /**
   * Gmail's UI is thread-first. Thread mode uses users.threads.list so a
   * conversation with several messages does not consume several slots and hide
   * other conversations from the page.
   */
  mode?: ListMode;
  threadFormat?: "full" | "metadata" | "minimal";
};

const LIST_CACHE_TTL = 20_000;
const listCache = new Map<string, { result: ListResult; expiresAt: number }>();
const listInflight = new Map<string, Promise<ListResult>>();

function listCacheKey(
  query: string | undefined,
  maxResults: number,
  forEmail: string | undefined,
  pageTokens: Record<string, string> | undefined,
  options: ListOptions | undefined,
): string {
  const tokenPart = pageTokens
    ? Object.keys(pageTokens)
        .sort()
        .map((k) => `${k}:${pageTokens[k]}`)
        .join("|")
    : "";
  const queryPart = query === undefined ? "<default>" : query;
  return `${forEmail ?? ""}::${queryPart}::${maxResults}::${tokenPart}::${options?.mode ?? "messages"}::${options?.threadFormat ?? ""}`;
}

export async function listGmailMessages(
  query?: string,
  maxResults = 50,
  forEmail?: string,
  pageTokens?: Record<string, string>,
  options?: ListOptions,
): Promise<ListResult> {
  const key = listCacheKey(query, maxResults, forEmail, pageTokens, options);

  const cached = listCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const inflight = listInflight.get(key);
  if (inflight) return inflight;

  const promise = (async (): Promise<ListResult> => {
    const result = await listGmailMessagesUncached(
      query,
      maxResults,
      forEmail,
      pageTokens,
      options,
    );
    // Only cache successful responses. A full-failure result (empty + all
    // accounts errored) would lock the user out of retrying during the TTL.
    if (result.messages.length > 0 || result.errors.length === 0) {
      listCache.set(key, {
        result,
        expiresAt: Date.now() + LIST_CACHE_TTL,
      });
    }
    return result;
  })().finally(() => {
    listInflight.delete(key);
  });

  listInflight.set(key, promise);
  return promise;
}

// Invalidate all listCache entries that would have included the given owner's
// accounts. Called by the Pub/Sub push handler to surface changes to the UI
// faster than the 20s listCache TTL.
export function invalidateListCacheForOwner(ownerEmail: string): void {
  // listCache keys are formatted as `${forEmail}::...` — delete matches.
  const prefix = `${ownerEmail}::`;
  for (const key of listCache.keys()) {
    if (key.startsWith(prefix)) listCache.delete(key);
  }
}

// Per-(account, label) history cache. After the first hydrate we keep the
// fully-fetched messages in memory alongside Gmail's historyId. Subsequent
// calls use gmailListHistory to fetch only the delta since that historyId —
// dramatically cheaper than a full messages.list + per-id messages.get sweep
// (one list = ~5 units + 50 gets = 255 units; a delta with no changes is ~2
// units, and a typical delta with a handful of adds is 10–50 units).
type HistoryEntry = {
  historyId: string;
  messages: any[];
  // Pagination token from the initial hydrate's `messages.list` response.
  // Preserved across deltas so the frontend's infinite-query can still
  // page past the first window — otherwise the history-sync path would
  // cap the inbox at `maxResults` even when older messages exist.
  nextPageToken?: string;
  updatedAt: number;
};

const historyCache = new Map<string, HistoryEntry>();

// Bump historyCache watermark for an account so the next list call sees a
// fresh delta. Also triggers a re-hydrate if the account isn't cached yet.
// historyId is optional — if absent, the next delta call just uses the
// existing watermark; if present, we replace the watermark so the delta is
// bounded to "since Gmail told us something changed".
export function bumpHistoryWatermark(email: string, historyId?: string): void {
  if (!historyId) return;
  // Update every cached entry for this email (across different maxResults).
  const prefix = `${email}::`;
  for (const [key, entry] of historyCache.entries()) {
    if (!key.startsWith(prefix)) continue;
    // Only advance if the new historyId is strictly greater — don't regress.
    try {
      if (BigInt(historyId) > BigInt(entry.historyId)) {
        entry.historyId = historyId;
      }
    } catch {
      // Non-numeric historyIds — skip; delta will still work with stale.
    }
  }
}

// Per-key in-flight dedupe. Concurrent requests for the same
// (email, label, maxResults) tuple share one computation — avoids two
// callers both racing to apply a delta and stomping each other's cache
// writes (or one failing and deleting the cache another just rebuilt).
const historyInflight = new Map<
  string,
  Promise<{ messages: any[]; nextPageToken?: string }>
>();

// TTL + soft-cap eviction so long-lived servers don't hold full Gmail
// message payloads forever. 1h TTL plus a 200-entry cap covers typical
// multi-account setups; entries refresh on each successful fetch so
// active inboxes stay warm while abandoned ones fall out.
const HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;
const HISTORY_CACHE_MAX = 200;

function evictStaleHistoryCache(): void {
  const now = Date.now();
  for (const [key, entry] of historyCache) {
    if (now - entry.updatedAt > HISTORY_CACHE_TTL_MS) historyCache.delete(key);
  }
  if (historyCache.size <= HISTORY_CACHE_MAX) return;
  // Size-based LRU: drop the oldest-by-updatedAt until we're at cap.
  const entries = Array.from(historyCache.entries()).sort(
    (a, b) => a[1].updatedAt - b[1].updatedAt,
  );
  const toDrop = entries.length - HISTORY_CACHE_MAX;
  for (let i = 0; i < toDrop; i++) historyCache.delete(entries[i][0]);
}

function historyCacheKey(
  email: string,
  labelId: string,
  maxResults: number,
): string {
  return `${email}::${labelId}::${maxResults}`;
}

// history.list requires a single labelId filter, so free-form search queries
// and multi-label views can't use this path. For now, only the default inbox
// view (the highest-volume polling case) is eligible.
function historyLabelFor(query: string | undefined): string | null {
  const q = (query || "in:inbox").trim();
  if (q === "" || q === "in:inbox") return "INBOX";
  return null;
}

function isHistoryEligible(
  query: string | undefined,
  pageTokens: Record<string, string> | undefined,
): string | null {
  if (pageTokens && Object.keys(pageTokens).length > 0) return null;
  return historyLabelFor(query);
}

/**
 * Initial hydrate: do a full list + per-message fetch, but capture the
 * account's historyId from profile.get *before* listing so any changes
 * that land mid-hydrate are replayed on the next delta (adds dedup via
 * existingById; label mutations are idempotent set-union).
 */
async function hydrateAccountInbox(
  accessToken: string,
  email: string,
  query: string,
  maxResults: number,
): Promise<{ messages: any[]; historyId?: string; nextPageToken?: string }> {
  let historyId: string | undefined;
  try {
    const profile = await gmailGetProfile(accessToken);
    historyId = profile.historyId;
  } catch {
    // Missing historyId just means we'll re-hydrate on next call; not fatal.
  }

  const listRes = await gmailListMessages(accessToken, {
    q: query,
    maxResults,
  });
  const messageIds = (listRes.messages || []) as Array<{ id: string }>;
  const nextPageToken: string | undefined = listRes.nextPageToken || undefined;

  const batchResults = await gmailBatchGetMessages(
    accessToken,
    messageIds.map((m) => m.id),
    "metadata",
  );

  // Gmail's batch endpoint will return fewer sub-responses than sub-requests
  // when it rate-limits mid-batch (or on transient transport issues). Refill
  // any gaps with individual gets so we don't cache an incomplete inbox and
  // then silently drop those messages from every subsequent delta.
  const missing = batchResults.filter((r) => !r.data).map((r) => r.id);
  if (missing.length > 0) {
    const refills = await Promise.all(
      missing.map(async (id) => {
        try {
          const data = await gmailGetMessage(accessToken, id, "metadata");
          return { id, data };
        } catch {
          return { id, data: null as any };
        }
      }),
    );
    const byId = new Map(refills.map((r) => [r.id, r.data]));
    for (const r of batchResults) {
      if (!r.data && byId.has(r.id)) r.data = byId.get(r.id);
    }
  }

  // If refill still couldn't cover everything, abort rather than cache a
  // partial window (gaps never show up in history deltas). Caller retries.
  const stillMissing = batchResults.filter((r) => !r.data).length;
  if (stillMissing > 0) {
    throw new Error(
      `Batch message fetch incomplete: ${stillMissing}/${batchResults.length} missing after refill; aborting hydrate`,
    );
  }

  const messages: any[] = batchResults.map((r) => ({
    ...r.data,
    _accountEmail: email,
  }));

  return { messages, historyId, nextPageToken };
}

/**
 * Incremental sync via gmailListHistory. Returns null if history is
 * unusable (404/expired/paginated-too-deep) so the caller can fall back
 * to a full re-hydrate.
 */
async function applyHistoryDelta(
  accessToken: string,
  email: string,
  labelId: string,
  entry: HistoryEntry,
  maxResults: number,
): Promise<{ messages: any[]; historyId: string } | null> {
  let history: any;
  try {
    history = await gmailListHistory(accessToken, {
      startHistoryId: entry.historyId,
      historyTypes: [
        "messageAdded",
        "messageDeleted",
        "labelAdded",
        "labelRemoved",
      ],
      labelId,
      maxResults: 500,
    });
  } catch (err: any) {
    // 404 historyId-too-old, malformed response, etc. Caller re-hydrates.
    console.warn(`[history-sync] delta failed for ${email}: ${err.message}`);
    return null;
  }

  // If Gmail paginates the delta it means a very large batch of changes
  // accumulated; a full re-hydrate is likely cheaper and simpler than
  // chasing page tokens (plus our primitive doesn't accept pageToken yet).
  if (history.nextPageToken) return null;

  const newHistoryId: string = history.historyId || entry.historyId;

  // No changes → return cached messages as-is with refreshed historyId.
  if (!history.history || history.history.length === 0) {
    return { messages: entry.messages, historyId: newHistoryId };
  }

  // Fold history records in chronological order so the FINAL label state
  // for each message reflects the last event wins. Collapsing into
  // unordered sets would drop the restore half of an archive-then-undo
  // sequence within a single delta (and vice versa).
  const deleted = new Set<string>();
  const addedIds: string[] = [];
  // Per-message flag: does this id currently carry `labelId`? undefined
  // means no label event touched it in this delta (so preserve whatever
  // the cache already has).
  const finalLabelOnWatched = new Map<string, boolean>();
  const netLabelDelta = new Map<
    string,
    { add: Set<string>; remove: Set<string> }
  >();
  const touchLabels = (id: string) => {
    let d = netLabelDelta.get(id);
    if (!d) {
      d = { add: new Set(), remove: new Set() };
      netLabelDelta.set(id, d);
    }
    return d;
  };

  for (const rec of history.history) {
    for (const added of rec.messagesAdded || []) {
      if (added.message?.id) addedIds.push(added.message.id);
    }
    for (const removed of rec.messagesDeleted || []) {
      if (removed.message?.id) deleted.add(removed.message.id);
    }
    for (const evt of rec.labelsAdded || []) {
      const id = evt.message?.id;
      if (!id) continue;
      const d = touchLabels(id);
      for (const l of evt.labelIds || []) {
        d.add.add(l);
        d.remove.delete(l);
        if (l === labelId) finalLabelOnWatched.set(id, true);
      }
    }
    for (const evt of rec.labelsRemoved || []) {
      const id = evt.message?.id;
      if (!id) continue;
      const d = touchLabels(id);
      for (const l of evt.labelIds || []) {
        d.remove.add(l);
        d.add.delete(l);
        if (l === labelId) finalLabelOnWatched.set(id, false);
      }
    }
  }

  // Keep existing messages unless deleted or their final watched-label
  // state is explicitly `false` this delta.
  const kept: any[] = [];
  const existingById = new Map<string, any>();
  for (const m of entry.messages) {
    existingById.set(m.id, m);
    if (deleted.has(m.id)) continue;
    if (finalLabelOnWatched.get(m.id) === false) continue;

    const d = netLabelDelta.get(m.id);
    if (d) {
      const labels = new Set<string>(m.labelIds || []);
      for (const l of d.add) labels.add(l);
      for (const l of d.remove) labels.delete(l);
      m.labelIds = Array.from(labels);
    }
    kept.push(m);
  }

  // Ids that need a full body fetch:
  //   1. New messages (`messagesAdded`) not already cached.
  //   2. Messages whose FINAL watched-label state is `true` but that we
  //      don't have cached yet — e.g. a previously-archived message that
  //      gets unarchived and re-enters the inbox via `labelAdded(INBOX)`,
  //      or a message added then labeled within the same delta.
  // Always skip anything deleted in this delta.
  const fetchSet = new Set<string>();
  for (const id of addedIds) {
    if (deleted.has(id)) continue;
    if (existingById.has(id)) continue;
    if (finalLabelOnWatched.get(id) === false) continue;
    fetchSet.add(id);
  }
  for (const [id, onLabel] of finalLabelOnWatched) {
    if (!onLabel) continue;
    if (deleted.has(id)) continue;
    if (existingById.has(id)) continue;
    fetchSet.add(id);
  }
  const toFetch = Array.from(fetchSet);

  const fetched: any[] = [];
  const batchResults = await gmailBatchGetMessages(
    accessToken,
    toFetch,
    "metadata",
  );
  for (const r of batchResults) {
    if (!r.data) continue;
    fetched.push({ ...r.data, _accountEmail: email });
  }

  // If any fetch failed we can't tell whether the missing body would have
  // been kept or filtered — advancing historyId would permanently hide
  // those messages until the next cold load. Force a full rehydrate.
  if (fetched.length < toFetch.length) return null;

  const merged = [...kept, ...fetched].sort((a, b) => {
    const ad = Number(a.internalDate || 0);
    const bd = Number(b.internalDate || 0);
    return bd - ad;
  });

  // If the previous window was already full and ANY removal happened in
  // this delta, older messages in the account may need to be pulled
  // forward to fill the vacated slots. The delta alone can't see those
  // (gmailListHistory only reports messages touched since startHistoryId),
  // so even if `merged.length` still equals `maxResults` because of a
  // same-delta restore of an older message, the top-N ordering can be
  // wrong. Bail to full rehydrate whenever the window was full and
  // anything was removed.
  const anyRemoved =
    deleted.size > 0 ||
    Array.from(finalLabelOnWatched.values()).some((v) => v === false);
  if (entry.messages.length >= maxResults && anyRemoved) {
    return null;
  }

  return { messages: merged.slice(0, maxResults), historyId: newHistoryId };
}

async function fetchAccountWithHistory(
  accessToken: string,
  email: string,
  labelId: string,
  query: string,
  maxResults: number,
): Promise<{ messages: any[]; nextPageToken?: string }> {
  const cacheKey = historyCacheKey(email, labelId, maxResults);

  // Dedupe concurrent callers on the same key so the cache isn't raced.
  const pending = historyInflight.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    evictStaleHistoryCache();
    const cached = historyCache.get(cacheKey);

    if (cached) {
      const delta = await applyHistoryDelta(
        accessToken,
        email,
        labelId,
        cached,
        maxResults,
      );
      if (delta) {
        historyCache.set(cacheKey, {
          historyId: delta.historyId,
          messages: delta.messages,
          // Preserve the original page token — deltas don't produce one,
          // and page tokens referencing earlier `list` calls remain valid
          // for Gmail's history-backed pagination window.
          nextPageToken: cached.nextPageToken,
          updatedAt: Date.now(),
        });
        evictStaleHistoryCache();
        return {
          messages: delta.messages,
          nextPageToken: cached.nextPageToken,
        };
      }
      // Delta unusable — drop cache and fall through to full hydrate.
      historyCache.delete(cacheKey);
    }

    const init = await hydrateAccountInbox(
      accessToken,
      email,
      query,
      maxResults,
    );
    if (init.historyId) {
      historyCache.set(cacheKey, {
        historyId: init.historyId,
        messages: init.messages,
        nextPageToken: init.nextPageToken,
        updatedAt: Date.now(),
      });
      evictStaleHistoryCache();
    }
    return { messages: init.messages, nextPageToken: init.nextPageToken };
  })().finally(() => {
    historyInflight.delete(cacheKey);
  });

  historyInflight.set(cacheKey, promise);
  return promise;
}

async function fetchAccountLegacy(
  accessToken: string,
  email: string,
  query: string,
  maxResults: number,
  pageToken: string | undefined,
  onNextPageToken: (token: string) => void,
  onEstimate: (n: number) => void,
): Promise<any[]> {
  const listRes = await gmailListMessages(accessToken, {
    q: query,
    maxResults,
    pageToken,
  });

  onEstimate(listRes.resultSizeEstimate || 0);
  if (listRes.nextPageToken) onNextPageToken(listRes.nextPageToken);

  const messageIds = listRes.messages || [];
  if (messageIds.length === 0) return [];

  const batchResults = await gmailBatchGetMessages(
    accessToken,
    messageIds.map((m: any) => m.id),
    "full",
  );

  // Gmail's batch endpoint can return per-part failures without failing the
  // whole HTTP request. Refill those individually so list/search pages don't
  // silently drop matching messages.
  const missing = batchResults.filter((r) => !r.data).map((r) => r.id);
  if (missing.length > 0) {
    const refills = await Promise.all(
      missing.map(async (id) => {
        try {
          const data = await gmailGetMessage(accessToken, id, "full");
          return { id, data };
        } catch {
          return { id, data: null as any };
        }
      }),
    );
    const byId = new Map(refills.map((r) => [r.id, r.data]));
    for (const r of batchResults) {
      if (!r.data && byId.has(r.id)) r.data = byId.get(r.id);
    }
  }

  const messages: any[] = [];
  for (const r of batchResults) {
    if (!r.data) continue;
    messages.push({ ...r.data, _accountEmail: email });
  }
  return messages;
}

async function fetchAccountThreads(
  accessToken: string,
  email: string,
  query: string,
  maxResults: number,
  pageToken: string | undefined,
  format: "full" | "metadata" | "minimal",
  onNextPageToken: (token: string) => void,
  onEstimate: (n: number) => void,
): Promise<any[]> {
  const listRes = await gmailListThreads(accessToken, {
    q: query,
    maxResults,
    pageToken,
  });

  onEstimate(listRes.resultSizeEstimate || 0);
  if (listRes.nextPageToken) onNextPageToken(listRes.nextPageToken);

  const threadIds = (listRes.threads || []).map((t: any) => t.id);
  if (threadIds.length === 0) return [];

  const batchResults = await gmailBatchGetThreads(
    accessToken,
    threadIds,
    format,
  );

  // Same partial-batch guard as messages: a missing thread part should not
  // make search look incomplete when an individual retry can recover it.
  const missing = batchResults.filter((r) => !r.data).map((r) => r.id);
  if (missing.length > 0) {
    const refills = await Promise.all(
      missing.map(async (id) => {
        try {
          const data = await gmailGetThread(accessToken, id, format);
          return { id, data };
        } catch {
          return { id, data: null as any };
        }
      }),
    );
    const byId = new Map(refills.map((r) => [r.id, r.data]));
    for (const r of batchResults) {
      if (!r.data && byId.has(r.id)) r.data = byId.get(r.id);
    }
  }

  const messages: any[] = [];
  for (const r of batchResults) {
    for (const message of r.data?.messages || []) {
      messages.push({ ...message, _accountEmail: email });
    }
  }
  return messages;
}

async function listGmailMessagesUncached(
  query?: string,
  maxResults = 50,
  forEmail?: string,
  pageTokens?: Record<string, string>,
  options?: ListOptions,
): Promise<ListResult> {
  const { clients, errors: refreshErrors } =
    await getClientsWithErrors(forEmail);
  // Seed the per-fetch error list with refresh failures so a fully-dead
  // connection (every account's refresh_token revoked or invalidated by a
  // GOOGLE_CLIENT_ID rotation) reaches the handler — otherwise the list
  // looks indistinguishable from "empty inbox" and the user sees no error.
  const errors: Array<{ email: string; error: string }> = [...refreshErrors];
  if (clients.length === 0) return { messages: [], errors };

  const nextPageTokens: Record<string, string> = {};
  let totalEstimate = 0;

  const mode = options?.mode ?? "messages";
  const threadFormat = options?.threadFormat ?? "full";
  const historyLabel =
    mode === "messages" ? isHistoryEligible(query, pageTokens) : null;
  const resolvedQuery = query ?? "in:inbox";

  const allResults = await Promise.all(
    clients.map(async ({ email, accessToken }) => {
      try {
        if (historyLabel) {
          const res = await fetchAccountWithHistory(
            accessToken,
            email,
            historyLabel,
            resolvedQuery,
            maxResults,
          );
          if (res.nextPageToken) nextPageTokens[email] = res.nextPageToken;
          return res.messages;
        }
        if (mode === "threads") {
          return await fetchAccountThreads(
            accessToken,
            email,
            resolvedQuery,
            maxResults,
            pageTokens?.[email],
            threadFormat,
            (token) => {
              nextPageTokens[email] = token;
            },
            (n) => {
              totalEstimate += n;
            },
          );
        }
        return await fetchAccountLegacy(
          accessToken,
          email,
          resolvedQuery,
          maxResults,
          pageTokens?.[email],
          (token) => {
            nextPageTokens[email] = token;
          },
          (n) => {
            totalEstimate += n;
          },
        );
      } catch (error: any) {
        console.error(
          `[listGmailMessages] Error fetching from ${email}:`,
          error.message,
        );
        errors.push({ email, error: error.message });
        return [];
      }
    }),
  );

  return {
    messages: allResults.flat(),
    errors,
    ...(Object.keys(nextPageTokens).length > 0 && { nextPageTokens }),
    ...(totalEstimate > 0 && { resultSizeEstimate: totalEstimate }),
  };
}

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

function parseEmailAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: raw, email: raw };
}

function parseAddressList(raw: string): Array<{ name: string; email: string }> {
  if (!raw) return [];
  return raw.split(",").map((a) => parseEmailAddress(a.trim()));
}

function getBody(payload: any): string {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    // Prefer text/plain, fallback to text/html
    const textPart = payload.parts.find(
      (p: any) => p.mimeType === "text/plain",
    );
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    const part = textPart || htmlPart;
    if (part?.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    // Recurse into multipart
    for (const p of payload.parts) {
      const body = getBody(p);
      if (body) return body;
    }
  }
  return "";
}

function getBodyHtml(payload: any): string | undefined {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, "base64url").toString("utf-8");
    }
    // Recurse into multipart
    for (const p of payload.parts) {
      const html = getBodyHtml(p);
      if (html) return html;
    }
  }
  return undefined;
}

/** Build a map of Content-ID -> attachmentId from inline parts */
function getInlineAttachments(
  payload: any,
): Map<string, { attachmentId: string; mimeType: string }> {
  const map = new Map<string, { attachmentId: string; mimeType: string }>();
  function walk(part: any) {
    const headers = part.headers || [];
    const contentId = headers.find(
      (h: any) => h.name.toLowerCase() === "content-id",
    )?.value;
    const attachmentId = part.body?.attachmentId;
    if (contentId && attachmentId) {
      // Strip angle brackets: <image001> -> image001
      const cid = contentId.replace(/^<|>$/g, "");
      map.set(cid, { attachmentId, mimeType: part.mimeType || "image/png" });
    }
    if (part.parts) {
      for (const p of part.parts) walk(p);
    }
  }
  walk(payload);
  return map;
}

/** Replace cid: URLs in HTML with proxy API URLs */
function replaceCidUrls(
  html: string,
  messageId: string,
  inlineAttachments: Map<string, { attachmentId: string; mimeType: string }>,
): string {
  if (inlineAttachments.size === 0) return html;
  return html.replace(/\bcid:([^\s"'<>]+)/g, (_match, cid) => {
    const att = inlineAttachments.get(cid);
    if (att) {
      return `/api/attachments?messageId=${messageId}&id=${encodeURIComponent(att.attachmentId)}`;
    }
    return _match;
  });
}

export async function fetchGmailLabelMap(
  accessToken: string,
): Promise<Map<string, string>> {
  const res = await gmailListLabels(accessToken);
  const map = new Map<string, string>();
  for (const label of res.labels || []) {
    if (label.id && label.name) {
      map.set(label.id, label.name);
    }
  }
  return map;
}

/** Extract regular (non-inline) attachments from a Gmail message payload */
function getAttachments(
  payload: any,
): Array<{ id: string; filename: string; mimeType: string; size: number }> {
  const attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }> = [];
  function walk(part: any) {
    const attachmentId = part.body?.attachmentId;
    const filename = part.filename;
    // Only include parts with a filename and attachmentId (regular attachments)
    // Skip inline images (they have Content-Disposition: inline or Content-ID)
    if (attachmentId && filename) {
      const headers = part.headers || [];
      const contentDisposition = headers
        .find((h: any) => h.name.toLowerCase() === "content-disposition")
        ?.value?.toLowerCase();
      const contentId = headers.find(
        (h: any) => h.name.toLowerCase() === "content-id",
      )?.value;
      // Skip purely inline attachments (have content-id and inline disposition)
      const isInline = contentDisposition?.startsWith("inline") && contentId;
      if (!isInline) {
        attachments.push({
          id: attachmentId,
          filename,
          mimeType: part.mimeType || "application/octet-stream",
          size: part.body?.size || 0,
        });
      }
    }
    if (part.parts) {
      for (const p of part.parts) walk(p);
    }
  }
  walk(payload);
  return attachments;
}

// Cache of account email → display name (populated on first use per account)
const accountDisplayNames = new Map<string, string>();

/** Store a display name for a connected account email. */
export function setAccountDisplayName(email: string, name: string) {
  if (email && name) accountDisplayNames.set(email.toLowerCase(), name);
}

/** Get the cached display name for a connected account email. */
export function getAccountDisplayName(email: string): string | undefined {
  return accountDisplayNames.get(email.toLowerCase());
}

export function gmailToEmailMessage(
  msg: any,
  accountEmail?: string,
  labelMap?: Map<string, string>,
): any {
  const headers = msg.payload?.headers || [];
  const from = parseEmailAddress(getHeader(headers, "From"));
  // When Gmail returns just an email with no display name, use the cached profile name
  if (from.name === from.email) {
    const cached = accountDisplayNames.get(from.email.toLowerCase());
    if (cached) from.name = cached;
  }
  const to = parseAddressList(getHeader(headers, "To"));
  const cc = parseAddressList(getHeader(headers, "Cc"));
  const subject = getHeader(headers, "Subject");
  const date = getHeader(headers, "Date");
  const labels: string[] = msg.labelIds || [];

  const payload = msg.payload || {};
  const inlineAttachments = getInlineAttachments(payload);
  let bodyHtml = getBodyHtml(payload);
  if (bodyHtml && inlineAttachments.size > 0) {
    bodyHtml = replaceCidUrls(bodyHtml, msg.id, inlineAttachments);
  }
  const attachments = getAttachments(payload);

  return {
    id: msg.id,
    threadId: msg.threadId,
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    snippet: msg.snippet || "",
    body: getBody(payload),
    bodyHtml,
    date: new Date(date).toISOString(),
    isRead: !labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    isDraft: labels.includes("DRAFT"),
    isSent: labels.includes("SENT"),
    isArchived:
      !labels.includes("INBOX") &&
      !labels.includes("DRAFT") &&
      !labels.includes("SENT") &&
      !labels.includes("TRASH"),
    isTrashed: labels.includes("TRASH"),
    labelIds: labels
      .filter(
        (l: string) =>
          // Only strip boolean-state labels (already captured as isRead/isStarred/etc.)
          // Keep IMPORTANT and CATEGORY_* so they can be used as pinnable filters
          !["UNREAD", "STARRED"].includes(l),
      )
      .map((l: string) => {
        // Map Gmail category labels to friendly lowercase IDs
        const categoryMap: Record<string, string> = {
          IMPORTANT: "important",
          CATEGORY_PERSONAL: "personal",
          CATEGORY_SOCIAL: "social",
          CATEGORY_UPDATES: "updates",
          CATEGORY_PROMOTIONS: "promotions",
          CATEGORY_FORUMS: "forums",
        };
        if (categoryMap[l]) return categoryMap[l];
        let name = labelMap?.get(l) || l;
        // Use last segment of nested labels (e.g. "[Superhuman]/AI/Respond" -> "Respond")
        const lastSlash = name.lastIndexOf("/");
        if (lastSlash >= 0) name = name.slice(lastSlash + 1);
        return name.replace(/_/g, " ").toLowerCase();
      }),
    attachments: attachments.length > 0 ? attachments : undefined,
    accountEmail: accountEmail || msg._accountEmail,
    ...parseUnsubscribeHeaders(headers),
  };
}

/** Parse List-Unsubscribe and List-Unsubscribe-Post headers (RFC 2369 / RFC 8058) */
function parseUnsubscribeHeaders(
  headers: Array<{ name?: string | null; value?: string | null }>,
): { unsubscribe?: { url?: string; mailto?: string; oneClick?: boolean } } {
  const raw = getHeader(headers, "List-Unsubscribe");
  if (!raw) return {};

  const postHeader = getHeader(headers, "List-Unsubscribe-Post");
  const oneClick = postHeader
    .toLowerCase()
    .includes("list-unsubscribe=one-click");

  // Extract URLs from angle brackets: <https://...>, <mailto:...>
  const entries = raw.match(/<[^>]+>/g) || [];
  let url: string | undefined;
  let mailto: string | undefined;
  for (const entry of entries) {
    const val = entry.slice(1, -1); // strip < >
    if (val.startsWith("http://") || val.startsWith("https://")) {
      url = val;
    } else if (val.startsWith("mailto:")) {
      mailto = val.slice(7); // strip "mailto:"
    }
  }

  if (!url && !mailto) return {};
  return { unsubscribe: { url, mailto, oneClick } };
}
