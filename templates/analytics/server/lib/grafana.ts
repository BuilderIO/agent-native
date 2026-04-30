// Grafana Cloud API helper
// Fetches dashboards, datasources, alerts, and proxies queries

import { resolveCredential } from "./credentials";
import { requireRequestCredentialContext } from "./credentials-context";

async function getApiBase(): Promise<string> {
  const ctx = requireRequestCredentialContext("GRAFANA_URL");
  return (
    (await resolveCredential("GRAFANA_URL", ctx)) ||
    "https://your-org.grafana.net"
  );
}

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE = 120;

async function getToken(): Promise<string> {
  const ctx = requireRequestCredentialContext("GRAFANA_API_TOKEN");
  const token = await resolveCredential("GRAFANA_API_TOKEN", ctx);
  if (!token) throw new Error("GRAFANA_API_TOKEN not configured");
  return token;
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = cacheKey ?? path;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const apiBase = await getApiBase();
  const res = await fetch(`${apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grafana API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cacheSet(key, data);
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

  const apiBase = await getApiBase();
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grafana API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cacheSet(key, data);
  return data as T;
}

// -- Types --

export interface GrafanaDashboardSummary {
  id: number;
  uid: string;
  title: string;
  uri: string;
  url: string;
  type: string;
  tags: string[];
  isStarred: boolean;
  folderTitle?: string;
  folderUid?: string;
}

export interface GrafanaDashboardFull {
  dashboard: {
    id: number;
    uid: string;
    title: string;
    tags: string[];
    panels: GrafanaPanel[];
    templating?: { list: unknown[] };
    [key: string]: unknown;
  };
  meta: {
    slug: string;
    url: string;
    folderTitle?: string;
    folderUid?: string;
    [key: string]: unknown;
  };
}

export interface GrafanaPanel {
  id: number;
  title: string;
  type: string;
  targets?: unknown[];
  [key: string]: unknown;
}

export interface GrafanaDatasource {
  id: number;
  uid: string;
  name: string;
  type: string;
  url?: string;
  isDefault: boolean;
  [key: string]: unknown;
}

export interface GrafanaAlertRule {
  id: number;
  uid: string;
  title: string;
  condition: string;
  data: unknown[];
  folderUID: string;
  ruleGroup: string;
  [key: string]: unknown;
}

export interface GrafanaAlertInstance {
  labels: Record<string, string>;
  state: string;
  activeAt?: string;
  value?: string;
  [key: string]: unknown;
}

// -- API functions --

export async function listDashboards(
  query?: string,
): Promise<GrafanaDashboardSummary[]> {
  const params = new URLSearchParams({ type: "dash-db" });
  if (query) params.set("query", query);
  return apiGet<GrafanaDashboardSummary[]>(`/api/search?${params.toString()}`);
}

export async function getDashboard(uid: string): Promise<GrafanaDashboardFull> {
  return apiGet<GrafanaDashboardFull>(
    `/api/dashboards/uid/${encodeURIComponent(uid)}`,
  );
}

export async function getDatasources(): Promise<GrafanaDatasource[]> {
  return apiGet<GrafanaDatasource[]>("/api/datasources");
}

export async function getAlertRules(): Promise<GrafanaAlertRule[]> {
  // Grafana unified alerting API returns groups; flatten to rules
  const data = await apiGet<Record<string, { rules: GrafanaAlertRule[] }[]>>(
    "/api/ruler/grafana/api/v1/rules",
  );
  const rules: GrafanaAlertRule[] = [];
  for (const groups of Object.values(data)) {
    for (const group of groups) {
      if (group.rules) rules.push(...group.rules);
    }
  }
  return rules;
}

export async function getAlertInstances(): Promise<GrafanaAlertInstance[]> {
  const data = await apiGet<{ data: { alerts: GrafanaAlertInstance[] } }>(
    "/api/alertmanager/grafana/api/v2/alerts",
  );
  // The v2 alerts endpoint returns an array directly
  if (Array.isArray(data)) return data as GrafanaAlertInstance[];
  return data?.data?.alerts ?? [];
}

export async function queryDatasource(
  datasourceUid: string,
  queries: unknown[],
  from?: string,
  to?: string,
): Promise<unknown> {
  const now = Date.now();
  const body = {
    queries: queries.map((q: any) => ({
      ...q,
      datasource: { uid: datasourceUid },
    })),
    from: from ?? String(now - 3600 * 1000),
    to: to ?? String(now),
  };
  // Don't cache query results by default — they're time-sensitive
  const apiBase = await getApiBase();
  const res = await fetch(`${apiBase}/api/ds/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grafana query error ${res.status}: ${text}`);
  }

  return res.json();
}
