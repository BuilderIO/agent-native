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
