// Sentry API helper
// Fetches projects, issues, events, and org-level stats

import { resolveCredential } from "./credentials";
import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";

const API_BASE = "https://sentry.io/api/0";
const DEFAULT_ORG_SLUG = "bridge-tm";

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 100;

async function getToken(): Promise<string> {
  const ctx = requireRequestCredentialContext("SENTRY_AUTH_TOKEN");
  const token =
    (await resolveCredential("SENTRY_SERVER_TOKEN", ctx)) ??
    (await resolveCredential("SENTRY_AUTH_TOKEN", ctx));
  if (!token) throw new Error("SENTRY_AUTH_TOKEN not configured");
  return token;
}

async function getOrgSlug(orgSlug?: string): Promise<string> {
  const trimmed = orgSlug?.trim();
  if (trimmed) return trimmed;
  const ctx = requireRequestCredentialContext("SENTRY_AUTH_TOKEN");
  return (await resolveCredential("SENTRY_ORG_SLUG", ctx)) ?? DEFAULT_ORG_SLUG;
}

function cacheSet(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = scopedCredentialCacheKey(cacheKey ?? path, "SENTRY_SERVER_TOKEN");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${await getToken()}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sentry API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  cacheSet(key, data);
  return data as T;
}

// -- Types --

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

// -- API functions --

export async function listProjects(orgSlug?: string): Promise<SentryProject[]> {
  const org = await getOrgSlug(orgSlug);
  return apiGet<SentryProject[]>(`/organizations/${org}/projects/`);
}

export async function listIssues(
  projectSlug?: string,
  query?: string,
  statsPeriod?: string,
  orgSlug?: string,
): Promise<SentryIssue[]> {
  const org = await getOrgSlug(orgSlug);
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (statsPeriod) params.set("statsPeriod", statsPeriod);
  params.set("sort", "freq");

  if (projectSlug) {
    return apiGet<SentryIssue[]>(
      `/projects/${org}/${projectSlug}/issues/?${params.toString()}`,
    );
  }
  return apiGet<SentryIssue[]>(
    `/organizations/${org}/issues/?${params.toString()}`,
  );
}

export async function getIssueEvents(
  issueId: string,
  orgSlug?: string,
): Promise<SentryEvent[]> {
  const org = await getOrgSlug(orgSlug);
  return apiGet<SentryEvent[]>(
    `/organizations/${org}/issues/${issueId}/events/`,
  );
}

export async function getOrganizationStats(
  statsPeriod?: string,
  category?: string,
  orgSlug?: string,
): Promise<SentryOrgStats> {
  const org = await getOrgSlug(orgSlug);
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
  );
}
