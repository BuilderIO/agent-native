// Google Analytics 4 Data API (v1beta) helper
// Runs reports for active users, top pages, sessions by source

const API_BASE = "https://analyticsdata.googleapis.com/v1beta";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 100;

function getConfig(): { propertyId: string } {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error("GA4_PROPERTY_ID env var required");
  return { propertyId };
}

async function getAccessToken(): Promise<string> {
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsJson) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON env var required");
  }

  const creds = JSON.parse(credsJson);
  const now = Math.floor(Date.now() / 1000);

  // Build JWT for service account auth
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");

  const crypto = await import("crypto");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(creds.private_key, "base64url");

  const jwt = `${header}.${payload}.${signature}`;

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

export function getGA4Client() {
  const config = getConfig();
  return { propertyId: config.propertyId };
}

export async function runReport(
  dimensions: string[],
  metrics: string[],
  dateRange?: GA4DateRange,
): Promise<GA4ReportResponse> {
  const { propertyId } = getConfig();
  const range = dateRange ?? { startDate: "7daysAgo", endDate: "today" };

  const cacheKey = `report-${dimensions.join(",")}-${metrics.join(",")}-${range.startDate}-${range.endDate}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as GA4ReportResponse;
  }

  const token = await getCachedToken();
  const res = await fetch(`${API_BASE}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      dateRanges: [range],
    }),
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
