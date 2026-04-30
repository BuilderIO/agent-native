// Mixpanel Data Export API helper
// Queries events, top events, and funnels

import { resolveCredential } from "./credentials";
import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";

const API_BASE = "https://data.mixpanel.com/api/2.0";
const QUERY_BASE = "https://mixpanel.com/api/query";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 100;

async function getCredentials(): Promise<{ projectId: string; auth: string }> {
  const ctx = requireRequestCredentialContext("MIXPANEL_PROJECT_ID");
  const projectId = await resolveCredential("MIXPANEL_PROJECT_ID", ctx);
  const serviceAccount = await resolveCredential(
    "MIXPANEL_SERVICE_ACCOUNT",
    ctx,
  );
  if (!projectId) throw new Error("MIXPANEL_PROJECT_ID not configured");
  if (!serviceAccount)
    throw new Error(
      "MIXPANEL_SERVICE_ACCOUNT not configured (format: username:secret)",
    );
  const auth = Buffer.from(serviceAccount).toString("base64");
  return { projectId, auth };
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function apiGet<T>(
  base: string,
  path: string,
  cacheKey?: string,
): Promise<T> {
  const key = scopedCredentialCacheKey(
    cacheKey ?? path,
    "MIXPANEL_PROJECT_ID",
  );
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const { projectId, auth } = await getCredentials();
  const separator = path.includes("?") ? "&" : "?";
  const url = `${base}${path}${separator}project_id=${projectId}`;

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mixpanel API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cacheSet(key, data);
  return data as T;
}

// -- Types --

export interface MixpanelEvent {
  event: string;
  properties: Record<string, unknown>;
}

export interface MixpanelTopEvent {
  amount: number;
  percent_change: number;
}

export interface MixpanelFunnel {
  meta: { dates: string[] };
  data: Record<
    string,
    Record<string, { count: number; step_conv_ratio: number }>
  >;
}

// -- API functions --

export async function getMixpanelClient() {
  const creds = await getCredentials();
  return { projectId: creds.projectId, apiGet };
}

export async function queryEvents(
  fromDate: string,
  toDate: string,
  eventNames?: string[],
): Promise<MixpanelEvent[]> {
  const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
  if (eventNames?.length) {
    params.set("event", JSON.stringify(eventNames));
  }
  return apiGet<MixpanelEvent[]>(
    API_BASE,
    `/export?${params.toString()}`,
    `events-${fromDate}-${toDate}`,
  );
}

export async function getTopEvents(
  type: "general" | "average" | "unique" = "general",
  limit = 10,
): Promise<Record<string, MixpanelTopEvent>> {
  const params = new URLSearchParams({
    type,
    limit: String(limit),
  });
  return apiGet<Record<string, MixpanelTopEvent>>(
    QUERY_BASE,
    `/events/top?${params.toString()}`,
    `top-events-${type}-${limit}`,
  );
}

export async function getFunnels(
  funnelId: number,
  fromDate: string,
  toDate: string,
): Promise<MixpanelFunnel> {
  const params = new URLSearchParams({
    funnel_id: String(funnelId),
    from_date: fromDate,
    to_date: toDate,
  });
  return apiGet<MixpanelFunnel>(
    QUERY_BASE,
    `/funnels?${params.toString()}`,
    `funnel-${funnelId}-${fromDate}-${toDate}`,
  );
}

export async function testConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    await getTopEvents("general", 1);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
