// Pylon support platform API helper
// Fetches accounts, issues, and contacts

const API_BASE = "https://api.usepylon.com";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 120;

function getToken(): string {
  const token = process.env.PYLON_API_KEY;
  if (!token) throw new Error("PYLON_API_KEY env var required");
  return token;
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = cacheKey ?? path;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
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

async function apiPost<T>(
  path: string,
  body: unknown,
  cacheKey?: string,
): Promise<T> {
  const key = cacheKey ?? `POST:${path}:${JSON.stringify(body)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
