/**
 * Per-source change counters — the framework's "agent writes show up
 * immediately" primitive.
 *
 * Every server-side mutation emits a `recordChange({ source, ... })` event.
 * `useDbSync` (in this folder) calls `bumpChangeVersion(source, version)` for
 * each event it sees over SSE or `/poll`. Hooks `useChangeVersion(source)`
 * and `useChangeVersions(sources)` expose a per-source integer that
 * advances every time that source has new activity.
 *
 * Templates fold these counters into their React Query `queryKey` — when the
 * counter advances, the key changes, and React Query refetches that one
 * query. No template needs to enumerate query keys in `useDbSync`; no full
 * cache invalidate is required.
 *
 * ```ts
 * const v = useChangeVersion("dashboards");
 * const dashboard = useQuery({
 *   queryKey: ["dashboard", id, v],
 *   queryFn: () => fetchDashboard(id),
 *   placeholderData: keepPreviousData, // no flicker on refetch
 * });
 * ```
 *
 * The agent's `update-dashboard` action emits `{ source: "dashboards" }`
 * (from `upsertDashboard`'s `recordChange` call) AND
 * `{ source: "action" }` (from the agent runner's post-tool emit). Either
 * triggers a refetch when the relevant counter is in the query key.
 *
 * **Cost is bounded:** only queries that opted into a specific source
 * refetch when that source fires. A poll heartbeat with no event does
 * nothing.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";

const MAX_TRACKED_SOURCES = 1_000;
const ZERO_SNAPSHOT = () => 0;

class ChangeVersionStore {
  private versions = new Map<string, number>();
  private listeners = new Map<string, Set<() => void>>();
  private activeSources = new Map<string, number>();

  /**
   * Advance the counter for `source` to at least `version`. Returns true if
   * the counter actually moved (so callers can avoid spurious work).
   */
  bump(source: string, version: number): boolean {
    if (!source) return false;
    const current = this.versions.get(source) ?? 0;
    if (version > current) {
      this.versions.set(source, version);
      this.evictUnobservedSources();
      for (const listener of this.listeners.get(source) ?? []) listener();
      return true;
    }
    return false;
  }

  get(source: string): number {
    return this.versions.get(source) ?? 0;
  }

  subscribe(sources: readonly string[], listener: () => void): () => void {
    const uniqueSources = new Set(sources.filter(Boolean));
    for (const source of uniqueSources) {
      this.activeSources.set(source, (this.activeSources.get(source) ?? 0) + 1);
      let listeners = this.listeners.get(source);
      if (!listeners) {
        listeners = new Set();
        this.listeners.set(source, listeners);
      }
      listeners.add(listener);
    }
    return () => {
      for (const source of uniqueSources) {
        const listeners = this.listeners.get(source);
        listeners?.delete(listener);
        if (listeners?.size === 0) this.listeners.delete(source);
        const count = (this.activeSources.get(source) ?? 1) - 1;
        if (count > 0) this.activeSources.set(source, count);
        else this.activeSources.delete(source);
      }
      this.evictUnobservedSources();
    };
  }

  reset(): void {
    this.versions.clear();
    this.listeners.clear();
    this.activeSources.clear();
  }

  private evictUnobservedSources(): void {
    while (this.versions.size > MAX_TRACKED_SOURCES) {
      let evicted = false;
      for (const source of this.versions.keys()) {
        if (this.activeSources.has(source)) continue;
        this.versions.delete(source);
        evicted = true;
        break;
      }
      if (!evicted) return;
    }
  }
}

const store = new ChangeVersionStore();

/**
 * Advance a source counter. Called by `useDbSync` for every change event;
 * may also be called from templates that learn of a server-side change via
 * a custom path (e.g. an in-process mutation that already happened — bump
 * the counter so other components refetch without waiting for the poll
 * cycle).
 */
export function bumpChangeVersion(source: string, version: number): boolean {
  return store.bump(source, version);
}

/**
 * Get the current counter for a source without subscribing. Use inside
 * event handlers / callbacks; in render code use `useChangeVersion`.
 */
export function getChangeVersion(source: string): number {
  return store.get(source);
}

/**
 * Subscribe to a source's change counter. Returns an integer that
 * increments every time the server emits an event with `source === <source>`
 * — including (by design) the agent's own action calls, since the agent
 * runner emits `source: "action"` after every successful mutating action.
 *
 * Fold the return value into a React Query `queryKey` to make the query
 * refetch whenever that source advances:
 *
 * ```ts
 * const v = useChangeVersion("dashboards");
 * useQuery({
 *   queryKey: ["dashboard", id, v],
 *   queryFn: () => fetchDashboard(id),
 *   placeholderData: keepPreviousData,
 * });
 * ```
 */
export function useChangeVersion(source: string): number {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe([source], listener),
    [source],
  );
  const getSnapshot = useCallback(() => store.get(source), [source]);

  return useSyncExternalStore(subscribe, getSnapshot, ZERO_SNAPSHOT);
}

/**
 * Convenience for queries that should refetch on multiple sources — returns
 * the sum of each source's counter so React Query treats every advance as a
 * key change.
 *
 * ```ts
 * const v = useChangeVersions(["dashboards", "action"]);
 * useQuery({ queryKey: ["dashboard", id, v], ... });
 * ```
 */
export function useChangeVersions(sources: readonly string[]): number {
  const sourceKey = sources
    .map((source) => `${source.length}:${source}`)
    .join("\u0001");
  const stableSources = useMemo(() => {
    const uniqueSources: string[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
      if (seen.has(source)) continue;
      seen.add(source);
      uniqueSources.push(source);
    }
    return uniqueSources;
  }, [sourceKey]);
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(stableSources, listener),
    [stableSources],
  );
  const getSnapshot = useCallback(
    () => stableSources.reduce((sum, src) => sum + store.get(src), 0),
    [stableSources],
  );

  return useSyncExternalStore(subscribe, getSnapshot, ZERO_SNAPSHOT);
}

/** Internal test helper — reset all counters. Do not use in app code. */
export function _resetChangeVersionStoreForTests(): void {
  store.reset();
}
