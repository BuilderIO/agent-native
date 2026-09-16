import {
  getSetting,
  mutateSetting,
  putSetting,
} from "@agent-native/core/settings";

const REPO_URL = "https://api.github.com/repos/BuilderIO/agent-native";
const CACHE_KEY = "docs:github-stars";
const FETCH_TIMEOUT_MS = 5_000;
const SSR_FETCH_BUDGET_MS = 1_000;
const CACHE_FRESH_MS = 5 * 60_000;
const REFRESH_LEASE_MS = 30_000;
const FAILURE_RETRY_MS = 60_000;

type GithubStarCache = {
  count: number | null;
  fetchedAt: number;
  retryAt: number | null;
  refreshUntil: number | null;
};

let cache: GithubStarCache | null = null;
let persistentRead: Promise<GithubStarCache | null> | null = null;
let refreshInFlight: Promise<number | null> | null = null;
let persistenceUnavailableWarned = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function parseCache(value: unknown): GithubStarCache | null {
  if (!isRecord(value)) return null;

  const rawCount = value.count;
  const count =
    rawCount === null
      ? null
      : typeof rawCount === "number" &&
          Number.isSafeInteger(rawCount) &&
          rawCount >= 0
        ? rawCount
        : undefined;
  if (count === undefined) return null;

  const fetchedAt = timestamp(value.fetchedAt);
  if (fetchedAt === null) return null;

  const retryAt =
    value.retryAt === null ? null : timestamp(value.retryAt ?? undefined);
  const refreshUntil =
    value.refreshUntil === null
      ? null
      : timestamp(value.refreshUntil ?? undefined);
  if (retryAt === null && value.retryAt !== null) return null;
  if (refreshUntil === null && value.refreshUntil !== null) return null;

  return { count, fetchedAt, retryAt, refreshUntil };
}

function emptyCache(): GithubStarCache {
  return { count: null, fetchedAt: 0, retryAt: null, refreshUntil: null };
}

function cacheValue(value: GithubStarCache): Record<string, unknown> {
  return value;
}

function retryAtFromResponse(response: Response): number {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Date.now() + seconds * 1000;
    }

    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return date;
  }

  const resetHeader = response.headers.get("x-ratelimit-reset")?.trim();
  if (resetHeader) {
    const reset = Number(resetHeader);
    if (Number.isFinite(reset) && reset >= 0) return reset * 1000;
  }

  return Date.now() + FAILURE_RETRY_MS;
}

async function fetchStarCount(): Promise<{
  count: number | null;
  retryAt: number;
}> {
  try {
    const response = await fetch(REPO_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { count: null, retryAt: retryAtFromResponse(response) };
    }

    const data = await response.json();
    const count =
      typeof data.stargazers_count === "number" &&
      Number.isSafeInteger(data.stargazers_count) &&
      data.stargazers_count >= 0
        ? data.stargazers_count
        : null;
    return { count, retryAt: Date.now() + FAILURE_RETRY_MS };
  } catch {
    // coercion-ok: Network/API failures surface as an explicit null, not a fake value
    return { count: null, retryAt: Date.now() + FAILURE_RETRY_MS };
  }
}

function warnPersistenceUnavailable(error: unknown): void {
  if (persistenceUnavailableWarned) return;
  persistenceUnavailableWarned = true;
  console.warn(
    "[docs] GitHub star cache is unavailable; using process-local cache:",
    error,
  );
}

async function readPersistedCache(): Promise<GithubStarCache | null> {
  if (cache) return cache;
  if (persistentRead) return persistentRead;

  persistentRead = (async () => {
    try {
      const persisted = parseCache(await getSetting(CACHE_KEY));
      if (persisted) cache = persisted;
      return persisted;
    } catch (error) {
      warnPersistenceUnavailable(error);
      return null;
    }
  })().finally(() => {
    persistentRead = null;
  });
  return persistentRead;
}

function shouldRefresh(value: GithubStarCache, now: number): boolean {
  if (value.retryAt !== null && now < value.retryAt) return false;
  if (value.refreshUntil !== null && now < value.refreshUntil) return false;
  return value.count === null || now - value.fetchedAt >= CACHE_FRESH_MS;
}

function isFresh(value: GithubStarCache, now: number): boolean {
  return value.count !== null && now - value.fetchedAt < CACHE_FRESH_MS;
}

async function persistCache(value: GithubStarCache): Promise<void> {
  try {
    await putSetting(CACHE_KEY, cacheValue(value));
  } catch (error) {
    warnPersistenceUnavailable(error);
  }
}

async function claimRefresh(now: number): Promise<{
  claimed: boolean;
  cache: GithubStarCache;
}> {
  let claimed = false;
  try {
    const value = await mutateSetting(CACHE_KEY, (current) => {
      claimed = false;
      const currentCache = parseCache(current) ?? cache ?? emptyCache();
      const currentNow = Date.now();
      if (
        isFresh(currentCache, currentNow) ||
        (currentCache.retryAt !== null && currentNow < currentCache.retryAt) ||
        (currentCache.refreshUntil !== null &&
          currentNow < currentCache.refreshUntil)
      ) {
        return cacheValue(currentCache);
      }

      claimed = true;
      return cacheValue({
        ...currentCache,
        refreshUntil: currentNow + REFRESH_LEASE_MS,
      });
    });
    const currentCache = parseCache(value) ?? cache ?? emptyCache();
    cache = currentCache;
    return { claimed, cache: currentCache };
  } catch (error) {
    warnPersistenceUnavailable(error);
    const localCache = cache ?? emptyCache();
    return {
      claimed:
        (localCache.retryAt === null || now >= localCache.retryAt) &&
        (localCache.refreshUntil === null || now >= localCache.refreshUntil),
      cache: localCache,
    };
  }
}

function refresh(): Promise<number | null> {
  if (refreshInFlight) return refreshInFlight;

  const request = (async () => {
    const result = await claimRefresh(Date.now());
    if (!result.claimed) return result.cache.count;

    const fetched = await fetchStarCount();
    const next: GithubStarCache =
      fetched.count === null
        ? {
            ...result.cache,
            retryAt: fetched.retryAt,
            refreshUntil: null,
          }
        : {
            count: fetched.count,
            fetchedAt: Date.now(),
            retryAt: null,
            refreshUntil: null,
          };
    cache = next;
    await persistCache(next);
    return next.count;
  })();

  refreshInFlight = request.finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function withSsrBudget(
  refreshPromise: Promise<number | null>,
): Promise<number | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), SSR_FETCH_BUDGET_MS);
  });
  return Promise.race([refreshPromise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

async function getGithubStarCountUnbounded(): Promise<number | null> {
  const persisted = await readPersistedCache();
  const current = cache ?? persisted;
  if (current) {
    if (shouldRefresh(current, Date.now())) {
      if (current.count === null) return refresh();
      void refresh();
    }
    if (current.count === null && refreshInFlight) return refreshInFlight;
    return current.count;
  }

  return refresh();
}

export async function getGithubStarCount(): Promise<number | null> {
  return withSsrBudget(getGithubStarCountUnbounded());
}

export function resetGithubStarCountCacheForTests(): void {
  cache = null;
  persistentRead = null;
  refreshInFlight = null;
  persistenceUnavailableWarned = false;
}
