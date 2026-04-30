// Amplitude Export/Dashboard REST API helper
// Queries events, active users, and user segmentation

import { resolveCredential } from "./credentials";
import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";

const API_BASE = "https://amplitude.com/api/2";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 100;

async function getCredentials(): Promise<{
  apiKey: string;
  secretKey: string;
}> {
  const ctx = requireRequestCredentialContext("AMPLITUDE_API_KEY");
  const apiKey = await resolveCredential("AMPLITUDE_API_KEY", ctx);
  const secretKey = await resolveCredential("AMPLITUDE_SECRET_KEY", ctx);
  if (!apiKey) throw new Error("AMPLITUDE_API_KEY not configured");
  if (!secretKey) throw new Error("AMPLITUDE_SECRET_KEY not configured");
  return { apiKey, secretKey };
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = scopedCredentialCacheKey(
    cacheKey ?? path,
    "AMPLITUDE_API_KEY",
  );
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const { apiKey, secretKey } = await getCredentials();
  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amplitude API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cacheSet(key, data);
  return data as T;
}

// -- Types --

export interface AmplitudeEvent {
  event_type: string;
  event_properties: Record<string, unknown>;
  user_id: string;
  device_id: string;
  time: number;
}

export interface AmplitudeEventResponse {
  data: AmplitudeEvent[];
  matched: number;
}

export interface AmplitudeActiveUsersResponse {
  data: {
    series: number[][];
    xValues: string[];
  };
}

export interface AmplitudeSegmentationResponse {
  data: {
    series: Record<string, { value: number }>[];
    xValues: string[];
  };
}

// -- API functions --

export async function getAmplitudeClient() {
  const creds = await getCredentials();
  return { apiKey: creds.apiKey, apiGet };
}

export async function queryEvents(
  eventType: string,
  start: string,
  end: string,
): Promise<AmplitudeSegmentationResponse> {
  const params = new URLSearchParams({
    e: JSON.stringify({ event_type: eventType }),
    start,
    end,
  });
  return apiGet<AmplitudeSegmentationResponse>(
    `/events/segmentation?${params.toString()}`,
  );
}

export async function getActiveUsers(
  start: string,
  end: string,
): Promise<AmplitudeActiveUsersResponse> {
  const params = new URLSearchParams({ start, end });
  return apiGet<AmplitudeActiveUsersResponse>(
    `/users/active?${params.toString()}`,
  );
}

export async function getUserSegmentation(
  eventType: string,
  start: string,
  end: string,
  groupBy?: string,
): Promise<AmplitudeSegmentationResponse> {
  const eventObj: Record<string, unknown> = { event_type: eventType };
  if (groupBy) {
    eventObj.group_by = [{ type: "event", value: groupBy }];
  }
  const params = new URLSearchParams({
    e: JSON.stringify(eventObj),
    start,
    end,
  });
  return apiGet<AmplitudeSegmentationResponse>(
    `/events/segmentation?${params.toString()}`,
  );
}

export async function testConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const end = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const start = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "");
    await getActiveUsers(start, end);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
