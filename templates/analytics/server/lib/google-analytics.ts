import { resolveCredential } from "./credentials";
import {
  credentialCacheScope,
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";
import { signRs256Jwt } from "./sign-jwt";

const API_BASE = "https://analyticsdata.googleapis.com/v1beta";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 100;

const ANALYTICS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";

/** A missing credential, typed so callers can tell "not set up" from a failure. */
function notConfigured(message: string, errorCode: string): Error {
  return Object.assign(new Error(message), { errorCode, statusCode: 424 });
}

async function getConfig(): Promise<{ propertyId: string }> {
  const ctx = requireRequestCredentialContext("GA4_PROPERTY_ID");
  const propertyId = await resolveCredential("GA4_PROPERTY_ID", ctx);
  if (!propertyId) {
    throw notConfigured("GA4_PROPERTY_ID not configured", "ga4_not_configured");
  }
  return { propertyId };
}

async function readServiceAccountJson(): Promise<string> {
  const ctx = requireRequestCredentialContext(
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  );
  const credsJson = await resolveCredential(
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    ctx,
  );
  if (!credsJson) {
    throw notConfigured(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON not configured",
      "google_credentials_missing",
    );
  }
  return credsJson;
}

export type ServiceAccountIdentity =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; email: string };

/**
 * The service account's email, which a property owner grants access to. The
 * email is not secret; the rest of the key never leaves this function.
 */
export async function readServiceAccountIdentity(): Promise<ServiceAccountIdentity> {
  let credsJson: string;
  try {
    credsJson = await readServiceAccountJson();
  } catch (error) {
    if ((error as { statusCode?: unknown }).statusCode === 424) {
      return { status: "missing" };
    }
    throw error;
  }
  try {
    const email = (JSON.parse(credsJson) as { client_email?: unknown })
      .client_email;
    return typeof email === "string" && email
      ? { status: "ok", email }
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

async function getAccessToken(scope: string): Promise<string> {
  const creds = JSON.parse(await readServiceAccountJson());
  const now = Math.floor(Date.now() / 1000);

  const jwt = await signRs256Jwt(
    {
      iss: creds.client_email,
      scope,
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

const tokenCache = new Map<string, { token: string; ts: number }>();
const TOKEN_TTL_MS = 50 * 60 * 1000;

/** A cached service-account access token for one OAuth scope. */
export async function getGoogleServiceAccountToken(
  scope: string = ANALYTICS_READONLY_SCOPE,
): Promise<string> {
  const tokenKey = `${credentialCacheScope("GOOGLE_APPLICATION_CREDENTIALS_JSON")}:${scope}`;
  const cached = tokenCache.get(tokenKey);
  if (cached && Date.now() - cached.ts < TOKEN_TTL_MS) {
    return cached.token;
  }
  const token = await getAccessToken(scope);
  tokenCache.set(tokenKey, { token, ts: Date.now() });
  return token;
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

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
  const cacheKey = scopedCredentialCacheKey(
    `report-${dimensions.join(",")}-${metrics.join(",")}-${range.startDate}-${range.endDate}-${filterKey}`,
    "GA4_PROPERTY_ID",
  );
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as GA4ReportResponse;
  }

  const token = await getGoogleServiceAccountToken();
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

/**
 * Every row of one GA4 report, paged by `limit`/`offset` and never cached.
 * Throws once `maxRows` is passed, rather than returning a partial report.
 */
export async function runFullReport(request: {
  dimensions: string[];
  metrics: string[];
  dateRange: GA4DateRange;
  dimensionFilter?: Record<string, unknown>;
  maxRows: number;
  signal?: AbortSignal;
}): Promise<GA4ReportRow[]> {
  const { propertyId } = await getConfig();
  const token = await getGoogleServiceAccountToken();
  const pageSize = Math.min(100_000, request.maxRows);
  const rows: GA4ReportRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetch(`${API_BASE}/properties/${propertyId}:runReport`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dimensions: request.dimensions.map((name) => ({ name })),
        metrics: request.metrics.map((name) => ({ name })),
        dateRanges: [request.dateRange],
        ...(request.dimensionFilter
          ? { dimensionFilter: request.dimensionFilter }
          : {}),
        limit: pageSize,
        offset,
        keepEmptyRows: false,
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (res.status === 403) {
      throw notConfigured(
        `GA4 API error 403: the Analytics service account has no access to property ${propertyId}.`,
        "ga4_no_access",
      );
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GA4 API error ${res.status}: ${text.slice(0, 500)}`);
    }
    const page = (await res.json()) as Partial<GA4ReportResponse>;
    rows.push(...(page.rows ?? []));
    const total = page.rowCount ?? 0;
    if (rows.length >= total) return rows;
    if (!page.rows?.length) {
      throw new Error(
        `GA4 report stopped returning rows at ${rows.length} of ${total}.`,
      );
    }
    if (rows.length >= request.maxRows) {
      throw new Error(
        `GA4 report has ${total} rows, more than the ${request.maxRows} this read allows.`,
      );
    }
  }
}
