// Pylon support platform API helper
// Fetches accounts, issues, and contacts

import { resolveCredential } from "./credentials";
import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";

const API_BASE = "https://api.usepylon.com";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes("429");
}

function parseRetryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

async function pylonFetch(path: string, init?: RequestInit): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 429 && attempt < 4) {
      const retryMs = parseRetryAfterMs(res) ?? 2000 * 2 ** attempt;
      await sleep(Math.min(retryMs, 60_000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      lastError = new Error(`Pylon API error ${res.status}: ${text}`);
      break;
    }
    return res;
  }
  throw lastError ?? new Error("Pylon API request failed");
}

async function getToken(): Promise<string> {
  const ctx = requireRequestCredentialContext("PYLON_API_KEY");
  const token = await resolveCredential("PYLON_API_KEY", ctx);
  if (!token) throw new Error("PYLON_API_KEY not configured");
  return token;
}

async function apiPost<T>(
  path: string,
  body: unknown,
  cacheKey?: string,
): Promise<T> {
  const key = cacheKey
    ? scopedCredentialCacheKey(cacheKey, "PYLON_API_KEY")
    : null;
  if (key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  const res = await pylonFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (key) {
    if (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, { data, ts: Date.now() });
  }

  return data as T;
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = scopedCredentialCacheKey(cacheKey ?? path, "PYLON_API_KEY");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await pylonFetch(path);
  const data = await res.json();

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });

  return data as T;
}

export interface PylonAccount {
  id: string;
  name: string;
  domain?: string;
  primary_domain?: string;
  // Pylon returns flat strings; some integrations wrap as { value }.
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PylonIssue {
  id: string;
  title: string;
  state: string;
  priority?: string;
  account_id?: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export async function getAccounts(query?: string): Promise<PylonAccount[]> {
  const path = query
    ? `/accounts?query=${encodeURIComponent(query)}`
    : "/accounts";
  const data = await apiGet<{ data: PylonAccount[] }>(path);
  return data.data ?? (data as any);
}

// Default accounts flagged with a risk sentiment in Pylon before HubSpot's
// risk-status property has caught up — the early-warning cohort for the risk
// review. Callers pass sentiment lists via build-secondary-cohort params.
export const PYLON_RISK_SENTIMENTS = new Set([
  "frustrated",
  "high_risk_detractor",
]);

export function isRiskSentiment(
  sentiment: string | null | undefined,
  riskSentiments: Set<string> | string[] = PYLON_RISK_SENTIMENTS,
): boolean {
  if (!sentiment) return false;
  const set =
    riskSentiments instanceof Set ? riskSentiments : new Set(riskSentiments);
  return set.has(sentiment.toLowerCase());
}

// Default field-name mapping. CSMs set `general_sentiment` on managed
// enterprise accounts synced from HubSpot; `account.hubspot.root_org_id` /
// `account.hubspot.domain` are the HubSpot-synced join keys Pylon stores as
// custom fields. Callers pass field names via build-secondary-cohort params so a
// different CRM/Pylon field layout doesn't require code changes.
export interface PylonSentimentMapFields {
  sentimentField: string;
  rootOrgIdField: string;
  domainField: string;
}

export const DEFAULT_PYLON_SENTIMENT_FIELDS: PylonSentimentMapFields = {
  sentimentField: "general_sentiment",
  rootOrgIdField: "account.hubspot.root_org_id",
  domainField: "account.hubspot.domain",
};

function readPylonCustomField(
  account: PylonAccount,
  field: string,
): string | null {
  const entry = account.custom_fields?.[field];
  if (entry == null) return null;
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed || null;
  }
  if (typeof entry === "object") {
    const raw =
      "value" in entry
        ? (entry as { value?: unknown }).value
        : "values" in entry &&
            Array.isArray((entry as { values?: unknown[] }).values)
          ? (entry as { values: unknown[] }).values[0]
          : undefined;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      return trimmed || null;
    }
  }
  return null;
}

function extractSentiment(
  account: PylonAccount,
  fields: PylonSentimentMapFields,
): string | null {
  const raw = readPylonCustomField(account, fields.sentimentField);
  return raw ? raw.toLowerCase() : null;
}

function extractRootOrgId(
  account: PylonAccount,
  fields: PylonSentimentMapFields,
): string | null {
  return readPylonCustomField(account, fields.rootOrgIdField);
}

function extractDomain(
  account: PylonAccount,
  fields: PylonSentimentMapFields,
): string | null {
  const raw =
    readPylonCustomField(account, fields.domainField) ||
    account.primary_domain ||
    account.domain;
  return typeof raw === "string" && raw.trim()
    ? raw.trim().toLowerCase()
    : null;
}

function accountToSentimentEntry(
  account: PylonAccount,
  fields: PylonSentimentMapFields,
): PylonSentimentEntry | null {
  const sentiment = extractSentiment(account, fields);
  if (!sentiment) return null;
  const rootOrgId = extractRootOrgId(account, fields);
  const domain = extractDomain(account, fields);
  return {
    sentiment,
    pylonAccountId: account.id,
    accountName: account.name,
    rootOrgId,
    domain,
  };
}

function addSentimentEntry(
  sentimentMap: PylonSentimentMap,
  entry: PylonSentimentEntry,
): void {
  if (entry.rootOrgId) sentimentMap.set(entry.rootOrgId, entry);
  if (entry.domain) sentimentMap.set(entry.domain, entry);
}

interface PylonListResponse {
  data?: PylonAccount[];
  pagination?: { cursor?: string | null; has_next_page?: boolean };
}

async function searchPylonAccounts(options: {
  filter?: Record<string, unknown>;
  limit?: number;
  maxPages?: number;
  cacheKey?: string;
}): Promise<PylonAccount[]> {
  const all: PylonAccount[] = [];
  let cursor: string | undefined;
  const limit = Math.max(1, Math.min(100, options.limit ?? 100));
  const maxPages = Math.max(1, options.maxPages ?? 50);

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = { limit };
    if (options.filter) body.filter = options.filter;
    if (cursor) body.cursor = cursor;
    const data = await apiPost<PylonListResponse>(
      "/accounts/search",
      body,
      options.cacheKey ? `${options.cacheKey}:${cursor ?? "start"}` : undefined,
    );
    all.push(...(data.data ?? []));
    cursor = data.pagination?.cursor ?? undefined;
    if (!cursor || !data.pagination?.has_next_page) break;
    await sleep(250);
  }

  return all;
}

function accountsToSentimentMap(
  accounts: PylonAccount[],
  fields: PylonSentimentMapFields,
  predicate?: (sentiment: string) => boolean,
): PylonSentimentMap {
  const sentimentMap: PylonSentimentMap = new Map();
  for (const account of accounts) {
    const entry = accountToSentimentEntry(account, fields);
    if (!entry) continue;
    if (predicate && !predicate(entry.sentiment)) continue;
    addSentimentEntry(sentimentMap, entry);
  }
  return sentimentMap;
}

async function searchPylonAccountsWithFilters(
  filters: Record<string, unknown>[],
  cacheKeyPrefix: string,
  options?: { maxPages?: number },
): Promise<PylonAccount[]> {
  for (const filter of filters) {
    try {
      const accounts = await searchPylonAccounts({
        filter,
        cacheKey: `${cacheKeyPrefix}:${JSON.stringify(filter)}`,
        maxPages: options?.maxPages ?? 5,
      });
      if (accounts.length) return accounts;
    } catch (error) {
      if (isRateLimitError(error)) throw error;
      // Try the next filter shape supported by the tenant's Pylon workspace.
    }
  }
  return [];
}

const listAccountsInflight = new Map<string, Promise<PylonAccount[]>>();

async function getCachedPylonAccountsBySentiment(
  fields: PylonSentimentMapFields,
  normalized: string[],
): Promise<PylonAccount[]> {
  const cacheKey = scopedCredentialCacheKey(
    `pylon-accounts-by-sentiment:${fields.sentimentField}:${normalized.join(",")}`,
    "PYLON_API_KEY",
  );
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as PylonAccount[];
  }

  const inflight = listAccountsInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = fetchPylonAccountsBySentiment(fields, normalized)
    .then((accounts) => {
      cache.set(cacheKey, { data: accounts, ts: Date.now() });
      return accounts;
    })
    .catch((error) => {
      if (isRateLimitError(error) && cached) {
        return cached.data as PylonAccount[];
      }
      throw error;
    })
    .finally(() => {
      listAccountsInflight.delete(cacheKey);
    });
  listAccountsInflight.set(cacheKey, promise);
  return promise;
}

async function fetchPylonAccountsBySentiment(
  fields: PylonSentimentMapFields,
  normalized: string[],
): Promise<PylonAccount[]> {
  const matchAccounts = (raw: PylonAccount[]) =>
    raw.filter((account) => {
      const sentiment = extractSentiment(account, fields);
      return sentiment ? normalized.includes(sentiment) : false;
    });

  const seenIds = new Set<string>();
  const mergeUnique = (raw: PylonAccount[]) => {
    const out: PylonAccount[] = [];
    for (const account of raw) {
      if (seenIds.has(account.id)) continue;
      seenIds.add(account.id);
      out.push(account);
    }
    return out;
  };

  // Fast path: one bounded GET per sentiment value (typically <5s total).
  try {
    const batches = await Promise.all(
      normalized.map((value) => getAccounts(value)),
    );
    const matched = matchAccounts(mergeUnique(batches.flat()));
    if (matched.length) return matched;
  } catch (error) {
    if (isRateLimitError(error)) return [];
    throw error;
  }

  // Structured search fallback (capped pages — unbounded pagination was timing out).
  try {
    const searchFilters: Record<string, unknown>[] = [
      { field: fields.sentimentField, operator: "in", values: normalized },
      ...normalized.map((value) => ({
        field: fields.sentimentField,
        operator: "equals",
        value,
      })),
    ];
    const searched = await searchPylonAccountsWithFilters(
      searchFilters,
      "risk-pylon-search",
      { maxPages: 2 },
    );
    const matched = matchAccounts(searched);
    if (matched.length) return matched;
  } catch (error) {
    if (isRateLimitError(error)) return [];
    throw error;
  }

  const fullCacheKey = scopedCredentialCacheKey(
    "accounts-full",
    "PYLON_API_KEY",
  );
  const fullCached = cache.get(fullCacheKey);
  if (fullCached) {
    return matchAccounts(fullCached.data as PylonAccount[]);
  }

  return [];
}

async function loadRiskPylonSentimentMap(
  fields: PylonSentimentMapFields,
  normalized: string[],
): Promise<PylonSentimentMap> {
  const accounts = await getCachedPylonAccountsBySentiment(fields, normalized);
  if (!accounts.length) return new Map();
  return accountsToSentimentMap(accounts, fields, (sentiment) =>
    normalized.includes(sentiment),
  );
}

export type PylonAccountRecord = {
  id: string;
  name: string;
  domain: string | null;
  properties: Record<string, unknown>;
};

export type ListPylonAccountsOptions = {
  sentimentField?: string;
  sentimentValues?: string[];
  rootOrgIdField?: string;
  domainField?: string;
  query?: string;
  limit?: number;
};

function normalizePylonAccountRecord(
  account: PylonAccount,
  fields: PylonSentimentMapFields,
): PylonAccountRecord {
  const properties: Record<string, unknown> = {};
  for (const key of Object.keys(account.custom_fields ?? {})) {
    properties[key] = readPylonCustomField(account, key);
  }
  const sentiment = extractSentiment(account, fields);
  if (sentiment) properties[fields.sentimentField] = sentiment;
  const rootOrgId = extractRootOrgId(account, fields);
  if (rootOrgId) properties[fields.rootOrgIdField] = rootOrgId;
  const domain = extractDomain(account, fields);
  if (domain) properties[fields.domainField] = domain;

  return {
    id: account.id,
    name: account.name,
    domain: account.primary_domain ?? account.domain ?? null,
    properties,
  };
}

/** Bounded Pylon account fetch — filters come from action params, not app-specific orchestration. */
export async function listPylonAccounts(
  options: ListPylonAccountsOptions = {},
): Promise<{
  accounts: PylonAccountRecord[];
  total: number;
  truncated: boolean;
  guidance: string;
}> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 100));
  const fields: PylonSentimentMapFields = {
    sentimentField:
      options.sentimentField ?? DEFAULT_PYLON_SENTIMENT_FIELDS.sentimentField,
    rootOrgIdField:
      options.rootOrgIdField ?? DEFAULT_PYLON_SENTIMENT_FIELDS.rootOrgIdField,
    domainField:
      options.domainField ?? DEFAULT_PYLON_SENTIMENT_FIELDS.domainField,
  };

  let accounts: PylonAccount[] = [];
  const trimmedQuery = options.query?.trim();
  if (options.sentimentValues?.length) {
    const normalized = options.sentimentValues.map((value) =>
      value.toLowerCase(),
    );
    accounts = await getCachedPylonAccountsBySentiment(fields, normalized);
  } else if (trimmedQuery) {
    accounts = await getAccounts(trimmedQuery);
  } else {
    return {
      accounts: [],
      total: 0,
      truncated: false,
      guidance:
        "Pass sentimentValues (filter on sentimentField) or query to search Pylon accounts.",
    };
  }

  const total = accounts.length;
  const slice = accounts.slice(0, limit);
  return {
    accounts: slice.map((account) =>
      normalizePylonAccountRecord(account, fields),
    ),
    total,
    truncated: total > slice.length,
    guidance: options.sentimentValues?.length
      ? `Loaded Pylon accounts where ${fields.sentimentField} matches ${options.sentimentValues.join(", ")}.`
      : `Loaded Pylon accounts matching query "${trimmedQuery}".`,
  };
}

/** Risk-sentiment accounts only — avoids paginating the full Pylon catalog. */
export async function getRiskPylonSentimentMap(
  fields: PylonSentimentMapFields = DEFAULT_PYLON_SENTIMENT_FIELDS,
  riskSentiments: string[] = [...PYLON_RISK_SENTIMENTS],
): Promise<PylonSentimentMap> {
  const normalized = riskSentiments.map((value) => value.toLowerCase());
  const cacheKey = scopedCredentialCacheKey(
    `risk-sentiment-map:${fields.sentimentField}:${normalized.join(",")}`,
    "PYLON_API_KEY",
  );
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as PylonSentimentMap;
  }

  const inflight = riskMapInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = loadRiskPylonSentimentMap(fields, normalized)
    .then((map) => {
      cache.set(cacheKey, { data: map, ts: Date.now() });
      return map;
    })
    .catch((error) => {
      if (isRateLimitError(error) && cached) {
        return cached.data as PylonSentimentMap;
      }
      throw error;
    })
    .finally(() => {
      riskMapInflight.delete(cacheKey);
    });
  riskMapInflight.set(cacheKey, promise);
  return promise;
}

/** Lookup Pylon sentiment for a bounded HubSpot company join-key set. */
export async function getPylonSentimentMapForJoinKeys(
  joinKeys: { rootOrgIds: string[]; domains: string[] },
  fields: PylonSentimentMapFields = DEFAULT_PYLON_SENTIMENT_FIELDS,
): Promise<PylonSentimentMap> {
  const rootOrgIds = Array.from(new Set(joinKeys.rootOrgIds.filter(Boolean)));
  const domains = Array.from(
    new Set(joinKeys.domains.filter(Boolean).map((d) => d.toLowerCase())),
  );
  if (!rootOrgIds.length && !domains.length) return new Map();

  const sentimentMap: PylonSentimentMap = new Map();

  for (let i = 0; i < rootOrgIds.length; i += 50) {
    const batch = rootOrgIds.slice(i, i + 50);
    try {
      const accounts = await searchPylonAccountsWithFilters(
        [{ field: fields.rootOrgIdField, operator: "in", values: batch }],
        `pylon-root-org:${batch.join(",")}`,
      );
      for (const account of accounts) {
        const entry = accountToSentimentEntry(account, fields);
        if (entry) addSentimentEntry(sentimentMap, entry);
      }
    } catch (error) {
      if (isRateLimitError(error)) break;
    }
    if (i + 50 < rootOrgIds.length) await sleep(300);
  }

  for (let i = 0; i < domains.length; i += 50) {
    const batch = domains.slice(i, i + 50);
    try {
      const accounts = await searchPylonAccountsWithFilters(
        [{ field: "domain", operator: "in", values: batch }],
        `pylon-domain:${batch.join(",")}`,
      );
      for (const account of accounts) {
        const entry = accountToSentimentEntry(account, fields);
        if (entry) addSentimentEntry(sentimentMap, entry);
      }
    } catch (error) {
      if (isRateLimitError(error)) break;
    }
    if (i + 50 < domains.length) await sleep(300);
  }

  return sentimentMap;
}

export async function getAllPylonAccounts(): Promise<PylonAccount[]> {
  const fullCacheKey = scopedCredentialCacheKey(
    "accounts-full",
    "PYLON_API_KEY",
  );
  const cached = cache.get(fullCacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as PylonAccount[];
  }

  const all: PylonAccount[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const data = await apiGet<{
      data: PylonAccount[];
      pagination?: { cursor?: string | null; has_next_page?: boolean };
    }>(`/accounts?${params.toString()}`, `accounts:page:${cursor ?? "start"}`);
    all.push(...(data.data ?? []));
    cursor = data.pagination?.cursor ?? undefined;
    if (!cursor || !data.pagination?.has_next_page) break;
  }

  cache.set(fullCacheKey, { data: all, ts: Date.now() });
  return all;
}

export interface PylonSentimentEntry {
  sentiment: string;
  pylonAccountId: string;
  accountName: string;
  rootOrgId: string | null;
  domain: string | null;
}

// Keyed by BOTH HubSpot root_org_id (primary) and company domain (fallback) —
// root_org_id is a hex string and domains contain dots, so there's no key
// collision keeping both in one map, matching the CRM company join below.
export type PylonSentimentMap = Map<string, PylonSentimentEntry>;

const riskMapInflight = new Map<string, Promise<PylonSentimentMap>>();

export async function getPylonSentimentMap(
  fields: PylonSentimentMapFields = DEFAULT_PYLON_SENTIMENT_FIELDS,
): Promise<PylonSentimentMap> {
  const accounts = await getAllPylonAccounts();
  return accountsToSentimentMap(accounts, fields);
}

export async function getAccount(id: string): Promise<PylonAccount> {
  return apiGet<PylonAccount>(`/accounts/${id}`);
}

export async function getIssues(params?: {
  account_id?: string;
  state?: string;
  query?: string;
}): Promise<PylonIssue[]> {
  const searchParams = new URLSearchParams();
  if (params?.account_id) searchParams.set("account_id", params.account_id);
  if (params?.state) searchParams.set("state", params.state);
  if (params?.query) searchParams.set("query", params.query);
  // Pylon requires start_time and end_time — max 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  searchParams.set("start_time", thirtyDaysAgo.toISOString());
  searchParams.set("end_time", now.toISOString());
  const qs = searchParams.toString();
  const path = `/issues${qs ? `?${qs}` : ""}`;
  const data = await apiGet<{ data: PylonIssue[] }>(path);
  return data.data ?? (data as any);
}

export async function getContacts(query?: string): Promise<unknown[]> {
  const path = query
    ? `/contacts?query=${encodeURIComponent(query)}`
    : "/contacts";
  const data = await apiGet<{ data: unknown[] }>(path);
  return data.data ?? (data as any);
}
