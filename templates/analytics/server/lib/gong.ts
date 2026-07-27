// Gong sales call intelligence API helper
// Fetches calls, transcripts, and users

import { resolveCredential } from "./credentials";
import {
  requireRequestCredentialContext,
  scopedCredentialCacheKey,
} from "./credentials-context";
import {
  DEFAULT_GONG_CALL_LIMIT,
  limitGongCalls,
  normalizeGongCallLimit,
} from "./gong-limits";
import { resolveAnalyticsGongCredentials } from "./provider-credentials";

const DEFAULT_API_BASE = "https://api.gong.io/v2";

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 120;

async function getAuthHeader(): Promise<string> {
  const ctx = requireRequestCredentialContext("GONG_ACCESS_KEY");
  const credentials = await resolveAnalyticsGongCredentials({ ctx });
  if (!credentials)
    throw new Error("GONG_ACCESS_KEY and GONG_ACCESS_SECRET not configured");
  return `Basic ${Buffer.from(
    `${credentials.accessKey}:${credentials.accessSecret}`,
  ).toString("base64")}`;
}

async function getApiBase(): Promise<string> {
  const ctx = requireRequestCredentialContext("GONG_ACCESS_KEY");
  const configured = await resolveCredential("GONG_API_BASE", ctx);
  return (configured || DEFAULT_API_BASE).replace(/\/+$/, "");
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  const key = scopedCredentialCacheKey(cacheKey ?? path, "GONG_ACCESS_KEY");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${await getApiBase()}${path}`, {
    headers: {
      Authorization: await getAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gong API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });

  return data as T;
}

async function apiPost<T>(
  path: string,
  body: unknown,
  cacheKey?: string,
): Promise<T> {
  const key = scopedCredentialCacheKey(
    cacheKey ?? `POST:${path}:${JSON.stringify(body)}`,
    "GONG_ACCESS_KEY",
  );
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const res = await fetch(`${await getApiBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: await getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gong API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });

  return data as T;
}

export interface GongCall {
  id: string;
  title?: string;
  started: string;
  duration?: number;
  parties?: { name: string; emailAddress?: string; affiliation?: string }[];
  [key: string]: unknown;
}

export interface GongUser {
  id: string;
  emailAddress: string;
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
}

export interface GongCallDetail {
  id: string;
  title: string;
  url: string;
  started: string;
  duration: number;
  parties: { name: string; email?: string; affiliation?: string }[];
  brief: string | null;
  keyPoints: string[];
  outline: string[];
}

export interface GongSpeaker {
  name: string;
  email: string | null;
  affiliation: "Internal" | "External" | string;
}

export interface EnrichedMonologue {
  speakerId: string;
  speaker: GongSpeaker | null;
  isExternal: boolean;
  topic: string | null;
  sentences: { start: number; end: number; text: string }[];
}

export interface EnrichedTranscript {
  callId: string;
  callTitle: string;
  started: string;
  speakers: Record<string, GongSpeaker>;
  monologues: EnrichedMonologue[];
  externalMonologues: EnrichedMonologue[];
}

export async function getCalls(filters?: {
  fromDateTime?: string;
  toDateTime?: string;
  cursor?: string;
}): Promise<{ calls: GongCall[]; cursor?: string }> {
  const params = new URLSearchParams();
  if (filters?.fromDateTime) params.set("fromDateTime", filters.fromDateTime);
  if (filters?.toDateTime) params.set("toDateTime", filters.toDateTime);
  if (filters?.cursor) params.set("cursor", filters.cursor);

  const query = params.toString();
  const path = `/calls${query ? `?${query}` : ""}`;
  const data = await apiGet<{
    calls?: GongCall[];
    records?: { cursor?: string };
  }>(path);
  return {
    calls: data.calls ?? [],
    cursor: data.records?.cursor,
  };
}

export async function getCall(callId: string): Promise<GongCall | null> {
  const body = { filter: { callIds: [callId] } };
  const data = await apiPost<{ calls?: GongCall[] }>(
    "/calls",
    body,
    `call:${callId}`,
  );
  return data.calls?.[0] ?? null;
}

export async function getCallDetail(
  callId: string,
): Promise<GongCallDetail | null> {
  const body = {
    filter: { callIds: [callId] },
    contentSelector: {
      exposedFields: {
        parties: true,
        content: { brief: true, keyPoints: true, outline: true },
      },
    },
  };
  const data = await apiPost<{ calls?: any[] }>(
    "/calls/extensive",
    body,
    `detail:${callId}`,
  );
  const call = data.calls?.[0];
  if (!call) return null;
  return {
    id: call.metaData?.id ?? callId,
    title: call.metaData?.title || "Untitled",
    url: call.metaData?.url || "",
    started: call.metaData?.started || "",
    duration: call.metaData?.duration || 0,
    parties: (call.parties || []).map((party: any) => ({
      name: party.name,
      email: party.emailAddress,
      affiliation: party.affiliation,
    })),
    brief: call.content?.brief || null,
    keyPoints: (call.content?.keyPoints || []).map(
      (keyPoint: any) => keyPoint.text || String(keyPoint),
    ),
    outline: (call.content?.outline || []).map(
      (outline: any) => outline.section || outline.text || String(outline),
    ),
  };
}

export async function getCallTranscripts(callIds: string[]): Promise<unknown> {
  const ids = Array.from(
    new Set(
      callIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  );
  if (!ids.length) return { callTranscripts: [] };
  const body = { filter: { callIds: ids } };
  return apiPost("/calls/transcript", body, `transcripts:${ids.join(",")}`);
}

export async function getCallTranscript(callId: string): Promise<unknown> {
  return getCallTranscripts([callId]);
}

export async function getEnrichedTranscript(
  callId: string,
): Promise<EnrichedTranscript | null> {
  const [extensiveData, transcriptData] = await Promise.all([
    apiPost<{ calls?: any[] }>(
      "/calls/extensive",
      {
        filter: { callIds: [callId] },
        contentSelector: { exposedFields: { parties: true } },
      },
      `extensive-parties:${callId}`,
    ),
    apiPost<{ callTranscripts?: any[] }>(
      "/calls/transcript",
      { filter: { callIds: [callId] } },
      `transcript:${callId}`,
    ),
  ]);

  const call = extensiveData.calls?.[0];
  if (!call) return null;

  const speakers: Record<string, GongSpeaker> = {};
  for (const party of call.parties ?? []) {
    const speakerId = String(party.speakerId ?? party.userId ?? "");
    if (!speakerId) continue;
    speakers[speakerId] = {
      name: party.name ?? "Unknown",
      email: party.emailAddress ?? null,
      affiliation: party.affiliation ?? "Unknown",
    };
  }

  const rawMonologues: any[] =
    transcriptData.callTranscripts?.[0]?.transcript ?? [];
  const monologues: EnrichedMonologue[] = rawMonologues.map((monologue) => {
    const speakerId = String(monologue.speakerId ?? "");
    const speaker = speakers[speakerId] ?? null;
    return {
      speakerId,
      speaker,
      isExternal: speaker?.affiliation?.toLowerCase() === "external",
      topic: monologue.topic ?? null,
      sentences: (monologue.sentences ?? []).map((sentence: any) => ({
        start: sentence.start,
        end: sentence.end,
        text: sentence.text,
      })),
    };
  });

  return {
    callId,
    callTitle: call.metaData?.title ?? "Untitled",
    started: call.metaData?.started ?? "",
    speakers,
    monologues,
    externalMonologues: monologues.filter((monologue) => monologue.isExternal),
  };
}

export async function getUsers(): Promise<GongUser[]> {
  const data = await apiGet<{ users?: GongUser[] }>("/users", "users");
  return data.users ?? [];
}

const GONG_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "llc",
  "ltd",
  "of",
  "the",
]);

export function gongSearchVariants(query: string): string[] {
  const variants = new Set<string>();
  const cleaned = query
    .replace(
      /\s*-\s*(new deal|fusion|publish|enterprise upgrade|enterprise)\s*$/i,
      "",
    )
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(
      /\s+(group|inc\.?|corp\.?|corporation|ltd\.?|llc|holdings|global|digital|advisory|solutions|technologies?|services?)\s*$/i,
      "",
    )
    .trim()
    .toLowerCase();
  const raw = query.trim().toLowerCase();

  for (const value of [raw, cleaned]) {
    if (value.length >= 3) variants.add(value);
    const words = value
      .split(/[^a-z0-9@._-]+/)
      .map((word) => word.trim())
      .filter(Boolean);
    if (words.length > 0) {
      variants.add(words[0]);
      if (words.length >= 2) variants.add(`${words[0]} ${words[1]}`);
      variants.add(`@${words[0]}.`);
      variants.add(`${words[0]}.com`);
    }
  }

  const domain = raw.match(/[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  if (domain) {
    variants.add(domain);
    variants.add(`@${domain}`);
  }

  return Array.from(variants).filter((variant) => variant.length >= 3);
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !GONG_QUERY_STOP_WORDS.has(term));
}

function partySearchText(
  party: NonNullable<GongCall["parties"]>[number],
): string {
  return [party.name, party.emailAddress, party.affiliation]
    .filter((value): value is string => typeof value === "string" && !!value)
    .join(" ");
}

export function matchesGongCallQuery(call: GongCall, query: string): boolean {
  const lowerQuery = query.trim().toLowerCase();
  if (!lowerQuery) return true;

  const searchable = [
    call.title,
    ...(call.parties ?? []).map((party) => partySearchText(party)),
  ]
    .filter((value): value is string => typeof value === "string" && !!value)
    .join(" ")
    .toLowerCase();

  if (searchable.includes(lowerQuery)) return true;

  const variants = gongSearchVariants(lowerQuery);
  if (variants.some((variant) => searchable.includes(variant))) return true;

  const terms = queryTerms(lowerQuery);
  return terms.length > 0 && terms.every((term) => searchable.includes(term));
}

function isExternalCall(call: GongCall): boolean {
  const scope = (call as Record<string, unknown>).scope;
  return typeof scope !== "string" || scope.toLowerCase() === "external";
}

function partyMatchesQuery(
  parties: { name: string; emailAddress?: string; affiliation?: string }[],
  query: string,
): boolean {
  const variants = gongSearchVariants(query);
  const emailVariants = variants.filter(
    (variant) => variant.startsWith("@") || variant.includes("."),
  );
  const nameVariants = variants.filter(
    (variant) => !variant.startsWith("@") && !variant.includes("."),
  );
  const externalParties = parties.filter(
    (party) => party.affiliation?.toLowerCase() === "external",
  );
  if (parties.length > 0 && externalParties.length === 0) return false;

  const partyNames = parties
    .map((party) => party.name ?? "")
    .join(" ")
    .toLowerCase();
  const externalEmails = externalParties
    .map((party) => party.emailAddress ?? "")
    .join(" ")
    .toLowerCase();
  return (
    nameVariants.some((variant) => partyNames.includes(variant)) ||
    emailVariants.some((variant) => externalEmails.includes(variant))
  );
}

export interface GongCallSearchResult {
  calls: Array<GongCall & { matchedQueries?: string[] }>;
  limit: number;
  truncated: boolean;
  searchedCallCount: number;
  matchedCallCount: number;
  queryCount: number;
  coverageTruncated: boolean;
}

export interface GongCallSearchOptions {
  fromDateTime?: string;
  toDateTime?: string;
  exhaustive?: boolean;
}

function normalizedSearchQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function addMatchedQuery(
  matches: Map<string, GongCall & { matchedQueries?: string[] }>,
  call: GongCall,
  query: string,
  parties?: { name: string; emailAddress?: string; affiliation?: string }[],
) {
  const existing = matches.get(call.id);
  const matchedQueries = new Set([...(existing?.matchedQueries ?? []), query]);
  matches.set(call.id, {
    ...(existing ?? call),
    ...(parties?.length ? { parties } : {}),
    matchedQueries: Array.from(matchedQueries),
  });
}

function normalizeExtensiveCall(value: unknown): GongCall | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const metadata =
    record.metaData && typeof record.metaData === "object"
      ? (record.metaData as Record<string, unknown>)
      : record;
  const id = typeof metadata.id === "string" ? metadata.id : "";
  const started = typeof metadata.started === "string" ? metadata.started : "";
  if (!id || !started) return null;
  const parties = Array.isArray(record.parties)
    ? record.parties.map((party) => {
        const item = party as Record<string, unknown>;
        return {
          name: typeof item.name === "string" ? item.name : "",
          ...(typeof item.emailAddress === "string"
            ? { emailAddress: item.emailAddress }
            : {}),
          ...(typeof item.affiliation === "string"
            ? { affiliation: item.affiliation }
            : {}),
        };
      })
    : [];
  return {
    ...metadata,
    id,
    started,
    parties,
  };
}

export async function searchCallsForQueries(
  queries: string[],
  days = 90,
  limit = DEFAULT_GONG_CALL_LIMIT,
  options: GongCallSearchOptions = {},
): Promise<GongCallSearchResult> {
  const fromDateTime =
    options.fromDateTime ??
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const normalizedLimit = normalizeGongCallLimit(limit);
  const normalizedQueries = normalizedSearchQueries(queries);

  if (!normalizedQueries.length) {
    return {
      calls: [],
      limit: normalizedLimit,
      truncated: false,
      searchedCallCount: 0,
      matchedCallCount: 0,
      queryCount: 0,
      coverageTruncated: false,
    };
  }

  const matches = new Map<string, GongCall & { matchedQueries?: string[] }>();
  let searchedCallCount = 0;
  let cursor: string | undefined;
  do {
    const data = await apiPost<{
      calls?: unknown[];
      records?: { cursor?: string; totalRecords?: number };
    }>("/calls/extensive", {
      filter: {
        fromDateTime,
        ...(options.toDateTime ? { toDateTime: options.toDateTime } : {}),
      },
      contentSelector: { exposedFields: { parties: true } },
      ...(cursor ? { cursor } : {}),
    });
    const calls = (data.calls ?? [])
      .map(normalizeExtensiveCall)
      .filter((call): call is GongCall => Boolean(call))
      .filter(isExternalCall);
    searchedCallCount += calls.length;
    cursor = data.records?.cursor;

    for (const call of calls) {
      const parties = call.parties ?? [];
      for (const query of normalizedQueries) {
        const titleMatches = matchesGongCallQuery(
          { ...call, parties: [] },
          query,
        );
        if (titleMatches || partyMatchesQuery(parties, query)) {
          addMatchedQuery(matches, call, query, parties);
        }
      }
      if (!options.exhaustive && matches.size >= normalizedLimit) break;
    }
  } while (cursor && (options.exhaustive || matches.size < normalizedLimit));

  const matchedCalls = Array.from(matches.values());
  return buildGongSearchResult(matchedCalls, normalizedLimit, {
    searchedCallCount,
    queryCount: normalizedQueries.length,
    cursor,
    exhaustive: Boolean(options.exhaustive),
  });
}

/**
 * Assemble the final search result from the matched calls. In `exhaustive` mode
 * EVERY match is returned (newest-first, untruncated) — the caller has already
 * bounded the set with a date window / cohort queries, so re-capping here would
 * silently drop matches and reintroduce the "only captured a subset" failure.
 * Otherwise the newest `normalizedLimit` are returned and truncation reflects
 * the cap or a remaining cursor. Exported for unit testing.
 */
export function buildGongSearchResult(
  matchedCalls: (GongCall & { matchedQueries?: string[] })[],
  normalizedLimit: number,
  meta: {
    searchedCallCount: number;
    queryCount: number;
    cursor: string | undefined;
    exhaustive: boolean;
  },
): GongCallSearchResult {
  if (meta.exhaustive) {
    const sorted = [...matchedCalls].sort(
      (a, b) =>
        (b.started ? Date.parse(b.started) : 0) -
        (a.started ? Date.parse(a.started) : 0),
    );
    return {
      calls: sorted,
      limit: sorted.length,
      truncated: false,
      searchedCallCount: meta.searchedCallCount,
      matchedCallCount: matchedCalls.length,
      queryCount: meta.queryCount,
      coverageTruncated: false,
    };
  }
  const limited = limitGongCalls(matchedCalls, normalizedLimit);
  return {
    ...limited,
    truncated: limited.truncated || Boolean(meta.cursor),
    searchedCallCount: meta.searchedCallCount,
    matchedCallCount: matchedCalls.length,
    queryCount: meta.queryCount,
    coverageTruncated: Boolean(meta.cursor),
  };
}

export async function searchCalls(
  query: string,
  days = 90,
  limit = DEFAULT_GONG_CALL_LIMIT,
  options: GongCallSearchOptions = {},
): Promise<{ calls: GongCall[]; limit: number; truncated: boolean }> {
  return searchCallsForQueries([query], days, limit, options);
}
