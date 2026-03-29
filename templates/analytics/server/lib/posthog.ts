// PostHog API helper
// Queries events, insights, and trends

const DEFAULT_HOST = "https://app.posthog.com";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 100;

function getConfig(): { apiKey: string; projectId: string; host: string } {
  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const host = process.env.POSTHOG_HOST ?? DEFAULT_HOST;
  if (!apiKey) throw new Error("POSTHOG_API_KEY env var required");
  if (!projectId) throw new Error("POSTHOG_PROJECT_ID env var required");
  return { apiKey, projectId, host: host.replace(/\/$/, "") };
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = cacheKey ?? path;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const { apiKey, host } = getConfig();
  const res = await fetch(`${host}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cacheSet(key, data);
  return data as T;
}

async function apiPost<T>(
  path: string,
  body: unknown,
  cacheKey?: string,
): Promise<T> {
  const key = cacheKey;
  if (key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  const { apiKey, host } = getConfig();
  const res = await fetch(`${host}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (key) cacheSet(key, data);
  return data as T;
}

// -- Types --

export interface PostHogEvent {
  id: string;
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
  distinct_id: string;
}

export interface PostHogEventResponse {
  results: PostHogEvent[];
  next?: string;
}

export interface PostHogInsight {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  result: unknown;
  created_at: string;
}

export interface PostHogTrendResult {
  result: {
    action: { id: string; name: string };
    label: string;
    count: number;
    data: number[];
    labels: string[];
    days: string[];
  }[];
}

// -- API functions --

export function getPostHogClient() {
  const config = getConfig();
  return { projectId: config.projectId, host: config.host, apiGet, apiPost };
}

export async function queryEvents(
  eventName?: string,
  limit = 100,
  after?: string,
): Promise<PostHogEventResponse> {
  const { projectId } = getConfig();
  const params = new URLSearchParams({ limit: String(limit) });
  if (eventName) params.set("event", eventName);
  if (after) params.set("after", after);
  return apiGet<PostHogEventResponse>(
    `/api/projects/${projectId}/events/?${params.toString()}`,
  );
}

export async function getInsights(
  limit = 20,
): Promise<{ results: PostHogInsight[] }> {
  const { projectId } = getConfig();
  return apiGet<{ results: PostHogInsight[] }>(
    `/api/projects/${projectId}/insights/?limit=${limit}`,
  );
}

export async function getTrends(
  events: { id: string; name?: string }[],
  dateFrom?: string,
  dateTo?: string,
): Promise<PostHogTrendResult> {
  const { projectId } = getConfig();
  const body = {
    insight: "TRENDS",
    events: events.map((e) => ({
      id: e.id,
      name: e.name ?? e.id,
      type: "events",
    })),
    date_from: dateFrom ?? "-7d",
    date_to: dateTo,
  };
  return apiPost<PostHogTrendResult>(
    `/api/projects/${projectId}/insights/trend/`,
    body,
    `trends-${JSON.stringify(events)}-${dateFrom}-${dateTo}`,
  );
}

export async function testConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const { projectId } = getConfig();
    await apiGet(`/api/projects/${projectId}/`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
