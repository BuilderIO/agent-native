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

async function getToken(): Promise<string> {
  const ctx = requireRequestCredentialContext("PYLON_API_KEY");
  const token = await resolveCredential("PYLON_API_KEY", ctx);
  if (!token) throw new Error("PYLON_API_KEY not configured");
  return token;
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = scopedCredentialCacheKey(cacheKey ?? path, "PYLON_API_KEY");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pylon API error ${res.status}: ${text}`);
  }

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

// Accounts flagged with a risk sentiment in Pylon before HubSpot's
// `risk_status` has caught up — the early-warning cohort for the risk review.
export const PYLON_RISK_SENTIMENTS = new Set([
  "frustrated",
  "high_risk_detractor",
]);

export function isRiskSentiment(sentiment: string | null | undefined): boolean {
  return !!sentiment && PYLON_RISK_SENTIMENTS.has(sentiment.toLowerCase());
}

function extractSentiment(account: PylonAccount): string | null {
  const raw =
    (account.sentiment as string | undefined) ??
    (account.health_sentiment as string | undefined) ??
    ((account.custom_fields as Record<string, unknown> | undefined)
      ?.sentiment as string | undefined);
  return typeof raw === "string" && raw.trim()
    ? raw.trim().toLowerCase()
    : null;
}

function extractDomain(account: PylonAccount): string | null {
  const domain = account.domain;
  return typeof domain === "string" && domain.trim()
    ? domain.trim().toLowerCase()
    : null;
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
}

export interface PylonSentimentMap {
  byAccountId: Map<string, PylonSentimentEntry>;
  byDomain: Map<string, PylonSentimentEntry>;
}

// Builds a lookup keyed by both Pylon account id and domain so HubSpot deals
// can be joined either way when enriching the risk meeting cohort.
export async function getPylonSentimentMap(): Promise<PylonSentimentMap> {
  const accounts = await getAllPylonAccounts();
  const byAccountId = new Map<string, PylonSentimentEntry>();
  const byDomain = new Map<string, PylonSentimentEntry>();

  for (const account of accounts) {
    const sentiment = extractSentiment(account);
    if (!sentiment) continue;
    const entry: PylonSentimentEntry = {
      sentiment,
      pylonAccountId: account.id,
      accountName: account.name,
    };
    byAccountId.set(account.id, entry);
    const domain = extractDomain(account);
    if (domain) byDomain.set(domain, entry);
  }

  return { byAccountId, byDomain };
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
