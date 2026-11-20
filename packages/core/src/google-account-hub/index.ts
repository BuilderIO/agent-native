import { randomUUID } from "node:crypto";

import { canonicalA2AAudience } from "../a2a/audience.js";
import { signA2AToken } from "../a2a/client.js";
import { getAppConfig } from "../app-config/index.js";
import { readDeployCredentialEnv } from "../server/credential-provider.js";

export const GOOGLE_ACCOUNT_HUB_SCOPE = "google-account-hub";
export const GOOGLE_ACCOUNT_HUB_TOKEN_PATH =
  "/_agent-native/google-accounts/token";

const HUB_URL_ENV = "AGENT_NATIVE_GOOGLE_ACCOUNT_HUB_URL";
const FEDERATION_SECRET_ENV = "AGENT_NATIVE_IDENTITY_FEDERATION_SECRET";
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_REUSE_MARGIN_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;

export interface HubGoogleAccount {
  accountEmail: string;
  connectionId: string;
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
}

export interface HubGoogleAccountError {
  accountEmail: string;
  connectionId: string;
  error: string;
  needsReconnect: boolean;
}

export interface HubGoogleAccountsResult {
  accounts: HubGoogleAccount[];
  errors: HubGoogleAccountError[];
}

export interface ListHubGoogleAccountsOptions {
  /**
   * The calling app's ID, as Dispatch's app registry knows it. A configured
   * app identity (`AGENT_NATIVE_APP_ID` and friends) wins, the same as for
   * organization federation, so a deployment can register under its own ID.
   */
  appId: string;
  /** The person the tokens are for. */
  userEmail: string;
  /** Workspace connection provider, such as `google_calendar` or `gmail`. */
  provider: string;
}

export class GoogleAccountHubError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "GoogleAccountHubError";
    this.status = status;
  }
}

function normalizeHubUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && LOCALHOST_HOSTS.has(url.hostname);
    if (
      (url.protocol !== "https:" && !local) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    // coercion-ok: an unparseable hub URL means no hub is configured, the same as a missing one
    return null;
  }
}

/** The Dispatch origin that holds Google accounts, when one is configured. */
export function getGoogleAccountHubUrl(): string | null {
  return normalizeHubUrl(readDeployCredentialEnv(HUB_URL_ENV));
}

function resolveAppId(fallback: string): string {
  const app = getAppConfig().app;
  return app.id ?? app.workspaceId ?? fallback;
}

function federationSecret(): string | null {
  return readDeployCredentialEnv(FEDERATION_SECRET_ENV)?.trim() || null;
}

/**
 * True when this deployment can ask Dispatch for Google tokens: a hub URL
 * and this app's federation secret are both set.
 */
export function isGoogleAccountHubConfigured(): boolean {
  return Boolean(getGoogleAccountHubUrl() && federationSecret());
}

type CacheEntry = { result: HubGoogleAccountsResult; reusableUntil: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<HubGoogleAccountsResult>>();

function cacheKey(options: ListHubGoogleAccountsOptions): string {
  return [
    resolveAppId(options.appId),
    options.provider,
    options.userEmail.trim().toLowerCase(),
  ].join("\n");
}

function remember(key: string, result: HubGoogleAccountsResult): void {
  const soonest = result.accounts.reduce(
    (min, account) => Math.min(min, account.expiresAt),
    Number.POSITIVE_INFINITY,
  );
  const reusableUntil = Number.isFinite(soonest)
    ? soonest - TOKEN_REUSE_MARGIN_MS
    : Date.now() + 30_000;
  if (reusableUntil <= Date.now()) return;
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { result, reusableUntil });
}

/** Drops cached tokens, for one person or everyone. */
export function clearGoogleAccountHubCache(userEmail?: string): void {
  if (!userEmail) {
    cache.clear();
    return;
  }
  const normalized = userEmail.trim().toLowerCase();
  for (const key of cache.keys()) {
    if (key.endsWith(`\n${normalized}`)) cache.delete(key);
  }
}

function parseResult(body: unknown, now: number): HubGoogleAccountsResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const accounts: HubGoogleAccount[] = [];
  const errors: HubGoogleAccountError[] = [];
  for (const raw of Array.isArray(record.accounts) ? record.accounts : []) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const accountEmail =
      typeof item.account_email === "string" ? item.account_email : "";
    const connectionId =
      typeof item.connection_id === "string" ? item.connection_id : "";
    const accessToken =
      typeof item.access_token === "string" ? item.access_token : "";
    const expiresIn =
      typeof item.expires_in === "number" && item.expires_in > 0
        ? item.expires_in
        : 0;
    if (!accountEmail || !connectionId || !accessToken || !expiresIn) continue;
    accounts.push({
      accountEmail,
      connectionId,
      accessToken,
      expiresAt: now + expiresIn * 1000,
      scopes:
        typeof item.scope === "string"
          ? item.scope.split(/\s+/).filter(Boolean)
          : [],
    });
  }
  for (const raw of Array.isArray(record.errors) ? record.errors : []) {
    const item = (raw ?? {}) as Record<string, unknown>;
    if (typeof item.account_email !== "string") continue;
    errors.push({
      accountEmail: item.account_email,
      connectionId:
        typeof item.connection_id === "string" ? item.connection_id : "",
      error: typeof item.error === "string" ? item.error : "unavailable",
      needsReconnect: item.needs_reconnect === true,
    });
  }
  return { accounts, errors };
}

async function requestHubGoogleAccounts(
  options: ListHubGoogleAccountsOptions,
): Promise<HubGoogleAccountsResult> {
  const hub = getGoogleAccountHubUrl();
  const secret = federationSecret();
  if (!hub || !secret) {
    throw new GoogleAccountHubError(
      "The Google account hub is not configured for this app.",
    );
  }
  const userEmail = options.userEmail.trim().toLowerCase();
  if (!userEmail.includes("@")) {
    throw new GoogleAccountHubError("A signed-in user is required.");
  }
  const assertion = await signA2AToken(userEmail, undefined, secret, {
    audience: canonicalA2AAudience(hub),
    expiresIn: "2m",
    extraClaims: {
      app_id: resolveAppId(options.appId),
      scope: GOOGLE_ACCOUNT_HUB_SCOPE,
      jti: randomUUID(),
    },
  });
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${hub}${GOOGLE_ACCOUNT_HUB_TOKEN_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${assertion}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ provider: options.provider }),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new GoogleAccountHubError(
      `The Google account hub could not be reached: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!response.ok) {
    throw new GoogleAccountHubError(
      `The Google account hub answered ${response.status}.`,
      response.status,
    );
  }
  return parseResult(await response.json(), startedAt);
}

/**
 * Every Google account Dispatch holds for this person that this app may use,
 * each with a short-lived access token. Cached until a minute before the
 * soonest token expires.
 */
export async function listHubGoogleAccounts(
  options: ListHubGoogleAccountsOptions,
): Promise<HubGoogleAccountsResult> {
  const key = cacheKey(options);
  const cached = cache.get(key);
  if (cached && cached.reusableUntil > Date.now()) return cached.result;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = requestHubGoogleAccounts(options)
    .then((result) => {
      remember(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

/** One account's token from the hub, or null when Dispatch doesn't hold it. */
export async function getHubGoogleAccount(
  options: ListHubGoogleAccountsOptions & { accountEmail: string },
): Promise<HubGoogleAccount | null> {
  const wanted = options.accountEmail.trim().toLowerCase();
  const { accounts } = await listHubGoogleAccounts(options);
  return (
    accounts.find(
      (account) => account.accountEmail.trim().toLowerCase() === wanted,
    ) ?? null
  );
}
