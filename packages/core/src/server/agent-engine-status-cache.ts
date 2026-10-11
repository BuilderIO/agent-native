const AGENT_ENGINE_STATUS_CACHE_TTL_MS = 1000;
const AGENT_ENGINE_STATUS_IN_FLIGHT_TTL_MS = 10_000;
const MAX_AGENT_ENGINE_STATUS_CACHE_ENTRIES = 2048;

interface StatusCacheEntry<T> {
  expiresAt: number;
  request: Promise<T>;
}

const statusByIdentity = new Map<string, StatusCacheEntry<unknown>>();

function pruneStatusCache(now: number): void {
  for (const [key, entry] of statusByIdentity) {
    if (entry.expiresAt <= now) statusByIdentity.delete(key);
  }

  if (statusByIdentity.size <= MAX_AGENT_ENGINE_STATUS_CACHE_ENTRIES) return;
  const oldestEntries = [...statusByIdentity.entries()].sort(
    (left, right) => left[1].expiresAt - right[1].expiresAt,
  );
  for (const [key] of oldestEntries) {
    if (statusByIdentity.size <= MAX_AGENT_ENGINE_STATUS_CACHE_ENTRIES) break;
    statusByIdentity.delete(key);
  }
}

function statusCacheKey(identity: {
  userEmail?: string | null;
  orgId?: string | null;
}): string {
  return JSON.stringify([
    identity.userEmail?.trim().toLowerCase() ?? null,
    identity.orgId?.trim() || null,
  ]);
}

export function memoizeAgentEngineStatus<T>(
  identity: { userEmail?: string | null; orgId?: string | null },
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  pruneStatusCache(now);
  const key = statusCacheKey(identity);
  const existing = statusByIdentity.get(key) as StatusCacheEntry<T> | undefined;
  if (existing && existing.expiresAt > Date.now()) return existing.request;

  const entry: StatusCacheEntry<T> = {
    expiresAt: now + AGENT_ENGINE_STATUS_IN_FLIGHT_TTL_MS,
    request: Promise.resolve(undefined as T),
  };
  let timeout!: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Agent engine status lookup timed out")),
      AGENT_ENGINE_STATUS_IN_FLIGHT_TTL_MS,
    );
  });
  entry.request = Promise.race([Promise.resolve().then(load), timedOut])
    .then((value) => {
      entry.expiresAt = Date.now() + AGENT_ENGINE_STATUS_CACHE_TTL_MS;
      pruneStatusCache(Date.now());
      return value;
    })
    .catch((error) => {
      if (statusByIdentity.get(key) === entry) statusByIdentity.delete(key);
      throw error;
    })
    .finally(() => clearTimeout(timeout));
  statusByIdentity.set(key, entry as StatusCacheEntry<unknown>);
  return entry.request;
}

export function getMemoizedAgentEngineStatus<T>(identity: {
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<T> | undefined {
  pruneStatusCache(Date.now());
  const entry = statusByIdentity.get(statusCacheKey(identity)) as
    | StatusCacheEntry<T>
    | undefined;
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.request;
}

export function invalidateAgentEngineStatusCache(): void {
  statusByIdentity.clear();
}

/** @internal Test assertion for bounded status-cache retention. */
export function getAgentEngineStatusCacheSizeForTests(): number {
  pruneStatusCache(Date.now());
  return statusByIdentity.size;
}
