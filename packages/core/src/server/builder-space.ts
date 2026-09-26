
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

const SPACE_CACHE_TTL_MS = 5 * 60 * 1000;
const SPACE_NEGATIVE_TTL_MS = 60 * 1000;
const SPACE_CACHE_MAX_ENTRIES = 100;
const ADMIN_FETCH_TIMEOUT_MS = 4000;
const spaceCache = new Map<string, SpaceCacheEntry>();

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

export function getCachedBuilderSpaces(
  privateKey: string,
): BuilderSpaceSummary[] | null {
  if (!privateKey) return null;
  const cached = spaceCache.get(cacheKey(privateKey));
  if (cached && Date.now() < cached.expiresAt) return cached.spaces;
  return null;
}

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

  setCachedSpaces(key, {
    expiresAt:
      Date.now() +
      (spaces.length > 0 ? SPACE_CACHE_TTL_MS : SPACE_NEGATIVE_TTL_MS),
    spaces,
  });
  return spaces;
}

export function clearBuilderSpaceCache() {
  spaceCache.clear();
}
