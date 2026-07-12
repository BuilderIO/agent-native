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
import { useSyncExternalStore } from "react";

class ChangeVersionStore {
  private versions = new Map<string, number>();
  private listeners = new Set<() => void>();
  private cachedSnapshots = new Map<string, number>();

  /**
   * Advance the counter for `source` to at least `version`. Returns true if
   * the counter actually moved (so callers can avoid spurious work).
   */
  bump(source: string, version: number): boolean {
    if (!source) return false;
    const current = this.versions.get(source) ?? 0;
    if (version > current) {
      this.versions.set(source, version);
      this.cachedSnapshots.set(source, version);
      this.notify();
      return true;
    }
    return false;
  }

  get(source: string): number {
    // useSyncExternalStore requires reference-stable snapshots for unchanged
    // values, so we serve from a cached map that we only update inside
    // `bump`.
    const cached = this.cachedSnapshots.get(source);
    if (cached !== undefined) return cached;
    this.cachedSnapshots.set(source, 0);
    return 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) listener();
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
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(source),
    () => 0,
  );
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
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => sources.reduce((sum, src) => sum + store.get(src), 0),
    () => 0,
  );
}

/** Internal test helper — reset all counters. Do not use in app code. */
export function _resetChangeVersionStoreForTests(): void {
  // @ts-expect-error reaching past private to clear state in tests
  store.versions.clear();
  // @ts-expect-error reaching past private to clear state in tests
  store.cachedSnapshots.clear();
}
