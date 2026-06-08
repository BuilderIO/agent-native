// Prometheus HTTP API helper. Deterministic auth selection, descriptor parsing,
// and matrix/vector → {rows, schema} transforms. No LLM in this path.

import { z } from "zod";
import { resolveCredential } from "./credentials";
import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";

// --- Auth ---

export interface PrometheusAuth {
  username?: string;
  password?: string;
  bearer?: string;
}

/** Build the Authorization header. Basic auth wins over bearer when both are
 *  fully present. Partial basic (username XOR password) is ignored — falls
 *  through to bearer. Returns null when no auth is configured (self-hosted). */
export function buildAuthHeader(auth: PrometheusAuth): string | null {
  const hasBasic = !!(auth.username && auth.password);
  if (hasBasic) {
    const token = Buffer.from(`${auth.username}:${auth.password}`).toString(
      "base64",
    );
    return `Basic ${token}`;
  }
  if (auth.bearer) return `Bearer ${auth.bearer}`;
  return null;
}

async function resolveAuth(): Promise<PrometheusAuth> {
  const ctx = requireRequestCredentialContext("PROMETHEUS_URL");
  const [username, password, bearer] = await Promise.all([
    resolveCredential("PROMETHEUS_USERNAME", ctx),
    resolveCredential("PROMETHEUS_PASSWORD", ctx),
    resolveCredential("PROMETHEUS_BEARER_TOKEN", ctx),
  ]);
  return {
    username: username ?? undefined,
    password: password ?? undefined,
    bearer: bearer ?? undefined,
  };
}

async function resolveBase(): Promise<string> {
  const ctx = requireRequestCredentialContext("PROMETHEUS_URL");
  const url = await resolveCredential("PROMETHEUS_URL", ctx);
  if (!url) throw new Error("PROMETHEUS_URL not configured");
  return url.replace(/\/+$/, "");
}

// --- Cache (metadata only, never query results) ---

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 120;

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

// --- Low-level fetch ---

async function doFetch<T>(
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Prometheus API error ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  const body = (await res.json()) as {
    status?: string;
    data?: unknown;
    error?: string;
  };
  if (body?.status !== "success") {
    throw new Error(
      `Prometheus query failed: ${body?.error ?? "unknown error"}`,
    );
  }
  return body.data as T;
}

async function apiGet<T>(
  path: string,
  params: Record<string, string | undefined>,
  options: { cache?: boolean } = {},
): Promise<T> {
  const base = await resolveBase();
  const auth = await resolveAuth();
  const headers: Record<string, string> = { Accept: "application/json" };
  const authHeader = buildAuthHeader(auth);
  if (authHeader) headers.Authorization = authHeader;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, v);
  }
  const url = `${base}${path}?${qs.toString()}`;

  if (options.cache) {
    const ck = scopedCredentialCacheKey(url, "PROMETHEUS_URL");
    const cached = cache.get(ck);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data as T;
    }
    const data = await doFetch<T>(url, headers);
    cacheSet(ck, data);
    return data;
  }
  return doFetch<T>(url, headers);
}

// --- High-level API ---

export async function queryInstant(promql: string, time?: string) {
  return apiGet<{ resultType: string; result: unknown }>("/api/v1/query", {
    query: promql,
    time,
  });
}

export async function queryRange(
  promql: string,
  startSec: number,
  endSec: number,
  stepSec: number,
) {
  return apiGet<{ resultType: string; result: unknown }>(
    "/api/v1/query_range",
    {
      query: promql,
      start: String(startSec),
      end: String(endSec),
      step: String(stepSec),
    },
  );
}

export async function listLabels(): Promise<string[]> {
  return apiGet<string[]>("/api/v1/labels", {}, { cache: true });
}

export async function listLabelValues(label: string): Promise<string[]> {
  return apiGet<string[]>(
    `/api/v1/label/${encodeURIComponent(label)}/values`,
    {},
    { cache: true },
  );
}

export async function listSeries(
  matchers: string[],
): Promise<Record<string, string>[]> {
  // Prometheus accepts repeated match[]= params; encode manually since apiGet
  // collapses keys via URLSearchParams.set.
  const base = await resolveBase();
  const auth = await resolveAuth();
  const headers: Record<string, string> = { Accept: "application/json" };
  const a = buildAuthHeader(auth);
  if (a) headers.Authorization = a;
  const qs = new URLSearchParams();
  for (const m of matchers) qs.append("match[]", m);
  return doFetch<Record<string, string>[]>(
    `${base}/api/v1/series?${qs.toString()}`,
    headers,
  );
}

export async function listMetricMetadata(metric?: string): Promise<unknown> {
  return apiGet("/api/v1/metadata", { metric }, { cache: true });
}

export async function listAlerts(): Promise<unknown> {
  return apiGet("/api/v1/alerts", {});
}

// --- Panel descriptor (panel `sql` serialized JSON) ---

const PanelDescriptorSchema = z.object({
  promql: z.string().min(1, "promql is required"),
  mode: z.enum(["instant", "range"]).default("range"),
  range: z.string().optional().describe('e.g. "1h", "24h", "7d"'),
  step: z.string().optional().describe('e.g. "30s", "5m"; auto if omitted'),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

export type PanelDescriptor = z.infer<typeof PanelDescriptorSchema>;

export function serializePanelDescriptorInput(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return JSON.stringify(raw);
  }
  throw new Error("prometheus panel sql must be a JSON string or object");
}

export function parsePanelDescriptor(raw: string): PanelDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(
      `prometheus panel sql must be a JSON object: ${err?.message ?? err}`,
    );
  }
  const result = PanelDescriptorSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      result.error.issues
        .map((i) => {
          const path = i.path.join(".");
          return path ? `${path}: ${i.message}` : i.message;
        })
        .join("; "),
    );
  }
  return result.data;
}

/** Aim for ~250 points across the range, clamped to a 15-second minimum. */
export function defaultStep(rangeSec: number): number {
  return Math.max(15, Math.floor(rangeSec / 250));
}

function parseDurationSec(s: string): number {
  const m = /^(\d+)(s|m|h|d|w)$/.exec(s.trim());
  if (!m) throw new Error(`invalid duration: ${s}`);
  const n = parseInt(m[1], 10);
  const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[
    m[2] as "s" | "m" | "h" | "d" | "w"
  ];
  return n * mult;
}

function parseStepSec(s: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(s.trim());
  if (!m) throw new Error(`invalid step: ${s}`);
  const n = parseInt(m[1], 10);
  return n * { s: 1, m: 60, h: 3600 }[m[2] as "s" | "m" | "h"];
}

export function resolveRangeWindow(
  d: PanelDescriptor,
  now: Date = new Date(),
): {
  startSec: number;
  endSec: number;
  stepSec: number;
} {
  const endSec = d.endTime
    ? Math.floor(new Date(d.endTime).getTime() / 1000)
    : Math.floor(now.getTime() / 1000);
  const rangeSec = d.range ? parseDurationSec(d.range) : 3600;
  const startSec = d.startTime
    ? Math.floor(new Date(d.startTime).getTime() / 1000)
    : endSec - rangeSec;
  const stepSec = d.step
    ? parseStepSec(d.step)
    : defaultStep(endSec - startSec);
  return { startSec, endSec, stepSec };
}

// --- Response flatteners ---

function seriesLabel(metric: Record<string, string>): string {
  const name = metric.__name__ ?? "";
  const rest = Object.entries(metric)
    .filter(([k]) => k !== "__name__")
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  return rest ? `${name}{${rest}}` : name;
}

const ROW_SCHEMA = [
  { name: "timestamp", type: "string" },
  { name: "series", type: "string" },
  { name: "value", type: "number" },
];

export function flattenMatrix(data: {
  resultType?: string;
  result?: unknown;
}): {
  rows: Record<string, unknown>[];
  schema: typeof ROW_SCHEMA;
} {
  const rows: Record<string, unknown>[] = [];
  const result = Array.isArray(data?.result) ? data.result : [];
  for (const s of result as Array<{
    metric: Record<string, string>;
    values: [number, string][];
  }>) {
    const label = seriesLabel(s.metric ?? {});
    for (const [tsSec, v] of s.values ?? []) {
      rows.push({
        timestamp: new Date(tsSec * 1000).toISOString(),
        series: label,
        value: Number(v),
      });
    }
  }
  return { rows, schema: ROW_SCHEMA };
}

export function flattenVector(data: {
  resultType?: string;
  result?: unknown;
}): {
  rows: Record<string, unknown>[];
  schema: typeof ROW_SCHEMA;
} {
  const rows: Record<string, unknown>[] = [];
  const result = Array.isArray(data?.result) ? data.result : [];
  for (const s of result as Array<{
    metric: Record<string, string>;
    value: [number, string];
  }>) {
    const [tsSec, v] = s.value;
    rows.push({
      timestamp: new Date(tsSec * 1000).toISOString(),
      series: seriesLabel(s.metric ?? {}),
      value: Number(v),
    });
  }
  return { rows, schema: ROW_SCHEMA };
}

/** Entrypoint used by the panel dispatcher in `server/handlers/sql-query.ts`. */
export async function runPrometheusPanel(raw: string) {
  const d = parsePanelDescriptor(raw);
  if (d.mode === "instant") {
    const data = await queryInstant(d.promql, d.endTime);
    return flattenVector(data as any);
  }
  const { startSec, endSec, stepSec } = resolveRangeWindow(d);
  const data = await queryRange(d.promql, startSec, endSec, stepSec);
  return flattenMatrix(data as any);
}

/** Verify connectivity. Called by /api/test-connection when source="prometheus". */
export async function testConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const base = await resolveBase(); // throws if PROMETHEUS_URL not set
    const auth = await resolveAuth();
    const headers: Record<string, string> = { Accept: "application/json" };
    const authHeader = buildAuthHeader(auth);
    if (authHeader) headers.Authorization = authHeader;
    const res = await fetch(`${base}/api/v1/labels`, { headers });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        error: `Prometheus returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const body = (await res.json()) as { status?: string; error?: string };
    if (body?.status !== "success") {
      return {
        ok: false,
        error: body?.error ?? "Unexpected response from Prometheus",
      };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Connection failed" };
  }
}
