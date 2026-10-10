import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";
import { executeProviderApiRequest } from "./provider-api";
import { resolveAnalyticsProviderCredential } from "./provider-credentials";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 100;

async function getOrgSlug(
  orgSlug?: string,
  connectionId?: string,
): Promise<string> {
  const trimmed = orgSlug?.trim();
  if (trimmed) return trimmed;
  const ctx = requireRequestCredentialContext("SENTRY_AUTH_TOKEN");
  const configured = await resolveAnalyticsProviderCredential({
    provider: "sentry",
    keys: ["SENTRY_ORG_SLUG"],
    ctx,
    connectionId,
  });
  if (configured?.value) return configured.value;

  const organizations = await listOrganizations(connectionId);
  const discovered = organizations[0]?.slug;
  if (discovered) return discovered;

  throw new Error(
    "SENTRY_ORG_SLUG not configured and no accessible Sentry organizations found. Pass --orgSlug or configure SENTRY_ORG_SLUG.",
  );
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function apiGet<T>(
  path: string,
  cacheKey?: string,
  connectionId?: string,
): Promise<T> {
  const key = scopedCredentialCacheKey(
    `${connectionId ?? "selected"}:${cacheKey ?? path}`,
    "SENTRY_AUTH_TOKEN",
  );
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const result = (await executeProviderApiRequest({
    provider: "sentry",
    method: "GET",
    path,
    connectionId,
    timeoutMs: 8_000,
    maxBytes: 1_000_000,
  })) as { response?: { ok?: boolean; status?: number; json?: unknown } };
  if (!result.response || result.response.ok !== true) {
    throw new Error(
      `Sentry API error ${result.response?.status ?? "unknown"}.`,
    );
  }
  const data = result.response.json;
  if (data === undefined) throw new Error("Sentry API returned no JSON data.");
  cacheSet(key, data);
  return data as T;
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
  dateCreated: string;
  isBookmarked: boolean;
  isMember: boolean;
  hasAccess: boolean;
  status: string;
}

export interface SentryOrganization {
  id: string;
  slug: string;
  name: string;
  status?: { id?: string; name?: string };
  dateCreated?: string;
}

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  level: string;
  status: string;
  platform: string;
  project: { id: string; name: string; slug: string };
  type: string;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  stats?: Record<string, number[][]>;
}

export interface SentryEvent {
  eventID: string;
  title: string;
  message: string;
  dateCreated: string;
  context: Record<string, unknown>;
  tags: { key: string; value: string }[];
  user?: { id?: string; email?: string; username?: string };
}

export interface SentryOrgStats {
  start: string;
  end: string;
  intervals: string[];
  groups: {
    by: Record<string, string>;
    totals: Record<string, number>;
    series: Record<string, number[]>;
  }[];
}

export async function listOrganizations(
  connectionId?: string,
): Promise<SentryOrganization[]> {
  return apiGet<SentryOrganization[]>(
    "/organizations/",
    undefined,
    connectionId,
  );
}

export async function listProjects(
  orgSlug?: string,
  connectionId?: string,
): Promise<SentryProject[]> {
  const org = await getOrgSlug(orgSlug, connectionId);
  return apiGet<SentryProject[]>(
    `/organizations/${org}/projects/`,
    undefined,
    connectionId,
  );
}

export async function listIssues(
  projectSlug?: string,
  query?: string,
  statsPeriod?: string,
  orgSlug?: string,
  connectionId?: string,
): Promise<SentryIssue[]> {
  const org = await getOrgSlug(orgSlug, connectionId);
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (statsPeriod) params.set("statsPeriod", statsPeriod);
  params.set("sort", "freq");

  if (projectSlug) {
    return apiGet<SentryIssue[]>(
      `/projects/${org}/${projectSlug}/issues/?${params.toString()}`,
      undefined,
      connectionId,
    );
  }
  return apiGet<SentryIssue[]>(
    `/organizations/${org}/issues/?${params.toString()}`,
    undefined,
    connectionId,
  );
}

export async function getIssueEvents(
  issueId: string,
  orgSlug?: string,
  connectionId?: string,
): Promise<SentryEvent[]> {
  const org = await getOrgSlug(orgSlug, connectionId);
  return apiGet<SentryEvent[]>(
    `/organizations/${org}/issues/${issueId}/events/`,
    undefined,
    connectionId,
  );
}

export async function getOrganizationStats(
  statsPeriod?: string,
  category?: string,
  orgSlug?: string,
  connectionId?: string,
): Promise<SentryOrgStats> {
  const org = await getOrgSlug(orgSlug, connectionId);
  const params = new URLSearchParams();
  params.set("field", "sum(quantity)");
  if (statsPeriod) params.set("statsPeriod", statsPeriod);
  if (category) {
    params.set("category", category);
  } else {
    params.set("category", "error");
  }
  params.set("groupBy", "outcome");
  return apiGet<SentryOrgStats>(
    `/organizations/${org}/stats_v2/?${params.toString()}`,
    undefined,
    connectionId,
  );
}
