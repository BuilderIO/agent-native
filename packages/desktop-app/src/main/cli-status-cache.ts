export const CLI_STATUS_TTL_MS = 60_000;

export interface CliStatusCache<T> {
  value?: T;
  probedAt: number;
  refreshing: boolean;
  generation: number;
}

export function createCliStatusCache<T>(): CliStatusCache<T> {
  return { probedAt: 0, refreshing: false, generation: 0 };
}

export function invalidateCliStatusCache<T>(cache: CliStatusCache<T>): void {
  cache.value = undefined;
  cache.probedAt = 0;
  cache.refreshing = false;
  cache.generation += 1;
}

function startCliStatusRefresh<T>(
  cache: CliStatusCache<T>,
  probeAsync: () => Promise<T>,
  now: () => number,
): void {
  if (cache.refreshing) return;
  const generation = cache.generation;
  cache.refreshing = true;
  void probeAsync()
    .then((value) => {
      if (cache.generation !== generation) return;
      cache.value = value;
      cache.probedAt = now();
    })
    .finally(() => {
      if (cache.generation !== generation) return;
      cache.refreshing = false;
    });
}

export function cachedCliStatus<T>(
  cache: CliStatusCache<T>,
  probeSync: () => T,
  probeAsync: () => Promise<T>,
  now: () => number = Date.now,
  ttlMs: number = CLI_STATUS_TTL_MS,
  options: { refresh?: boolean } = {},
): T {
  if (options.refresh && cache.value !== undefined) {
    startCliStatusRefresh(cache, probeAsync, now);
  }
  if (cache.value === undefined) {
    cache.value = probeSync();
    cache.probedAt = now();
    return cache.value;
  }
  if (!cache.refreshing && now() - cache.probedAt >= ttlMs) {
    startCliStatusRefresh(cache, probeAsync, now);
  }
  return cache.value;
}
