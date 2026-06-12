import { createHash } from "node:crypto";
import {
  buildAuthHeader,
  flattenMatrix,
  flattenVector,
  parsePanelDescriptor,
  resolveRangeWindow,
  serializePanelDescriptorInput,
  type PanelDescriptor,
} from "./prometheus";

export type DemoDescriptor = PanelDescriptor;

export interface DemoPrometheusConfig {
  url: string;
  username?: string;
  password?: string;
  bearer?: string;
}

export const DEFAULT_DEMO_PROMETHEUS_URL =
  "https://prometheus.agent-native.foo";

export const DEMO_PROMETHEUS_ENV = {
  url: "ANALYTICS_DEMO_PROMETHEUS_URL",
  username: "ANALYTICS_DEMO_PROMETHEUS_USERNAME",
  password: "ANALYTICS_DEMO_PROMETHEUS_PASSWORD",
  bearer: "ANALYTICS_DEMO_PROMETHEUS_BEARER_TOKEN",
} as const;

export const DEMO_QUERY_CACHE_TTL_MS = 30_000;
const DEMO_QUERY_CACHE_MAX = 200;

type DemoQueryResult = ReturnType<typeof flattenMatrix>;

const queryCache = new Map<
  string,
  { result: DemoQueryResult; expiresAt: number }
>();
const inFlightQueries = new Map<string, Promise<DemoQueryResult>>();

export function serializeDemoDescriptorInput(raw: unknown): string {
  return serializePanelDescriptorInput(raw);
}

export function parseDemoDescriptor(raw: string): DemoDescriptor {
  try {
    return parsePanelDescriptor(raw);
  } catch (err: any) {
    throw new Error(
      String(err?.message ?? err).replace(
        /^prometheus panel sql/,
        "demo Prometheus panel sql",
      ),
    );
  }
}

export function resolveDemoPrometheusConfig(
  env: Record<string, string | undefined> = process.env,
): DemoPrometheusConfig {
  const url = (
    env[DEMO_PROMETHEUS_ENV.url]?.trim() || DEFAULT_DEMO_PROMETHEUS_URL
  ).replace(/\/+$/, "");
  return {
    url,
    username: env[DEMO_PROMETHEUS_ENV.username]?.trim() || undefined,
    password: env[DEMO_PROMETHEUS_ENV.password] || undefined,
    bearer: env[DEMO_PROMETHEUS_ENV.bearer] || undefined,
  };
}

function authFingerprint(config: DemoPrometheusConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        username: config.username ?? "",
        password: config.password ?? "",
        bearer: config.bearer ?? "",
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

function descriptorCacheKey(
  config: DemoPrometheusConfig,
  descriptor: DemoDescriptor,
  nowMs: number,
): string {
  const timeBucket = descriptor.endTime
    ? null
    : Math.floor(nowMs / DEMO_QUERY_CACHE_TTL_MS);
  return JSON.stringify({
    url: config.url,
    auth: authFingerprint(config),
    promql: descriptor.promql,
    mode: descriptor.mode,
    range: descriptor.range ?? null,
    step: descriptor.step ?? null,
    startTime: descriptor.startTime ?? null,
    endTime: descriptor.endTime ?? null,
    timeBucket,
  });
}

function getCachedResult(key: string, nowMs: number): DemoQueryResult | null {
  const cached = queryCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= nowMs) {
    queryCache.delete(key);
    return null;
  }
  return cached.result;
}

function setCachedResult(key: string, result: DemoQueryResult, nowMs: number) {
  queryCache.set(key, {
    result,
    expiresAt: nowMs + DEMO_QUERY_CACHE_TTL_MS,
  });
  if (queryCache.size <= DEMO_QUERY_CACHE_MAX) return;
  for (const [cacheKey, cached] of queryCache) {
    if (cached.expiresAt <= nowMs || queryCache.size > DEMO_QUERY_CACHE_MAX) {
      queryCache.delete(cacheKey);
    }
    if (queryCache.size <= DEMO_QUERY_CACHE_MAX) break;
  }
}

export function clearDemoQueryCache() {
  queryCache.clear();
  inFlightQueries.clear();
}

async function demoPrometheusGet<T>(
  config: DemoPrometheusConfig,
  path: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const authHeader = buildAuthHeader(config);
  if (authHeader) headers.Authorization = authHeader;

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, value);
  }

  const res = await fetch(`${config.url}${path}?${qs.toString()}`, {
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Demo Prometheus API error ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  const body = (await res.json()) as {
    status?: string;
    data?: unknown;
    error?: string;
  };
  if (body?.status !== "success") {
    throw new Error(
      `Demo Prometheus query failed: ${body?.error ?? "unknown error"}`,
    );
  }
  return body.data as T;
}

async function fetchDemoPanel(
  descriptor: DemoDescriptor,
  config: DemoPrometheusConfig,
): Promise<DemoQueryResult> {
  if (descriptor.mode === "instant") {
    const data = await demoPrometheusGet<{
      resultType: string;
      result: unknown;
    }>(config, "/api/v1/query", {
      query: descriptor.promql,
      time: descriptor.endTime,
    });
    return flattenVector(data);
  }

  const { startSec, endSec, stepSec } = resolveRangeWindow(descriptor);
  const data = await demoPrometheusGet<{
    resultType: string;
    result: unknown;
  }>(config, "/api/v1/query_range", {
    query: descriptor.promql,
    start: String(startSec),
    end: String(endSec),
    step: String(stepSec),
  });
  return flattenMatrix(data);
}

export async function runDemoPanelWithConfig(
  raw: string,
  config: DemoPrometheusConfig,
) {
  const descriptor = parseDemoDescriptor(raw);
  const nowMs = Date.now();
  const cacheKey = descriptorCacheKey(config, descriptor, nowMs);
  const cached = getCachedResult(cacheKey, nowMs);
  if (cached) return cached;

  const inFlight = inFlightQueries.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = fetchDemoPanel(descriptor, config)
    .then((result) => {
      setCachedResult(cacheKey, result, Date.now());
      return result;
    })
    .finally(() => {
      inFlightQueries.delete(cacheKey);
    });
  inFlightQueries.set(cacheKey, promise);
  return promise;
}

export async function runDemoPanel(raw: string) {
  return runDemoPanelWithConfig(raw, resolveDemoPrometheusConfig());
}
