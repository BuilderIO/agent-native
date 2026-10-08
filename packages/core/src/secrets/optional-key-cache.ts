// ponytail: process-local 60s cache; a TTL bounds cross-instance staleness without a distributed invalidation channel.
const OPTIONAL_KEY_CACHE_TTL_MS = 60_000;

type CacheEntry = {
  value: string | undefined;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

export function readOptionalKeyCache(
  key: string,
): { hit: true; value: string | undefined } | { hit: false } {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

export function writeOptionalKeyCache(
  key: string,
  value: string | undefined,
): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + OPTIONAL_KEY_CACHE_TTL_MS,
  });
}

export function invalidateOptionalKeyCache(): void {
  cache.clear();
}

/** @internal exported for tests only */
export function resetOptionalKeyCache(): void {
  cache.clear();
}
