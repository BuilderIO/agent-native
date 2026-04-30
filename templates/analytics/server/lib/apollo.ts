// Apollo.io contact & company enrichment API helper
// Search people, enrich contacts, search/enrich organizations

import { resolveCredential } from "./credentials";
import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";

const API_BASE = "https://api.apollo.io";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 120;

async function getApiKey(): Promise<string> {
  const ctx = requireRequestCredentialContext("APOLLO_API_KEY");
  const key = await resolveCredential("APOLLO_API_KEY", ctx);
  if (!key) throw new Error("APOLLO_API_KEY not configured");
  return key;
}

async function apiPost<T>(
  path: string,
  body: Record<string, unknown>,
  cacheKey?: string,
): Promise<T> {
  const key = scopedCredentialCacheKey(
    cacheKey ?? `POST:${path}:${JSON.stringify(body)}`,
    "APOLLO_API_KEY",
  );
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": await getApiKey(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apollo API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });

  return data as T;
}

export interface ApolloPerson {
  id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  title?: string;
  organization_name?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  [key: string]: unknown;
}

export interface ApolloOrganization {
  id: string;
  name?: string;
  domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  linkedin_url?: string;
  founded_year?: number;
  [key: string]: unknown;
}

export async function searchPeople(params: {
  q_person_name?: string;
  q_organization_name?: string;
  person_titles?: string[];
  person_locations?: string[];
  per_page?: number;
  page?: number;
}): Promise<{ people: ApolloPerson[]; total: number }> {
  const body: Record<string, unknown> = {
    per_page: params.per_page ?? 25,
    page: params.page ?? 1,
  };
  if (params.q_person_name) body.q_person_name = params.q_person_name;
  if (params.q_organization_name)
    body.q_organization_name = params.q_organization_name;
  if (params.person_titles) body.person_titles = params.person_titles;
  if (params.person_locations) body.person_locations = params.person_locations;

  const data = await apiPost<{
    people?: ApolloPerson[];
    pagination?: { total_entries?: number };
  }>("/v1/mixed_people/search", body);
  return {
    people: data.people ?? [],
    total: data.pagination?.total_entries ?? 0,
  };
}

export async function enrichPerson(
  email: string,
): Promise<ApolloPerson | null> {
  try {
    const data = await apiPost<{ person?: ApolloPerson }>(
      "/v1/people/match",
      { email },
      `enrich:person:${email}`,
    );
    return data.person ?? null;
  } catch {
    return null;
  }
}

export async function searchOrganizations(
  query: string,
  params?: {
    per_page?: number;
    page?: number;
  },
): Promise<{ organizations: ApolloOrganization[]; total: number }> {
  const body: Record<string, unknown> = {
    q_organization_name: query,
    per_page: params?.per_page ?? 25,
    page: params?.page ?? 1,
  };

  const data = await apiPost<{
    organizations?: ApolloOrganization[];
    pagination?: { total_entries?: number };
  }>("/v1/mixed_companies/search", body);
  return {
    organizations: data.organizations ?? [],
    total: data.pagination?.total_entries ?? 0,
  };
}

export async function enrichOrganization(
  domain: string,
): Promise<ApolloOrganization | null> {
  try {
    const data = await apiPost<{ organization?: ApolloOrganization }>(
      "/v1/organizations/enrich",
      { domain },
      `enrich:org:${domain}`,
    );
    return data.organization ?? null;
  } catch {
    return null;
  }
}
