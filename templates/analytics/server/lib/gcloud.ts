// Google Cloud API helper
// Fetches Cloud Run services, Cloud Functions, metrics, and logs
// Uses manual JWT-based service account auth (no SDK dependencies)

import { createPrivateKey } from "crypto";

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID || "your-gcp-project-id";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 120;

// Token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(data: Buffer | Uint8Array | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  return buf.toString("base64url");
}

function getServiceAccountCredentials() {
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsJson) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON env var required");
  }
  return JSON.parse(credsJson);
}

async function signJwt(
  payload: object,
  privateKeyPem: string,
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = createPrivateKey(privateKeyPem);
  const { sign } = await import("crypto");
  const signature = sign("sha256", Buffer.from(signingInput), key);

  return `${signingInput}.${base64url(signature)}`;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.token;
  }

  const creds = getServiceAccountCredentials();
  const now = Math.floor(Date.now() / 1000);

  const jwtPayload = {
    iss: creds.client_email,
    scope: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/monitoring.read",
      "https://www.googleapis.com/auth/logging.read",
      "https://www.googleapis.com/auth/bigquery",
    ].join(" "),
    aud: creds.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const jwt = await signJwt(jwtPayload, creds.private_key);

  const tokenUri = creds.token_uri || "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function apiGet<T>(url: string, cacheKey?: string): Promise<T> {
  const key = cacheKey ?? url;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Cloud API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cacheSet(key, data);
  return data as T;
}

async function apiPost<T>(
  url: string,
  body: unknown,
  cacheKey?: string,
): Promise<T> {
  const key = cacheKey ?? `POST:${url}:${JSON.stringify(body)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const token = await getAccessToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Cloud API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cacheSet(key, data);
  return data as T;
}

// -- Types --

export interface CloudRunService {
  name: string; // full resource name
  uid: string;
  displayName: string;
  uri: string;
  region: string;
  createTime: string;
  updateTime: string;
  launchStage?: string;
}

export interface CloudFunction {
  name: string;
  displayName: string;
  state: string;
  environment: string;
  region: string;
  runtime?: string;
  updateTime: string;
}

export interface MetricPoint {
  timestamp: string;
  value: number;
}

export interface MetricTimeSeries {
  metric: string;
  labels: Record<string, string>;
  points: MetricPoint[];
}

export interface LogEntry {
  timestamp: string;
  severity: string;
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  resource: {
    type: string;
    labels: Record<string, string>;
  };
  logName: string;
  insertId: string;
}

// -- API functions --

export async function listCloudRunServices(): Promise<CloudRunService[]> {
  const url = `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/-/services`;
  const data = await apiGet<{ services?: any[] }>(url);
  if (!data.services) return [];

  return data.services.map((svc: any) => {
    const parts = svc.name.split("/");
    const region = parts[3] || "unknown";
    return {
      name: svc.name,
      uid: svc.uid || "",
      displayName: parts[parts.length - 1] || svc.name,
      uri: svc.uri || "",
      region,
      createTime: svc.createTime || "",
      updateTime: svc.updateTime || "",
      launchStage: svc.launchStage,
    };
  });
}

export async function listCloudFunctions(): Promise<CloudFunction[]> {
  const url = `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT_ID}/locations/-/functions`;
  const data = await apiGet<{ functions?: any[] }>(url);
  if (!data.functions) return [];

  return data.functions.map((fn: any) => {
    const parts = fn.name.split("/");
    const region = parts[3] || "unknown";
    return {
      name: fn.name,
      displayName: parts[parts.length - 1] || fn.name,
      state: fn.state || "UNKNOWN",
      environment: fn.environment || "GEN_2",
      region,
      runtime: fn.buildConfig?.runtime,
      updateTime: fn.updateTime || "",
    };
  });
}

function buildTimeInterval(period: string): {
  startTime: string;
  endTime: string;
} {
  const now = new Date();
  const end = now.toISOString();
  let ms: number;
  switch (period) {
    case "1h":
      ms = 3600 * 1000;
      break;
    case "6h":
      ms = 6 * 3600 * 1000;
      break;
    case "24h":
      ms = 24 * 3600 * 1000;
      break;
    case "7d":
      ms = 7 * 24 * 3600 * 1000;
      break;
    default:
      ms = 24 * 3600 * 1000;
  }
  const start = new Date(now.getTime() - ms).toISOString();
  return { startTime: start, endTime: end };
}

function alignmentPeriod(period: string): string {
  switch (period) {
    case "1h":
      return "60s";
    case "6h":
      return "300s";
    case "24h":
      return "600s";
    case "7d":
      return "3600s";
    default:
      return "600s";
  }
}

export async function queryMetrics(
  filter: string,
  period: string,
  perSeriesAligner: string = "ALIGN_RATE",
  crossSeriesReducer?: string,
  groupByFields?: string[],
): Promise<MetricTimeSeries[]> {
  const interval = buildTimeInterval(period);
  const alignPeriod = alignmentPeriod(period);

  const params = new URLSearchParams({
    filter,
    "interval.startTime": interval.startTime,
    "interval.endTime": interval.endTime,
    "aggregation.alignmentPeriod": alignPeriod,
    "aggregation.perSeriesAligner": perSeriesAligner,
  });

  if (crossSeriesReducer) {
    params.set("aggregation.crossSeriesReducer", crossSeriesReducer);
  }
  if (groupByFields) {
    for (const field of groupByFields) {
      params.append("aggregation.groupByFields", field);
    }
  }

  const url = `https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/timeSeries?${params.toString()}`;
  const data = await apiGet<{ timeSeries?: any[] }>(url);

  if (!data.timeSeries) return [];

  return data.timeSeries.map((ts: any) => ({
    metric: ts.metric?.type || "",
    labels: {
      ...(ts.metric?.labels || {}),
      ...(ts.resource?.labels || {}),
    },
    points: (ts.points || [])
      .map((p: any) => ({
        timestamp: p.interval?.endTime || p.interval?.startTime || "",
        value:
          p.value?.doubleValue ??
          p.value?.int64Value ??
          p.value?.distributionValue?.mean ??
          0,
      }))
      .reverse(), // API returns newest first, we want chronological
  }));
}

export async function getServiceMetrics(
  serviceType: "cloud_run" | "cloud_function",
  serviceName: string,
  metric: string,
  period: string,
  extraFilter?: string,
): Promise<MetricTimeSeries[]> {
  let filter: string;
  if (serviceType === "cloud_run") {
    filter = `metric.type = "${metric}" AND resource.type = "cloud_run_revision" AND resource.labels.service_name = "${serviceName}"`;
  } else {
    filter = `metric.type = "${metric}" AND resource.type = "cloud_function" AND resource.labels.function_name = "${serviceName}"`;
  }
  if (extraFilter) {
    filter += ` AND ${extraFilter}`;
  }

  // Cloud Run metrics are mostly DELTA (request_count, request_latencies) or GAUGE (instance_count, cpu/memory).
  // ALIGN_RATE works for DELTA counters, ALIGN_MEAN for GAUGE, ALIGN_PERCENTILE_99 for distributions.
  let aligner: string;
  let reducer = "REDUCE_SUM";

  if (
    metric.includes("latenc") ||
    metric.includes("duration") ||
    metric.includes("execution_times") ||
    metric.includes("utilizations")
  ) {
    // Distribution metrics — use percentile
    aligner = "ALIGN_PERCENTILE_99";
  } else if (
    metric.includes("instance_count") ||
    metric.includes("active_instances") ||
    metric.includes("memory")
  ) {
    // Gauge metrics — use mean
    aligner = "ALIGN_MEAN";
    reducer = "REDUCE_MEAN";
  } else if (
    metric.includes("request_count") ||
    metric.includes("execution_count")
  ) {
    // Delta counter metrics — use delta (sum over alignment period)
    aligner = "ALIGN_DELTA";
  } else {
    aligner = "ALIGN_MEAN";
  }

  return queryMetrics(filter, period, aligner, reducer, [
    "resource.labels.service_name",
  ]);
}

export async function listLogEntries(
  filter: string,
  pageSize: number = 100,
): Promise<LogEntry[]> {
  const url = "https://logging.googleapis.com/v2/entries:list";
  const body = {
    resourceNames: [`projects/${PROJECT_ID}`],
    filter,
    orderBy: "timestamp desc",
    pageSize,
  };

  const data = await apiPost<{ entries?: any[] }>(url, body);
  if (!data.entries) return [];

  return data.entries.map((entry: any) => ({
    timestamp: entry.timestamp || "",
    severity: entry.severity || "DEFAULT",
    textPayload: entry.textPayload,
    jsonPayload: entry.jsonPayload,
    resource: {
      type: entry.resource?.type || "",
      labels: entry.resource?.labels || {},
    },
    logName: entry.logName || "",
    insertId: entry.insertId || "",
  }));
}
