// Gong sales call intelligence API helper
// Fetches calls, transcripts, and users

import { resolveCredential } from "./credentials";
import { requireRequestCredentialContext } from "./credentials-context";

const API_BASE = "https://us-65885.api.gong.io/v2";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 120;

async function getAuthHeader(): Promise<string> {
  const ctx = requireRequestCredentialContext("GONG_ACCESS_KEY");
  const accessKey = await resolveCredential("GONG_ACCESS_KEY", ctx);
  const secret = await resolveCredential("GONG_ACCESS_SECRET", ctx);
  if (!accessKey || !secret)
    throw new Error("GONG_ACCESS_KEY and GONG_ACCESS_SECRET not configured");
  return `Basic ${Buffer.from(`${accessKey}:${secret}`).toString("base64")}`;
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = cacheKey ?? path;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: await getAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gong API error ${res.status}: ${text}`);
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
      Authorization: await getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gong API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });

  return data as T;
}

export interface GongCall {
  id: string;
  title?: string;
  started: string;
  duration?: number;
  parties?: { name: string; emailAddress?: string; affiliation?: string }[];
  [key: string]: unknown;
}

export interface GongUser {
  id: string;
  emailAddress: string;
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
}

export async function getCalls(filters?: {
  fromDateTime?: string;
  toDateTime?: string;
  cursor?: string;
}): Promise<{ calls: GongCall[]; cursor?: string }> {
  const params = new URLSearchParams();
  if (filters?.fromDateTime) params.set("fromDateTime", filters.fromDateTime);
  if (filters?.toDateTime) params.set("toDateTime", filters.toDateTime);
  if (filters?.cursor) params.set("cursor", filters.cursor);

  const query = params.toString();
  const path = `/calls${query ? `?${query}` : ""}`;
  const data = await apiGet<{
    calls?: GongCall[];
    records?: { cursor?: string };
  }>(path);
  return {
    calls: data.calls ?? [],
    cursor: data.records?.cursor,
  };
}

export async function getCall(callId: string): Promise<GongCall | null> {
  const body = { filter: { callIds: [callId] } };
  const data = await apiPost<{ calls?: GongCall[] }>(
    "/calls",
    body,
    `call:${callId}`,
  );
  return data.calls?.[0] ?? null;
}

export async function getCallTranscript(callId: string): Promise<unknown> {
  const body = { filter: { callIds: [callId] } };
  return apiPost("/calls/transcript", body, `transcript:${callId}`);
}

export async function getUsers(): Promise<GongUser[]> {
  const data = await apiGet<{ users?: GongUser[] }>("/users", "users");
  return data.users ?? [];
}

export async function searchCalls(
  query: string,
  days = 90,
): Promise<GongCall[]> {
  const fromDateTime = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Use GET /v2/calls to list calls, then filter client-side
  let allCalls: GongCall[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ fromDateTime });
    if (cursor) params.set("cursor", cursor);
    const data = await apiGet<{
      calls?: GongCall[];
      records?: { cursor?: string; totalRecords?: number };
    }>(`/calls?${params.toString()}`);
    allCalls = allCalls.concat(data.calls ?? []);
    cursor = data.records?.cursor;
  } while (cursor);

  const lowerQuery = query.toLowerCase();
  return allCalls.filter((call) => {
    const title = call.title?.toLowerCase() ?? "";
    const parties =
      call.parties?.map((p) => p.name.toLowerCase()).join(" ") ?? "";
    return title.includes(lowerQuery) || parties.includes(lowerQuery);
  });
}
