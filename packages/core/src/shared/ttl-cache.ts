/**
 * Bounded process-level TTL cache for answers that are expensive to re-fetch
 * and safe to serve slightly stale.
 *
 * ## Which cache do I want?
 *
 * This repo has exactly two general caching patterns. Reach for an existing one
 * rather than hand-rolling a third `Map` with timestamps in it:
 *
 * 1. **Request-scoped** — `WeakMap<RequestContext, Map<...>>`, freed with the
 *    request. Use when repeated reads within ONE request must collapse but no
 *    answer may outlive it. See `settings/store.ts` (`requestSettingsCache`),
 *    `org/request-org-cache.ts`, `secrets/storage.ts`.
 * 2. **Process-scoped with a TTL** — this module. Use when every request
 *    re-reads the same value and staleness bounded by the TTL is acceptable.
 *    Every consumer must also wire an invalidation path for the writes that
 *    change the answer; the TTL is a backstop, not the correctness story.
 *
 * Two caches deliberately do NOT use this and should stay as they are, because
 * flattening them into this shape would lose behavior they depend on:
 *
 * - `server/poll.ts`'s collab access cache — different TTL per outcome
 *   (allow vs deny), a per-resource invalidation epoch, and in-flight request
 *   dedup.
 * - `demo/redact.ts` — a bidirectional memo (forward map plus a produced-value
 *   reverse index) with refresh-on-read recency, needed for round-trip
 *   stability.
 *
 * The per-request memos elsewhere in this codebase (`event.context` caches,
 * `requestSettingsCache`) collapse repeated reads WITHIN one request. They do
 * nothing for a value every request re-reads identically — a session token's
 * email, an account's org memberships — which on a remote Postgres is a round
 * trip per request per value, forever.
 *
 * ## Only cache successful reads
 *
 * Never `set` a value that stands for "I could not read this". A cached
 * "unreadable" is indistinguishable from a cached "absent" to every later
 * caller, which is exactly how a transient blip turns into a
 * permanent-looking wrong answer. Leave failures on the uncached path so they
 * stay loud and retryable.
 *
 * ## Bounded on purpose
 *
 * Keys here are user-supplied (session tokens, emails), so an unbounded map is
 * a memory leak that grows with traffic. `maxEntries` evicts oldest-written
 * first once the cap is reached.
 */
export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

export function createTtlCache<V>(options: {
  ttlMs: number;
  maxEntries: number;
}): TtlCache<V> {
  const { ttlMs, maxEntries } = options;
  if (!(ttlMs > 0)) {
    throw new Error(`createTtlCache: ttlMs must be positive, got ${ttlMs}`);
  }
  if (!(maxEntries > 0)) {
    throw new Error(
      `createTtlCache: maxEntries must be positive, got ${maxEntries}`,
    );
  }
  const entries = new Map<string, { value: V; expiresAt: number }>();

  return {
    get(key: string): V | undefined {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: V): void {
      // Delete before insert so Map insertion order tracks the newest write,
      // which is what the eviction loop below reads as "oldest".
      entries.delete(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    delete(key: string): void {
      entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
    get size(): number {
      return entries.size;
    },
  };
}
