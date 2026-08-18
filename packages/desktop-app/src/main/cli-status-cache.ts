/**
 * Probing a local CLI costs a process spawn. Host metadata is polled every 5s,
 * so running those probes synchronously on each poll blocks the Electron main
 * process — and a blocked main process stalls window drag/resize, menus, and
 * every IPC reply, which reads as app-wide input lag rather than as a slow
 * probe. Serve a cached answer and refresh it off the event loop.
 */

export const CLI_STATUS_TTL_MS = 60_000;

export interface CliStatusCache<T> {
  value?: T;
  probedAt: number;
  refreshing: boolean;
}

export function createCliStatusCache<T>(): CliStatusCache<T> {
  return { probedAt: 0, refreshing: false };
}

/**
 * Returns the cached probe result, refreshing in the background once it is
 * older than `ttlMs`.
 *
 * The first call probes synchronously on purpose: an empty cache has no answer
 * to give, and a placeholder "unavailable" would be indistinguishable to every
 * caller from a real "this CLI is not installed".
 */
export function cachedCliStatus<T>(
  cache: CliStatusCache<T>,
  probeSync: () => T,
  probeAsync: () => Promise<T>,
  now: () => number = Date.now,
  ttlMs: number = CLI_STATUS_TTL_MS,
): T {
  if (cache.value === undefined) {
    cache.value = probeSync();
    cache.probedAt = now();
    return cache.value;
  }
  if (!cache.refreshing && now() - cache.probedAt >= ttlMs) {
    cache.refreshing = true;
    void probeAsync()
      .then((value) => {
        cache.value = value;
        cache.probedAt = now();
      })
      .finally(() => {
        cache.refreshing = false;
      });
  }
  return cache.value;
}
