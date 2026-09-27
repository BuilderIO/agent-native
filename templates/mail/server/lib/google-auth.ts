import {
  saveOAuthTokens,
  deleteOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
  setOAuthDisplayName,
} from "@agent-native/core/oauth-tokens";
import {
  getOAuthAccounts,
  GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS,
  getCredentialContext,
  resolveGoogleProviderCredentialCandidatesWithReader,
  resolveSecret,
  getRequestContext,
  runWithRequestContext,
} from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";
import { decodeCommonHtmlEntities } from "@shared/markdown.js";

import type { BulkMarkReadResult } from "./bulk-mark-read.js";
import {
  createOAuth2Client,
  GmailQuotaCooldownError,
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
  googleFetch,
  peopleGetProfile,
} from "./google-api.js";
import { getMailProviderApiRuntime } from "./provider-api.js";
import { resolveGoogleSenderIdentity } from "./sender-identity.js";
import { invalidateThreadCache } from "./thread-cache.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

const GMAIL_SCOPE_PREFIX = "https://www.googleapis.com/auth/gmail.";

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

function hasGmailScope(tokens: Record<string, unknown>): boolean {
  const scope = tokens.scope;
  if (typeof scope !== "string" || !scope.trim()) return true;
  return scope
    .split(/[\s,]+/)
    .some((value) => value.startsWith(GMAIL_SCOPE_PREFIX));
}

type ManagedGmailClient = {
  email: string;
  accessToken: string;
  refreshToken: string;
};

type ManagedGmailResolution =
  | { ok: true; client: ManagedGmailClient | null }
  | { ok: false; error: { email: "workspace"; error: string } };

async function resolveManagedGmailClient(): Promise<ManagedGmailClient | null> {
  if (!getCredentialContext()) return null;
  const connection = await resolveWorkspaceConnectionForApp({
    appId: "mail",
    provider: "gmail",
    requireConnected: true,
  });
  if (!connection.available) return null;
  const credential = await getMailProviderApiRuntime().resolveOAuthAccessToken({
    provider: "gmail",
  });
  if (!credential.accountId) {
    throw new Error("The connected Gmail workspace account has no account id.");
  }
  return {
    email: credential.accountId,
    accessToken: credential.accessToken,
    refreshToken: "",
  };
}

async function resolveManagedGmailClientForOwner(
  ownerEmail?: string,
): Promise<ManagedGmailClient | null> {
  if (!ownerEmail) return resolveManagedGmailClient();
  return await runWithRequestContext(
    { ...(getRequestContext() ?? {}), userEmail: ownerEmail },
    () => resolveManagedGmailClient(),
  );
}

async function resolveManagedGmailClientWithError(
  ownerEmail?: string,
): Promise<ManagedGmailResolution> {
  try {
    return {
      ok: true,
      client: await resolveManagedGmailClientForOwner(ownerEmail),
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        email: "workspace",
        error:
          error instanceof Error
            ? error.message
            : "Workspace Gmail connection failed",
      },
    };
  }
}

export async function getOAuth2Credentials(owner?: string): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const resolve = () =>
    resolveGoogleProviderCredentialCandidatesWithReader({
      readCredential: resolveSecret,
      credentialKeyPairs: [GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS],
    });
  const [credentials] = owner
    ? await runWithRequestContext({ userEmail: owner }, resolve)
    : await resolve();
  if (!credentials) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be saved in settings",
    );
  }
  return credentials;
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

export function isPermanentRefreshError(message: string): boolean {
  const m = message.toLowerCase();
  return PERMANENT_REFRESH_ERRORS.some((code) => m.includes(code));
}

// Single-flight refresh per stored token row. Concurrent callers for the same
// account (labels, emails, settings, google-status all fire on mount) must
// await one in-flight `oauth2.refreshToken` instead of each racing their own
// — the loser's write would otherwise stomp the winner's via last-writer-wins
// `saveOAuthTokens`, silently dropping the account for that caller. Keyed by
// accountId alone: within provider "google" a row is uniquely identified by
// accountId (saveOAuthTokens/deleteOAuthTokens resolve owner from the
// existing row when omitted), and some callers (getAuthStatus) don't pass an
// owner — keying on owner too would split the exact concurrent callers this
// exists to coalesce.
const refreshInflight = new Map<string, Promise<string>>();

async function refreshAccessToken(
  accountId: string,
  tokens: GoogleTokens,
  owner?: string,
): Promise<string> {
  if (!tokens.refresh_token) {
    await deleteOAuthTokens("google", accountId);
    throw new Error(
      `No refresh token available for ${accountId} — please reconnect.`,
    );
  }

  const { clientId, clientSecret } = await getOAuth2Credentials(owner);
  const oauth2 = createOAuth2Client(clientId, clientSecret, "");
  let refreshed;
  try {
    refreshed = await oauth2.refreshToken(tokens.refresh_token);
  } catch (err: any) {
    if (isPermanentRefreshError(err?.message || "")) {
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

async function getValidAccessToken(
  accountId: string,
  tokens: GoogleTokens,
  owner?: string,
): Promise<string> {
  if (!tokens.access_token && !tokens.refresh_token) {
    throw new Error(
      `No usable OAuth tokens for ${accountId} — please reconnect.`,
    );
  }

  if (
    tokens.expiry_date &&
    tokens.access_token &&
    Date.now() < tokens.expiry_date - 5 * 60 * 1000
  ) {
    return tokens.access_token;
  }

  const existing = refreshInflight.get(accountId);
  if (existing) return existing;

  const promise = refreshAccessToken(accountId, tokens, owner).finally(() => {
    refreshInflight.delete(accountId);
  });
  refreshInflight.set(accountId, promise);
  return promise;
}

export async function getAuthUrl(
  origin?: string,
  redirectUri?: string,
  state?: string,
  owner?: string,
): Promise<string> {
  const { clientId, clientSecret } = await getOAuth2Credentials(owner);
  const uri =
    redirectUri ||
    (origin ? `${origin}/_agent-native/google/callback` : undefined);
  if (!uri) throw new Error("Google OAuth redirect URI is required.");
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
  const { clientId, clientSecret } = await getOAuth2Credentials(owner);
  const uri =
    redirectUri ||
    (origin ? `${origin}/_agent-native/google/callback` : undefined);
  if (!uri) throw new Error("Google OAuth redirect URI is required.");
  const oauth2 = createOAuth2Client(clientId, clientSecret, uri);
  const tokenResponse = await oauth2.getToken(code);

  const tokens: GoogleTokens = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expiry_date: Date.now() + tokenResponse.expires_in * 1000,
    token_type: tokenResponse.token_type,
    scope: tokenResponse.scope,
  };

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
  const accounts = (await listOAuthAccountsByOwner("google", email)).filter(
    (account) => hasGmailScope(account.tokens),
  );
  if (accounts.length === 0) {
    return resolveManagedGmailClientForOwner(email);
  }

  const account = accounts.find((a) => a.accountId === email) ?? accounts[0];

  const tokens = account.tokens as unknown as GoogleTokens;
  if (!tokens) return null;

  const accountId = account.accountId;
  const accessToken = await getValidAccessToken(accountId, tokens, email);

  return { accessToken, email: accountId };
}

export async function getClientForAccount(
  accountId: string,
): Promise<{ accessToken: string; email: string } | null> {
  const all = await listOAuthAccounts("google");
  const account = all.find((a) => a.accountId === accountId);
  if (!account || !hasGmailScope(account.tokens)) return null;
  return getClientFromAccount({
    ...account,
    owner: account.owner ?? undefined,
  });
}

export async function getClientFromAccount(account: {
  accountId: string;
  owner?: string;
  tokens: Record<string, unknown>;
}): Promise<{ accessToken: string; email: string } | null> {
  if (!hasGmailScope(account.tokens)) return null;
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

export async function getClientForConnectedAccount(
  ownerEmail: string,
  accountEmail: string,
): Promise<{ accessToken: string; email: string } | null> {
  const oauthAccount = (await listOAuthAccountsByOwner("google", ownerEmail))
    .filter((account) => hasGmailScope(account.tokens))
    .find(
      (account) =>
        account.accountId.toLowerCase() === accountEmail.toLowerCase(),
    );
  if (oauthAccount) {
    return getClientFromAccount({
      ...oauthAccount,
      owner: ownerEmail,
    });
  }
  const managed = await resolveManagedGmailClientForOwner(ownerEmail);
  if (managed && managed.email.toLowerCase() === accountEmail.toLowerCase()) {
    return { accessToken: managed.accessToken, email: managed.email };
  }
  return null;
}

export async function getClients(
  forEmail?: string,
): Promise<
  Array<{ email: string; accessToken: string; refreshToken: string }>
> {
  const { clients } = await getClientsWithErrors(forEmail);
  return clients;
}

export async function getClientsWithErrors(
  forEmail?: string,
  accountEmails?: string[],
): Promise<{
  clients: Array<{ email: string; accessToken: string; refreshToken: string }>;
  errors: Array<{ email: string; error: string }>;
}> {
  if (!forEmail) return { clients: [], errors: [] };
  const requested = accountEmails
    ? new Set(accountEmails.map((email) => email.toLowerCase()))
    : null;
  // Filtering happens before getValidAccessToken. This is important: token
  // refreshes are writes and an explicitly scoped inventory read must not
  // refresh unrelated accounts.
  const accounts = (await listOAuthAccountsByOwner("google", forEmail)).filter(
    (account) =>
      hasGmailScope(account.tokens) &&
      (!requested || requested.has(account.accountId.toLowerCase())),
  );
  const oauthAccountEmails = new Set(
    accounts.map((account) => account.accountId.toLowerCase()),
  );
  const managedPromise =
    !requested || [...requested].some((email) => !oauthAccountEmails.has(email))
      ? resolveManagedGmailClientWithError(forEmail)
      : null;

  const clients: Array<{
    email: string;
    accessToken: string;
    refreshToken: string;
  }> = [];
  const errors: Array<{ email: string; error: string }> = [];

  const results = await Promise.all(
    accounts.map(async (account) => {
      const tokens = account.tokens as unknown as GoogleTokens;
      if (!tokens) return null;

      const accountId = account.accountId;
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
        return {
          client: {
            email: accountId,
            accessToken,
            refreshToken: tokens.refresh_token || "",
          },
        };
      } catch (err: any) {
        return {
          error: {
            email: accountId,
            error: err?.message || "Unknown refresh error",
          },
        };
      }
    }),
  );

  for (const result of results) {
    if (!result) continue;
    if (result.client) clients.push(result.client);
    else if (result.error) errors.push(result.error);
  }

  if (managedPromise) {
    const result = await managedPromise;
    if (!result.ok) {
      errors.push(result.error);
    } else {
      const managed = result.client;
      if (managed) {
        const managedEmail = managed.email.toLowerCase();
        if (
          (!requested || requested.has(managedEmail)) &&
          !oauthAccountEmails.has(managedEmail)
        ) {
          clients.push(managed);
        }
      }
    }
  }

  return { clients, errors };
}

export async function isConnected(forEmail?: string): Promise<boolean> {
  if (!forEmail) return false;
  const accounts = await listOAuthAccountsByOwner("google", forEmail);
  if (accounts.some((account) => hasGmailScope(account.tokens))) return true;
  return Boolean(await resolveManagedGmailClientForOwner(forEmail));
}

export async function getConnectedAccounts(
  forEmail?: string,
): Promise<string[]> {
  const result = await getConnectedAccountsWithErrors(forEmail);
  if (result.errors.length > 0) {
    throw new Error(
      result.errors
        .map(({ error }) => error)
        .filter(Boolean)
        .join("; "),
    );
  }
  return result.accounts;
}

export async function getConnectedAccountsWithErrors(
  forEmail?: string,
): Promise<{
  accounts: string[];
  errors: Array<{ email: string; error: string }>;
}> {
  if (!forEmail) return { accounts: [], errors: [] };
  const [oauthAccounts, managedResult] = await Promise.all([
    listOAuthAccountsByOwner("google", forEmail).then((accounts) =>
      accounts.filter((account) => hasGmailScope(account.tokens)),
    ),
    resolveManagedGmailClientWithError(forEmail),
  ]);
  const accounts = oauthAccounts.map((account) => account.accountId);
  if (!managedResult.ok) {
    return { accounts, errors: [managedResult.error] };
  }
  const managed = managedResult.client;
  if (
    managed &&
    !accounts.some(
      (email) => email.toLowerCase() === managed.email.toLowerCase(),
    )
  ) {
    accounts.push(managed.email);
  }
  return { accounts, errors: [] };
}

export interface GoogleAuthStatus {
  connected: boolean;
  accounts: Array<{
    email: string;
    displayName?: string;
    expiresAt?: string;
    photoUrl?: string;
    shared?: boolean;
  }>;
  errors?: Array<{ email: string; error: string }>;
}

export async function getAuthStatus(
  forEmail?: string,
): Promise<GoogleAuthStatus> {
  const oauthAccounts = (await getOAuthAccounts("google", forEmail)).filter(
    (account) => hasGmailScope(account.tokens),
  );

  const accounts: Array<{
    email: string;
    displayName?: string;
    expiresAt?: string;
    photoUrl?: string;
    shared?: boolean;
  }> = [];
  const errors: Array<{ email: string; error: string }> = [];
  const oauthAccountEmails = new Set(
    oauthAccounts.map((account) => account.accountId.toLowerCase()),
  );
  for (const account of oauthAccounts) {
    const tokens = account.tokens as unknown as GoogleTokens;
    if (!tokens) continue;
    const email = account.accountId;
    let photoUrl: string | undefined;
    const accountDisplayName = (account as { displayName?: string | null })
      .displayName;
    let displayName =
      accountDisplayName ?? getAccountDisplayName(account.accountId);
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(email, tokens);
    } catch (err) {
      errors.push({
        email,
        error:
          err instanceof Error ? err.message : "Google token refresh failed",
      });
      console.warn(
        `[mail] skipping unusable Google OAuth row for ${email}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    try {
      const identity = await resolveGoogleSenderIdentity({
        accessToken,
        email,
        cachedName: displayName,
        onResolvedDisplayName: (name) => {
          displayName = name;
          setAccountDisplayName(email, name);
          void setOAuthDisplayName("google", email, name).catch(() => {});
        },
      });
      displayName = identity.displayName;
      const profile = await peopleGetProfile(accessToken, "photos");
      photoUrl = profile.photos?.[0]?.url ?? undefined;
    } catch {}
    accounts.push({
      email,
      ...(displayName ? { displayName } : {}),
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
      photoUrl,
    });
  }

  const managedResult = await resolveManagedGmailClientWithError(forEmail);
  if (!managedResult.ok) {
    errors.push(managedResult.error);
  } else {
    const managed = managedResult.client;
    if (managed && !oauthAccountEmails.has(managed.email.toLowerCase())) {
      accounts.push({ email: managed.email, shared: true });
    }
  }

  return {
    connected: accounts.length > 0,
    accounts,
    ...(errors.length > 0 ? { errors } : {}),
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

type ListResult = {
  messages: any[];
  errors: Array<{
    email: string;
    error: string;
    isQuotaError?: boolean;
    retryAfterMs?: number;
  }>;
  nextPageTokens?: Record<string, string>;
  resultSizeEstimate?: number;
};

type ListMode = "messages" | "threads";

type ListOptions = {
  mode?: ListMode;
  threadFormat?: "full" | "metadata" | "minimal";
  messageFormat?: "full" | "metadata" | "minimal";
  threadCandidateLimit?: number;
  threadRecentMessageCandidateLimit?: number;
  accountEmails?: string[];
};

const LIST_CACHE_TTL = 45_000;
const listCache = new Map<string, { result: ListResult; expiresAt: number }>();
const listInflight = new Map<string, Promise<ListResult>>();
type InvalidationGeneration = {
  value: number;
  activeRequests: number;
  lastUsedAt: number;
};

type InvalidationGenerationLease = {
  entry: InvalidationGeneration;
  value: number;
};

const MAX_INVALIDATION_GENERATIONS = 1_000;

function getInvalidationGeneration(
  generations: Map<string, InvalidationGeneration>,
  key: string,
): InvalidationGeneration {
  const existing = generations.get(key);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing;
  }
  const created = { value: 0, activeRequests: 0, lastUsedAt: Date.now() };
  generations.set(key, created);
  return created;
}

function pruneInvalidationGenerations(
  generations: Map<string, InvalidationGeneration>,
): void {
  const toDrop = generations.size - MAX_INVALIDATION_GENERATIONS;
  if (toDrop <= 0) return;
  const idle = Array.from(generations.entries())
    .filter(([, entry]) => entry.activeRequests === 0)
    .sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt);
  for (let i = 0; i < Math.min(toDrop, idle.length); i++) {
    generations.delete(idle[i][0]);
  }
}

function beginInvalidationGeneration(
  generations: Map<string, InvalidationGeneration>,
  key: string,
): InvalidationGenerationLease {
  const entry = getInvalidationGeneration(generations, key);
  entry.activeRequests += 1;
  pruneInvalidationGenerations(generations);
  return { entry, value: entry.value };
}

function isCurrentInvalidationGeneration(
  generations: Map<string, InvalidationGeneration>,
  key: string,
  lease: InvalidationGenerationLease,
): boolean {
  return (
    generations.get(key) === lease.entry && lease.entry.value === lease.value
  );
}

function endInvalidationGeneration(
  generations: Map<string, InvalidationGeneration>,
  lease: InvalidationGenerationLease,
): void {
  lease.entry.activeRequests -= 1;
  lease.entry.lastUsedAt = Date.now();
  pruneInvalidationGenerations(generations);
}

function invalidateGeneration(
  generations: Map<string, InvalidationGeneration>,
  key: string,
): void {
  const entry = getInvalidationGeneration(generations, key);
  entry.value += 1;
  entry.lastUsedAt = Date.now();
  pruneInvalidationGenerations(generations);
}

const listInvalidationGenerations = new Map<string, InvalidationGeneration>();
const THREAD_CANDIDATE_PAGE_TTL = 5 * 60 * 1000;
const THREAD_CANDIDATE_PAGE_MAX = 25;
const THREAD_CANDIDATE_PAGE_PREFIX = "__an_thread_candidates__:";
const THREAD_CANDIDATE_PAGE_SETTING = "mail-thread-candidate-pages";
const THREAD_METADATA_RANK_LIMIT = 120;
export const DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT = 100;

type ThreadCandidatePageEntry = {
  email: string;
  ids: string[];
  nextPageToken?: string;
  expiresAt: number;
  updatedAt: number;
};

type ThreadCandidatePageStore = {
  pages?: Record<string, ThreadCandidatePageEntry>;
};

function pruneThreadCandidatePages(
  pages: Record<string, ThreadCandidatePageEntry>,
): Record<string, ThreadCandidatePageEntry> {
  const now = Date.now();
  const live = Object.fromEntries(
    Object.entries(pages).filter(([, entry]) => entry.expiresAt > now),
  );
  const entries = Object.entries(live).sort(
    (a, b) => b[1].updatedAt - a[1].updatedAt,
  );
  return Object.fromEntries(entries.slice(0, THREAD_CANDIDATE_PAGE_MAX));
}

async function readThreadCandidatePageStore(ownerEmail: string): Promise<{
  pages: Record<string, ThreadCandidatePageEntry>;
  prunedCount: number;
}> {
  const stored = (await getUserSetting(
    ownerEmail,
    THREAD_CANDIDATE_PAGE_SETTING,
  )) as ThreadCandidatePageStore | null;
  const rawPages = stored?.pages ?? {};
  const pages = pruneThreadCandidatePages(rawPages);
  return {
    pages,
    prunedCount: Object.keys(rawPages).length - Object.keys(pages).length,
  };
}

async function writeThreadCandidatePageStore(
  ownerEmail: string,
  pages: Record<string, ThreadCandidatePageEntry>,
): Promise<void> {
  await putUserSetting(ownerEmail, THREAD_CANDIDATE_PAGE_SETTING, {
    pages: pruneThreadCandidatePages(pages),
  });
}

async function getStoredThreadCandidatePage(
  ownerEmail: string,
  key: string,
): Promise<ThreadCandidatePageEntry | null> {
  const { pages, prunedCount } = await readThreadCandidatePageStore(ownerEmail);
  const page = pages[key];
  if (!page) {
    if (prunedCount > 0) {
      await writeThreadCandidatePageStore(ownerEmail, pages);
    }
    return null;
  }
  page.updatedAt = Date.now();
  pages[key] = page;
  await writeThreadCandidatePageStore(ownerEmail, pages);
  return page;
}

async function deleteStoredThreadCandidatePage(
  ownerEmail: string,
  key: string,
): Promise<void> {
  const { pages } = await readThreadCandidatePageStore(ownerEmail);
  if (pages[key]) {
    delete pages[key];
    await writeThreadCandidatePageStore(ownerEmail, pages);
  }
}

function makeThreadCandidatePageToken(key: string, offset: number): string {
  return `${THREAD_CANDIDATE_PAGE_PREFIX}${key}:${offset}`;
}

function parseThreadCandidatePageToken(
  pageToken: string | undefined,
): { key: string; offset: number } | null {
  if (!pageToken?.startsWith(THREAD_CANDIDATE_PAGE_PREFIX)) return null;
  const rest = pageToken.slice(THREAD_CANDIDATE_PAGE_PREFIX.length);
  const idx = rest.lastIndexOf(":");
  if (idx <= 0) return null;
  const key = rest.slice(0, idx);
  const offset = Number(rest.slice(idx + 1));
  if (!Number.isFinite(offset) || offset < 0) return null;
  return { key, offset };
}

async function storeThreadCandidatePage(
  ownerEmail: string,
  email: string,
  ids: string[],
  nextPageToken: string | undefined,
): Promise<string> {
  const { pages } = await readThreadCandidatePageStore(ownerEmail);
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  pages[key] = {
    email,
    ids,
    nextPageToken,
    expiresAt: Date.now() + THREAD_CANDIDATE_PAGE_TTL,
    updatedAt: Date.now(),
  };
  await writeThreadCandidatePageStore(ownerEmail, pages);
  return key;
}

function latestThreadMessageTime(thread: any): number {
  let latest = 0;
  for (const message of thread?.messages || []) {
    const internalDate = Number(message.internalDate || 0);
    if (Number.isFinite(internalDate) && internalDate > latest) {
      latest = internalDate;
    }

    const headerDate = Date.parse(
      getHeader(message.payload?.headers || [], "Date"),
    );
    if (Number.isFinite(headerDate) && headerDate > latest) {
      latest = headerDate;
    }
  }
  return latest;
}

function compareHistoryDesc(a: any, b: any): number {
  try {
    const ah = BigInt(a.historyId || 0);
    const bh = BigInt(b.historyId || 0);
    return ah === bh ? 0 : ah > bh ? -1 : 1;
  } catch {
    return Number(b.historyId || 0) - Number(a.historyId || 0);
  }
}

function uniqueIds(ids: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

async function listRecentMatchingThreadIds(
  accessToken: string,
  query: string,
  maxResults: number,
): Promise<string[]> {
  try {
    const listRes = await gmailListMessages(accessToken, {
      q: query,
      maxResults,
    });
    return uniqueIds((listRes.messages || []).map((m: any) => m.threadId));
  } catch (err: any) {
    console.warn(
      `[listGmailMessages] Recent message candidates failed: ${err.message}`,
    );
    return [];
  }
}

async function fetchThreadBatchWithRefill(
  accessToken: string,
  threadIds: string[],
  format: "full" | "metadata" | "minimal",
): Promise<Array<{ id: string; data: any; error?: string }>> {
  const batchResults = await gmailBatchGetThreads(
    accessToken,
    threadIds,
    format,
  );

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

  if (batchResults.some((result) => !result.data)) {
    throw new Error("Gmail thread metadata response was incomplete");
  }

  return batchResults;
}

function messagesFromThreadBatchResults(
  batchResults: Array<{ id: string; data: any; error?: string }>,
  email: string,
): any[] {
  const messages: any[] = [];
  for (const r of batchResults) {
    for (const message of r.data?.messages || []) {
      messages.push({ ...message, _accountEmail: email });
    }
  }
  return messages;
}

async function rankThreadCandidatesByLatestMessage(
  accessToken: string,
  candidateIds: string[],
): Promise<{
  ids: string[];
  metadataById: Map<string, any>;
}> {
  const originalIndex = new Map(
    candidateIds.map((id, index) => [id, index] as const),
  );
  const batchResults = await fetchThreadBatchWithRefill(
    accessToken,
    candidateIds,
    "metadata",
  );
  const metadataById = new Map<string, any>();
  for (const result of batchResults) {
    if (result.data) metadataById.set(result.id, result.data);
  }

  const ids = [...candidateIds].sort((a, b) => {
    const diff =
      latestThreadMessageTime(metadataById.get(b)) -
      latestThreadMessageTime(metadataById.get(a));
    if (diff !== 0) return diff;
    return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
  });

  return { ids, metadataById };
}

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
  const accounts = options?.accountEmails
    ?.map((email) => email.toLowerCase())
    .sort()
    .join(",");
  return `${forEmail ?? ""}::${queryPart}::${maxResults}::${tokenPart}::${options?.mode ?? "messages"}::${options?.threadFormat ?? ""}::${options?.messageFormat ?? ""}::${options?.threadCandidateLimit ?? ""}::${options?.threadRecentMessageCandidateLimit ?? ""}::${accounts ?? ""}`;
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

  const ownerKey = forEmail?.toLowerCase() ?? "";
  const generationLease = beginInvalidationGeneration(
    listInvalidationGenerations,
    ownerKey,
  );
  let promise: Promise<ListResult>;
  promise = (async (): Promise<ListResult> => {
    const result = await listGmailMessagesUncached(
      query,
      maxResults,
      forEmail,
      pageTokens,
      options,
    );
    if (
      isCurrentInvalidationGeneration(
        listInvalidationGenerations,
        ownerKey,
        generationLease,
      ) &&
      (result.messages.length > 0 || result.errors.length === 0)
    ) {
      listCache.set(key, {
        result,
        expiresAt: Date.now() + LIST_CACHE_TTL,
      });
    }
    return result;
  })().finally(() => {
    if (listInflight.get(key) === promise) listInflight.delete(key);
    endInvalidationGeneration(listInvalidationGenerations, generationLease);
  });

  listInflight.set(key, promise);
  return promise;
}

export function invalidateListCacheForOwner(ownerEmail: string): void {
  const ownerKey = ownerEmail.toLowerCase();
  invalidateGeneration(listInvalidationGenerations, ownerKey);
  const prefix = `${ownerKey}::`;
  for (const key of listCache.keys()) {
    if (key.toLowerCase().startsWith(prefix)) listCache.delete(key);
  }
  for (const key of listInflight.keys()) {
    if (key.toLowerCase().startsWith(prefix)) listInflight.delete(key);
  }
}

type HistoryEntry = {
  historyId: string;
  messages: any[];
  nextPageToken?: string;
  updatedAt: number;
};

const historyCache = new Map<string, HistoryEntry>();

export function bumpHistoryWatermark(email: string, historyId?: string): void {
  void historyId;
  invalidateHistoryCacheForAccount(email);
}

const historyInflight = new Map<
  string,
  Promise<{ messages: any[]; nextPageToken?: string }>
>();

const HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;
const HISTORY_CACHE_MAX = 200;
const historyInvalidationGenerations = new Map<
  string,
  InvalidationGeneration
>();

export function invalidateHistoryCacheForAccount(email: string): void {
  const accountKey = email.toLowerCase();
  invalidateGeneration(historyInvalidationGenerations, accountKey);
  const prefix = `${accountKey}::`;
  for (const key of historyCache.keys()) {
    if (key.toLowerCase().startsWith(prefix)) historyCache.delete(key);
  }
  for (const key of historyInflight.keys()) {
    if (key.toLowerCase().startsWith(prefix)) historyInflight.delete(key);
  }
}

function evictStaleHistoryCache(): void {
  const now = Date.now();
  for (const [key, entry] of historyCache) {
    if (now - entry.updatedAt > HISTORY_CACHE_TTL_MS) historyCache.delete(key);
  }
  if (historyCache.size <= HISTORY_CACHE_MAX) return;
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
    console.warn(`[history-sync] delta failed for ${email}: ${err.message}`);
    return null;
  }

  if (history.nextPageToken) return null;

  const newHistoryId: string = history.historyId || entry.historyId;

  if (!history.history || history.history.length === 0) {
    return { messages: entry.messages, historyId: newHistoryId };
  }

  const deleted = new Set<string>();
  const addedIds: string[] = [];
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

  if (fetched.length < toFetch.length) return null;

  const merged = [...kept, ...fetched].sort((a, b) => {
    const ad = Number(a.internalDate || 0);
    const bd = Number(b.internalDate || 0);
    return bd - ad;
  });

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
  const accountKey = email.toLowerCase();

  const pending = historyInflight.get(cacheKey);
  if (pending) return pending;

  const generationLease = beginInvalidationGeneration(
    historyInvalidationGenerations,
    accountKey,
  );
  let promise: Promise<{ messages: any[]; nextPageToken?: string }>;
  promise = (async () => {
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
        if (
          isCurrentInvalidationGeneration(
            historyInvalidationGenerations,
            accountKey,
            generationLease,
          )
        ) {
          historyCache.set(cacheKey, {
            historyId: delta.historyId,
            messages: delta.messages,
            nextPageToken: cached.nextPageToken,
            updatedAt: Date.now(),
          });
        }
        evictStaleHistoryCache();
        return {
          messages: delta.messages,
          nextPageToken: cached.nextPageToken,
        };
      }
      if (
        isCurrentInvalidationGeneration(
          historyInvalidationGenerations,
          accountKey,
          generationLease,
        )
      ) {
        historyCache.delete(cacheKey);
      }
    }

    const init = await hydrateAccountInbox(
      accessToken,
      email,
      query,
      maxResults,
    );
    if (
      init.historyId &&
      isCurrentInvalidationGeneration(
        historyInvalidationGenerations,
        accountKey,
        generationLease,
      )
    ) {
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
    if (historyInflight.get(cacheKey) === promise)
      historyInflight.delete(cacheKey);
    endInvalidationGeneration(historyInvalidationGenerations, generationLease);
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
  format: "full" | "metadata" | "minimal",
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
    format,
  );

  const missing = batchResults.filter((r) => !r.data).map((r) => r.id);
  if (missing.length > 0) {
    const refills = await Promise.all(
      missing.map(async (id) => {
        try {
          const data = await gmailGetMessage(accessToken, id, format);
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
  ownerEmail: string | undefined,
  email: string,
  query: string,
  maxResults: number,
  pageToken: string | undefined,
  format: "full" | "metadata" | "minimal",
  candidateLimit: number | undefined,
  recentMessageCandidateLimit: number | undefined,
  onNextPageToken: (token: string) => void,
  onEstimate: (n: number) => void,
): Promise<any[]> {
  const candidateStoreOwner = ownerEmail ?? email;
  const cachedCandidatePage = parseThreadCandidatePageToken(pageToken);
  if (cachedCandidatePage) {
    const cached = await getStoredThreadCandidatePage(
      candidateStoreOwner,
      cachedCandidatePage.key,
    );
    if (cached && cached.email === email && cached.expiresAt > Date.now()) {
      const nextOffset = cachedCandidatePage.offset + maxResults;
      const threadIds = cached.ids.slice(
        cachedCandidatePage.offset,
        nextOffset,
      );
      if (nextOffset < cached.ids.length) {
        onNextPageToken(
          makeThreadCandidatePageToken(cachedCandidatePage.key, nextOffset),
        );
      } else if (cached.nextPageToken) {
        onNextPageToken(cached.nextPageToken);
      }
      return fetchThreadMessagesForIds(accessToken, email, threadIds, format);
    }
    await deleteStoredThreadCandidatePage(
      candidateStoreOwner,
      cachedCandidatePage.key,
    );
    pageToken = undefined;
    candidateLimit = undefined;
  }

  const useCandidateWindow =
    !pageToken && candidateLimit && candidateLimit > maxResults;
  const useRecentMessageCandidates =
    !pageToken &&
    recentMessageCandidateLimit &&
    recentMessageCandidateLimit > maxResults;
  const listMaxResults =
    useCandidateWindow && candidateLimit
      ? Math.min(Math.max(candidateLimit, maxResults), 500)
      : maxResults;
  const listRes = await gmailListThreads(accessToken, {
    q: query,
    maxResults: listMaxResults,
    pageToken,
  });

  onEstimate(listRes.resultSizeEstimate || 0);

  const threadStubs = listRes.threads || [];
  let candidateIds = uniqueIds(threadStubs.map((t: any) => t.id));
  let candidateMetadataById: Map<string, any> | undefined;
  if (useRecentMessageCandidates) {
    const recentMatchingThreadIds = await listRecentMatchingThreadIds(
      accessToken,
      query,
      Math.min(Math.max(recentMessageCandidateLimit, maxResults), 500),
    );
    candidateIds = uniqueIds([...recentMatchingThreadIds, ...candidateIds]);
  }
  if (useCandidateWindow && candidateIds.length > maxResults) {
    const rankLimit = Math.min(
      Math.max(maxResults, THREAD_METADATA_RANK_LIMIT),
      candidateLimit ?? THREAD_METADATA_RANK_LIMIT,
    );
    const historyRankedIds = [...threadStubs]
      .sort(compareHistoryDesc)
      .map((t: any) => t.id);
    const recentMatchingThreadIds = await listRecentMatchingThreadIds(
      accessToken,
      query,
      rankLimit,
    );
    const hydrationCandidateIds = uniqueIds([
      ...recentMatchingThreadIds,
      ...historyRankedIds,
      ...candidateIds,
    ]).slice(0, rankLimit);
    const ranked = await rankThreadCandidatesByLatestMessage(
      accessToken,
      hydrationCandidateIds,
    );
    const rankedSet = new Set(ranked.ids);
    candidateIds = [
      ...ranked.ids,
      ...uniqueIds([...historyRankedIds, ...candidateIds]).filter(
        (id) => !rankedSet.has(id),
      ),
    ];
    candidateMetadataById = ranked.metadataById;
  }

  const threadIds = candidateIds.slice(0, maxResults);
  if (threadIds.length === 0) return [];

  if (
    (useCandidateWindow || useRecentMessageCandidates) &&
    candidateIds.length > maxResults
  ) {
    const key = await storeThreadCandidatePage(
      candidateStoreOwner,
      email,
      candidateIds,
      listRes.nextPageToken,
    );
    onNextPageToken(makeThreadCandidatePageToken(key, maxResults));
  } else if (listRes.nextPageToken) {
    onNextPageToken(listRes.nextPageToken);
  }

  if (format === "metadata" && candidateMetadataById) {
    return messagesFromThreadBatchResults(
      threadIds.map((id) => ({
        id,
        data: candidateMetadataById.get(id) ?? null,
      })),
      email,
    );
  }

  return fetchThreadMessagesForIds(accessToken, email, threadIds, format);
}

async function fetchThreadMessagesForIds(
  accessToken: string,
  email: string,
  threadIds: string[],
  format: "full" | "metadata" | "minimal",
): Promise<any[]> {
  if (threadIds.length === 0) return [];
  const batchResults = await fetchThreadBatchWithRefill(
    accessToken,
    threadIds,
    format,
  );
  return messagesFromThreadBatchResults(batchResults, email);
}

async function listGmailMessagesUncached(
  query?: string,
  maxResults = 50,
  forEmail?: string,
  pageTokens?: Record<string, string>,
  options?: ListOptions,
): Promise<ListResult> {
  const { clients, errors: refreshErrors } = await getClientsWithErrors(
    forEmail,
    options?.accountEmails,
  );
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
            forEmail,
            email,
            resolvedQuery,
            maxResults,
            pageTokens?.[email],
            threadFormat,
            options?.threadCandidateLimit,
            options?.threadRecentMessageCandidateLimit,
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
          options?.messageFormat ?? "full",
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
        errors.push({
          email,
          error: error.message,
          ...(error instanceof GmailQuotaCooldownError
            ? { isQuotaError: true, retryAfterMs: error.retryAfterMs }
            : {}),
        });
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

export function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

export function parseEmailAddress(raw: string): {
  name: string;
  email: string;
} {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    const name = match[1].trim();
    return {
      name:
        name.startsWith('"') && name.endsWith('"')
          ? name.slice(1, -1).replace(/\\"/g, '"')
          : name,
      email: match[2].trim(),
    };
  }
  return { name: raw, email: raw };
}

function splitAddressList(raw: string): string[] {
  const addresses: string[] = [];
  let start = 0;
  let inQuotes = false;
  let inAngleBrackets = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && inQuotes) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && character === "<") {
      inAngleBrackets = true;
      continue;
    }
    if (!inQuotes && character === ">") {
      inAngleBrackets = false;
      continue;
    }
    if (!inQuotes && !inAngleBrackets && character === ",") {
      addresses.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }

  const last = raw.slice(start).trim();
  if (last) addresses.push(last);
  return addresses;
}

export function parseAddressList(
  raw: string,
): Array<{ name: string; email: string }> {
  if (!raw) return [];
  return splitAddressList(raw).map(parseEmailAddress);
}

function getBody(payload: any): string {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    const textPart = payload.parts.find(
      (p: any) => p.mimeType === "text/plain",
    );
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    const part = textPart || htmlPart;
    if (part?.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
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
    for (const p of payload.parts) {
      const html = getBodyHtml(p);
      if (html) return html;
    }
  }
  return undefined;
}

function getInlineAttachments(
  payload: any,
): Map<string, { attachmentId?: string; data?: string; mimeType: string }> {
  const map = new Map<
    string,
    { attachmentId?: string; data?: string; mimeType: string }
  >();
  function walk(part: any) {
    const headers = part.headers || [];
    const contentId = headers.find(
      (h: any) => h.name.toLowerCase() === "content-id",
    )?.value;
    const attachmentId = part.body?.attachmentId;
    const data = part.body?.data;
    if (contentId && (attachmentId || data)) {
      const cid = contentId.trim().replace(/^<|>$/g, "");
      map.set(cid, {
        ...(attachmentId ? { attachmentId } : { data }),
        mimeType: part.mimeType || "image/png",
      });
    }
    if (part.parts) {
      for (const p of part.parts) walk(p);
    }
  }
  walk(payload);
  return map;
}

function replaceCidUrls(
  html: string,
  messageId: string,
  inlineAttachments: Map<
    string,
    { attachmentId?: string; data?: string; mimeType: string }
  >,
): string {
  if (inlineAttachments.size === 0) return html;
  return html.replace(/\bcid:([^\s"'<>]+)/g, (_match, cid) => {
    let decodedCid = cid;
    try {
      decodedCid = decodeURIComponent(cid);
    } catch {
      // coercion-ok: malformed CID escaping stays unresolved and visible.
    }
    const att = inlineAttachments.get(decodedCid) || inlineAttachments.get(cid);
    if (att) {
      if (att.attachmentId) {
        return `/api/attachments?messageId=${encodeURIComponent(messageId)}&id=${encodeURIComponent(att.attachmentId)}&mimeType=${encodeURIComponent(att.mimeType)}`;
      }
      if (att.data) {
        return `data:${att.mimeType};base64,${Buffer.from(att.data, "base64url").toString("base64")}`;
      }
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

const GMAIL_BATCH_MODIFY_MAX_IDS = 1000;

interface GmailBatchModifyResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
  batchCount: number;
}

async function gmailBatchModify(
  accessToken: string,
  ids: string[],
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<GmailBatchModifyResult> {
  const result: GmailBatchModifyResult = {
    succeeded: [],
    failed: [],
    batchCount: 0,
  };
  if (ids.length === 0) return result;
  for (let i = 0; i < ids.length; i += GMAIL_BATCH_MODIFY_MAX_IDS) {
    const chunk = ids.slice(i, i + GMAIL_BATCH_MODIFY_MAX_IDS);
    result.batchCount += 1;
    try {
      await googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify",
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk, addLabelIds, removeLabelIds }),
        },
      );
      result.succeeded.push(...chunk);
    } catch (err: any) {
      const error = err?.message ?? "batchModify failed";
      result.failed.push(...chunk.map((id) => ({ id, error })));
    }
  }
  return result;
}

export interface BatchModifyTarget {
  id: string;
  threadId?: string;
  accountEmail?: string;
}

export interface BatchModifyByAccountResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

export async function gmailBatchModifyByAccount(
  ownerEmail: string,
  targets: BatchModifyTarget[],
  addLabelIds: string[] | undefined,
  removeLabelIds: string[] | undefined,
): Promise<BatchModifyByAccountResult> {
  const byAccount = new Map<string, BatchModifyTarget[]>();
  for (const target of targets) {
    const key = target.accountEmail || "";
    const list = byAccount.get(key);
    if (list) list.push(target);
    else byAccount.set(key, [target]);
  }

  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const [accountEmail, accountTargets] of byAccount) {
    try {
      const accessToken = accountEmail
        ? await getOwnedAccountAccessToken(ownerEmail, accountEmail)
        : await getDefaultOwnedAccountAccessToken(ownerEmail);
      const result = await gmailBatchModify(
        accessToken,
        accountTargets.map((t) => t.id),
        addLabelIds,
        removeLabelIds,
      );
      succeeded.push(...result.succeeded);
      failed.push(...result.failed);
    } catch (err: any) {
      const message = err?.message ?? "batchModify failed";
      for (const t of accountTargets) failed.push({ id: t.id, error: message });
    }
  }

  return { succeeded, failed };
}

interface GmailMessageReference {
  id: string;
  threadId: string;
}

async function getDefaultOwnedAccountAccessToken(
  ownerEmail: string,
): Promise<string> {
  const accounts = (
    await listOAuthAccountsByOwner("google", ownerEmail)
  ).filter((account) => hasGmailScope(account.tokens));
  const account =
    accounts.find(
      (candidate) =>
        candidate.accountId.toLowerCase() === ownerEmail.toLowerCase(),
    ) ?? accounts[0];
  if (!account) {
    const managed = await resolveManagedGmailClientForOwner(ownerEmail);
    if (managed) return managed.accessToken;
    throw new Error("No Google account connected");
  }
  const tokens = account.tokens as unknown as GoogleTokens;
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw new Error(`No valid access token for ${account.accountId}`);
  }
  return getValidAccessToken(account.accountId, tokens, ownerEmail);
}

async function getOwnedAccountAccessToken(
  ownerEmail: string,
  accountEmail: string,
): Promise<string> {
  const accounts = (
    await listOAuthAccountsByOwner("google", ownerEmail)
  ).filter((account) => hasGmailScope(account.tokens));
  const account = accounts.find(
    (candidate) =>
      candidate.accountId.toLowerCase() === accountEmail.toLowerCase(),
  );
  if (!account) {
    const managed = await resolveManagedGmailClientForOwner(ownerEmail);
    if (managed && managed.email.toLowerCase() === accountEmail.toLowerCase()) {
      return managed.accessToken;
    }
    throw new Error(`Account ${accountEmail} is not connected for this user`);
  }
  const tokens = account.tokens as unknown as GoogleTokens;
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw new Error(`No valid access token for ${account.accountId}`);
  }
  return getValidAccessToken(account.accountId, tokens, ownerEmail);
}

async function listGmailMessageReferences(
  accessToken: string,
  query: string,
): Promise<GmailMessageReference[]> {
  const references = new Map<string, GmailMessageReference>();
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;

  do {
    const response = await gmailListMessages(accessToken, {
      q: query,
      maxResults: 500,
      pageToken,
    });
    for (const message of response.messages ?? []) {
      if (
        typeof message.id !== "string" ||
        typeof message.threadId !== "string"
      )
        continue;
      references.set(message.id, {
        id: message.id,
        threadId: message.threadId,
      });
    }

    const nextPageToken = response.nextPageToken;
    if (typeof nextPageToken !== "string" || !nextPageToken) break;
    if (seenPageTokens.has(nextPageToken)) {
      throw new Error(
        "Gmail repeated a pagination token while listing unread mail",
      );
    }
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  } while (pageToken);

  return [...references.values()];
}

export async function markAllUnreadReadForAccount(input: {
  ownerEmail: string;
  accountEmail: string;
  excludeThreadIds: string[];
}): Promise<BulkMarkReadResult> {
  const { ownerEmail, accountEmail } = input;
  const excludedThreadIds = new Set(input.excludeThreadIds.filter(Boolean));
  const accessToken = await getOwnedAccountAccessToken(
    ownerEmail,
    accountEmail,
  );
  const matched = await listGmailMessageReferences(accessToken, "is:unread");
  const excluded = matched.filter((message) =>
    excludedThreadIds.has(message.threadId),
  );
  const selected = matched.filter(
    (message) => !excludedThreadIds.has(message.threadId),
  );

  const mutation = await gmailBatchModify(
    accessToken,
    selected.map((message) => message.id),
    undefined,
    ["UNREAD"],
  );
  invalidateHistoryCacheForAccount(accountEmail);
  invalidateListCacheForOwner(ownerEmail);
  for (const threadId of new Set(selected.map((message) => message.threadId))) {
    invalidateThreadCache(ownerEmail, threadId);
  }

  let remaining: GmailMessageReference[];
  try {
    remaining = await listGmailMessageReferences(accessToken, "is:unread");
  } catch (err: any) {
    return {
      mode: "all-unread",
      accountEmail,
      matchedMessages: matched.length,
      matchedThreads: new Set(matched.map((message) => message.threadId)).size,
      excludedMessages: excluded.length,
      excludedThreads: new Set(excluded.map((message) => message.threadId))
        .size,
      changedMessages: mutation.succeeded.length,
      batchCount: mutation.batchCount,
      failures: mutation.failed,
      remainingUnreadMessages: null,
      remainingUnreadThreads: null,
      remainingProtectedMessages: null,
      remainingProtectedThreads: null,
      unexpectedUnreadMessages: null,
      unexpectedUnreadThreads: null,
      newUnreadMessages: null,
      newUnreadThreads: null,
      verificationComplete: false,
      verificationError: err?.message ?? "Unread verification failed",
    };
  }
  const matchedIds = new Set(matched.map((message) => message.id));
  const selectedIds = new Set(selected.map((message) => message.id));
  const remainingProtected = remaining.filter((message) =>
    excludedThreadIds.has(message.threadId),
  );
  const unexpectedRemaining = remaining.filter((message) =>
    selectedIds.has(message.id),
  );
  const newUnread = remaining.filter((message) => !matchedIds.has(message.id));

  return {
    mode: "all-unread",
    accountEmail,
    matchedMessages: matched.length,
    matchedThreads: new Set(matched.map((message) => message.threadId)).size,
    excludedMessages: excluded.length,
    excludedThreads: new Set(excluded.map((message) => message.threadId)).size,
    changedMessages: mutation.succeeded.length,
    batchCount: mutation.batchCount,
    failures: mutation.failed,
    remainingUnreadMessages: remaining.length,
    remainingUnreadThreads: new Set(
      remaining.map((message) => message.threadId),
    ).size,
    remainingProtectedMessages: remainingProtected.length,
    remainingProtectedThreads: new Set(
      remainingProtected.map((message) => message.threadId),
    ).size,
    unexpectedUnreadMessages: unexpectedRemaining.length,
    unexpectedUnreadThreads: new Set(
      unexpectedRemaining.map((message) => message.threadId),
    ).size,
    newUnreadMessages: newUnread.length,
    newUnreadThreads: new Set(newUnread.map((message) => message.threadId))
      .size,
    verificationComplete:
      mutation.failed.length === 0 && unexpectedRemaining.length === 0,
  };
}

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
    if (attachmentId && filename) {
      const headers = part.headers || [];
      const contentDisposition = headers
        .find((h: any) => h.name.toLowerCase() === "content-disposition")
        ?.value?.toLowerCase();
      const contentId = headers.find(
        (h: any) => h.name.toLowerCase() === "content-id",
      )?.value;
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

const accountDisplayNames = new Map<string, string>();

export function setAccountDisplayName(email: string, name: string) {
  if (email && name) accountDisplayNames.set(email.toLowerCase(), name);
}

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
    snippet: decodeCommonHtmlEntities(msg.snippet || ""),
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
      .filter((l: string) => !["UNREAD", "STARRED"].includes(l))
      .map((l: string) => {
        const categoryMap: Record<string, string> = {
          IMPORTANT: "important",
          CATEGORY_PERSONAL: "personal",
          CATEGORY_SOCIAL: "social",
          CATEGORY_UPDATES: "updates",
          CATEGORY_PROMOTIONS: "promotions",
          CATEGORY_FORUMS: "forums",
        };
        if (categoryMap[l]) return categoryMap[l];
        const name = labelMap?.get(l) || l;
        return name.replace(/_/g, " ").toLowerCase();
      }),
    attachments: attachments.length > 0 ? attachments : undefined,
    accountEmail: accountEmail || msg._accountEmail,
    ...parseUnsubscribeHeaders(headers),
  };
}

function parseUnsubscribeHeaders(
  headers: Array<{ name?: string | null; value?: string | null }>,
): { unsubscribe?: { url?: string; mailto?: string; oneClick?: boolean } } {
  const raw = getHeader(headers, "List-Unsubscribe");
  if (!raw) return {};

  const postHeader = getHeader(headers, "List-Unsubscribe-Post");
  const oneClick = postHeader
    .toLowerCase()
    .includes("list-unsubscribe=one-click");

  const entries = raw.match(/<[^>]+>/g) || [];
  let url: string | undefined;
  let mailto: string | undefined;
  for (const entry of entries) {
    const val = entry.slice(1, -1);
    if (val.startsWith("http://") || val.startsWith("https://")) {
      url = val;
    } else if (val.startsWith("mailto:")) {
      mailto = val.slice(7);
    }
  }

  if (!url && !mailto) return {};
  return { unsubscribe: { url, mailto, oneClick } };
}
