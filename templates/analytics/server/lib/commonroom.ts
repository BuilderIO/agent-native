// Common Room community platform API helper
// Fetches community members, activities, and segments

const API_BASE = "https://api.commonroom.io/community/v1";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 120;

function getToken(): string {
  const token = process.env.COMMONROOM_API_TOKEN;
  if (!token) throw new Error("COMMONROOM_API_TOKEN env var required");
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
    throw new Error(`Common Room API error ${res.status}: ${text}`);
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
    throw new Error(`Common Room API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });

  return data as T;
}

export interface CommunityMember {
  id: string;
  fullName?: string;
  email?: string;
  organization?: string;
  socialProfiles?: Record<string, string>;
  lastActivityAt?: string;
  [key: string]: unknown;
}

export async function getTokenStatus(): Promise<unknown> {
  return apiGet("/status");
}

export async function getMemberByEmail(
  email: string,
): Promise<CommunityMember | null> {
  try {
    const data = await apiPost<CommunityMember>(
      "/members/search",
      { email },
      `member:${email}`,
    );
    return data;
  } catch {
    return null;
  }
}

export async function getMembers(params?: {
  query?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ items: CommunityMember[]; cursor?: string }> {
  const body: Record<string, unknown> = {};
  if (params?.query) body.query = params.query;
  if (params?.cursor) body.cursor = params.cursor;
  if (params?.limit) body.limit = params.limit;

  return apiPost("/members/search", body);
}

export async function getActivityForMember(
  memberId: string,
): Promise<unknown[]> {
  const data = await apiGet<{ items?: unknown[] }>(
    `/members/${memberId}/activities`,
  );
  return data.items ?? (data as any);
}

export async function getSegments(): Promise<unknown[]> {
  const data = await apiGet<{ items?: unknown[] }>("/segments");
  return data.items ?? (data as any);
}
