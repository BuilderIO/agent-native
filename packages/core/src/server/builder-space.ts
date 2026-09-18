/**
 * Resolve the human-readable Builder *space* a private key is scoped to.
 *
 * There is no public-key path to a space's display name; it comes from the
 * Builder Admin GraphQL API (`https://builder.io/api/v2/admin`) authenticated
 * with the private `bpk-…` key we already hold at user scope. A `bpk-` key is
 * space-scoped, so today this resolves the single connected space — but the
 * function returns a *list* so the multi-space drill-down can grow additively
 * (multiple credentials → multiple spaces) without a restructure.
 *
 * The exact `settings` field holding the display name is undocumented, so the
 * parser is deliberately defensive: it requests the whole `settings` JSON blob
 * and pulls the first plausible name/id field. Callers fall back to the generic
 * `orgName` when this returns nothing.
 */

import { createHash } from "node:crypto";

export interface BuilderSpaceSummary {
  id: string;
  name: string;
}

interface BuilderAdminGraphQlResponse {
  data?: { settings?: unknown } | null;
  errors?: Array<{ message?: string }> | null;
}

interface SpaceCacheEntry {
  expiresAt: number;
  spaces: BuilderSpaceSummary[];
}

// The admin API is polled indirectly via the Builder status route, which the
// client refetches often. Cache per key so a poll storm hits Builder once.
// A resolved name is cached for a while; an empty/failed lookup is cached only
// briefly so a transient Builder hiccup recovers without hammering the API.
const SPACE_CACHE_TTL_MS = 5 * 60 * 1000;
const SPACE_NEGATIVE_TTL_MS = 60 * 1000;
const SPACE_CACHE_MAX_ENTRIES = 100;
// Hard cap on the admin call — the status route must never block on Builder.
const ADMIN_FETCH_TIMEOUT_MS = 4000;
const spaceCache = new Map<string, SpaceCacheEntry>();

// `query { settings }` selects the whole JSONObject scalar, so we don't have to
// know the sub-field names up front — we parse the returned blob below.
const BUILDER_SPACE_SETTINGS_QUERY =
  "query AgentNativeSpaceSettings { settings }";

const SPACE_NAME_FIELDS = [
  "name",
  "displayName",
  "siteName",
  "spaceName",
  "title",
  "organizationName",
] as const;

const SPACE_ID_FIELDS = ["id", "spaceId", "publicKey"] as const;

function builderAdminApiHost() {
  return (
    process.env.BUILDER_ADMIN_API_HOST ?? "https://builder.io/api/v2/admin"
  ).replace(/\/+$/, "");
}

function cacheKey(privateKey: string) {
  return createHash("sha256").update(privateKey).digest("hex");
}

function setCachedSpaces(key: string, entry: SpaceCacheEntry) {
  if (!spaceCache.has(key) && spaceCache.size >= SPACE_CACHE_MAX_ENTRIES) {
    const [oldest] = spaceCache.keys();
    if (oldest) spaceCache.delete(oldest);
  }
  spaceCache.set(key, entry);
}

function firstString(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function parseSpacesFromSettings(
  json: BuilderAdminGraphQlResponse,
): BuilderSpaceSummary[] {
  const settings = json?.data?.settings;
  if (!settings || typeof settings !== "object") return [];
  const record = settings as Record<string, unknown>;
  const name = firstString(record, SPACE_NAME_FIELDS);
  if (!name) return [];
  const id = firstString(record, SPACE_ID_FIELDS) ?? name;
  return [{ id, name }];
}

/**
 * Synchronously read the cached space list for a key, or null if there's no
 * fresh entry. The status route uses this to stay non-blocking — it returns
 * whatever is cached now and kicks `listBuilderSpaces` in the background to
 * populate the cache for the next poll.
 */
export function getCachedBuilderSpaces(
  privateKey: string,
): BuilderSpaceSummary[] | null {
  if (!privateKey) return null;
  const cached = spaceCache.get(cacheKey(privateKey));
  if (cached && Date.now() < cached.expiresAt) return cached.spaces;
  return null;
}

/**
 * List the Builder spaces reachable with this private key. Best-effort: returns
 * `[]` on any network/auth/parse failure (caller should fall back to orgName).
 */
export async function listBuilderSpaces(
  privateKey: string,
  options?: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<BuilderSpaceSummary[]> {
  if (!privateKey) return [];

  const key = cacheKey(privateKey);
  const cached = spaceCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.spaces;
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  // Cap the admin call ourselves so a stalled Builder can't hang the status
  // route. If the caller passed its own signal, respect it instead.
  const timeoutController = options?.signal ? null : new AbortController();
  const timeout = timeoutController
    ? setTimeout(() => timeoutController.abort(), ADMIN_FETCH_TIMEOUT_MS)
    : null;
  let spaces: BuilderSpaceSummary[] = [];
  try {
    const response = await fetchImpl(builderAdminApiHost(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${privateKey}`,
      },
      body: JSON.stringify({ query: BUILDER_SPACE_SETTINGS_QUERY }),
      signal: options?.signal ?? timeoutController?.signal,
    });
    if (response.ok) {
      const json = (await response.json()) as BuilderAdminGraphQlResponse;
      spaces = parseSpacesFromSettings(json);
    }
  } catch {
    // Network / timeout / admin API unavailable — fall through to the empty
    // list; the caller falls back to orgName.
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  // Cache a resolved name for the full TTL; cache an empty/failed lookup only
  // briefly so a transient Builder hiccup recovers without per-poll hammering.
  setCachedSpaces(key, {
    expiresAt:
      Date.now() +
      (spaces.length > 0 ? SPACE_CACHE_TTL_MS : SPACE_NEGATIVE_TTL_MS),
    spaces,
  });
  return spaces;
}

/** Test/maintenance hook — drop cached space lookups. */
export function clearBuilderSpaceCache() {
  spaceCache.clear();
}
