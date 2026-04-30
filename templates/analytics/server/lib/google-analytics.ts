// Google Analytics 4 Data API (v1beta) helper
// Runs reports for active users, top pages, sessions by source

import { resolveCredential } from "./credentials";
import { requireRequestCredentialContext } from "./credentials-context";
import { signRs256Jwt } from "./sign-jwt";

const API_BASE = "https://analyticsdata.googleapis.com/v1beta";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 100;

async function getConfig(): Promise<{ propertyId: string }> {
  const ctx = requireRequestCredentialContext("GA4_PROPERTY_ID");
  const propertyId = await resolveCredential("GA4_PROPERTY_ID", ctx);
  if (!propertyId) throw new Error("GA4_PROPERTY_ID not configured");
  return { propertyId };
}

async function getAccessToken(): Promise<string> {
  const ctx = requireRequestCredentialContext(
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  );
  const credsJson = await resolveCredential(
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    ctx,
  );
  if (!credsJson) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON not configured");
  }

  const creds = JSON.parse(credsJson);
  const now = Math.floor(Date.now() / 1000);

  const jwt = await signRs256Jwt(
    {
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    creds.private_key,
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// Cache the access token separately (1 hour TTL)
let tokenCache: { token: string; ts: number } | null = null;
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes (tokens last 60)

async function getCachedToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.ts < TOKEN_TTL_MS) {
    return tokenCache.token;
  }
  const token = await getAccessToken();
  tokenCache = { token, ts: Date.now() };
  return token;
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

// -- Types --

export interface GA4DateRange {
  startDate: string;
  endDate: string;
}

export interface GA4ReportRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

export interface GA4ReportResponse {
  dimensionHeaders: { name: string }[];
  metricHeaders: { name: string; type: string }[];
  rows: GA4ReportRow[];
  rowCount: number;
}

// -- API functions --

export async function getGA4Client() {
  const config = await getConfig();
  return { propertyId: config.propertyId };
}

export async function runReport(
  dimensions: string[],
  metrics: string[],
  dateRange?: GA4DateRange,
  dimensionFilter?: Record<string, unknown>,
): Promise<GA4ReportResponse> {
  const { propertyId } = await getConfig();
  const range = dateRange ?? { startDate: "7daysAgo", endDate: "today" };

  const filterKey = dimensionFilter ? JSON.stringify(dimensionFilter) : "";
  const cacheKey = `report-${dimensions.join(",")}-${metrics.join(",")}-${range.startDate}-${range.endDate}-${filterKey}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as GA4ReportResponse;
  }

  const token = await getCachedToken();
  const body: Record<string, unknown> = {
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    dateRanges: [range],
  };
  if (dimensionFilter) {
    body.dimensionFilter = dimensionFilter;
  }
  const res = await fetch(`${API_BASE}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA4 API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as GA4ReportResponse;
  cacheSet(cacheKey, data);
  return data;
}

export async function getActiveUsers(
  dateRange?: GA4DateRange,
): Promise<{ total: number; byDay: { date: string; users: number }[] }> {
  const report = await runReport(["date"], ["activeUsers"], dateRange);
  const byDay = (report.rows ?? []).map((row) => ({
    date: row.dimensionValues[0].value,
    users: parseInt(row.metricValues[0].value, 10),
  }));
  const total = byDay.reduce((sum, d) => sum + d.users, 0);
  return { total, byDay };
}

export async function getTopPages(
  limit = 20,
  dateRange?: GA4DateRange,
): Promise<{ path: string; pageviews: number; users: number }[]> {
  const report = await runReport(
    ["pagePath"],
    ["screenPageViews", "activeUsers"],
    dateRange,
  );
  return (report.rows ?? [])
    .map((row) => ({
      path: row.dimensionValues[0].value,
      pageviews: parseInt(row.metricValues[0].value, 10),
      users: parseInt(row.metricValues[1].value, 10),
    }))
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, limit);
}

export async function getSessionsBySource(
  dateRange?: GA4DateRange,
): Promise<{ source: string; sessions: number }[]> {
  const report = await runReport(["sessionSource"], ["sessions"], dateRange);
  return (report.rows ?? [])
    .map((row) => ({
      source: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value, 10),
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

export async function testConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    await runReport([], ["activeUsers"], {
      startDate: "1daysAgo",
      endDate: "today",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
